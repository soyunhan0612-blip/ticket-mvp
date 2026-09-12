import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_TTL_MS,
  MAX_TURN_CONTENT_LENGTH,
  MAX_TURNS_PER_CONVERSATION,
} from "./conversation-store";

const hashes = new Map<string, Map<string, string>>();
const lists = new Map<string, string[]>();
const expiresAt = new Map<string, number>();
const evalCalls: Array<{ operation: string | undefined; keys: string[] }> = [];

function expireKeyIfNeeded(key: string): void {
  const expiry = expiresAt.get(key);
  if (expiry !== undefined && expiry <= Date.now()) {
    hashes.delete(key);
    lists.delete(key);
    expiresAt.delete(key);
  }
}

function hash(key: string): Map<string, string> | undefined {
  expireKeyIfNeeded(key);
  return hashes.get(key);
}

function list(key: string): string[] {
  expireKeyIfNeeded(key);
  return lists.get(key) ?? [];
}

function successResult(metaKey: string, turnsKey: string): unknown[] {
  const meta = hash(metaKey)!;
  return [
    2,
    meta.get("escalation"),
    meta.get("updatedAt"),
    ...list(turnsKey),
  ];
}

const redis = {
  async eval(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown[]> {
    const operation = script.match(/-- operation: ([a-z-]+)/)?.[1];
    evalCalls.push({ operation, keys: [...keys] });

    const metaKey = keys[0]!;
    const turnsKey = keys[1]!;

    if (operation === "create-conversation") {
      hashes.set(metaKey, new Map([
        ["userId", String(args[0])],
        ["escalation", String(args[1])],
        ["updatedAt", String(args[2])],
      ]));
      lists.delete(turnsKey);
      expiresAt.set(metaKey, Date.now() + Number(args[3]) * 1_000);
      expiresAt.delete(turnsKey);
      return successResult(metaKey, turnsKey);
    }

    const meta = hash(metaKey);
    if (!meta) return [0];
    if (meta.get("userId") !== String(args[0])) return [1];

    if (operation === "get-conversation") {
      return successResult(metaKey, turnsKey);
    }

    if (operation === "append-conversation") {
      const target = list(turnsKey);
      const appended = args.slice(4).map(String);
      target.push(...appended);
      lists.set(turnsKey, target.slice(-Number(args[3])));
      meta.set("updatedAt", String(args[1]));
      const expiry = Date.now() + Number(args[2]) * 1_000;
      expiresAt.set(metaKey, expiry);
      if (lists.get(turnsKey)!.length > 0) expiresAt.set(turnsKey, expiry);
      return successResult(metaKey, turnsKey);
    }

    throw new Error(`unknown script: ${operation}`);
  },
};

vi.mock("./redis-client", () => ({ getRedisClient: () => redis }));

import { createConversationStoreRedis } from "./conversation-store-redis";

const NOW = new Date("2026-09-12T00:00:00.000Z");

describe("ConversationStore Redis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    hashes.clear();
    lists.clear();
    expiresAt.clear();
    evalCalls.length = 0;
  });

  afterEach(() => vi.useRealTimers());

  it("creates and retrieves an owned conversation from separate meta and turn keys", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("user-a");

    expect(conversation).toMatchObject({
      userId: "user-a",
      turns: [],
      escalation: null,
      updatedAt: NOW.getTime(),
    });
    expect(conversation.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(evalCalls[0]).toEqual({
      operation: "create-conversation",
      keys: [
        `conversation:${conversation.id}:meta`,
        `conversation:${conversation.id}:turns`,
      ],
    });
    await expect(store.get(conversation.id, "user-a")).resolves.toEqual(conversation);
    expect(evalCalls.at(-1)?.operation).toBe("get-conversation");
  });

  it("appends turns with store-assigned ids and timestamps", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("append-user");

    vi.advanceTimersByTime(1_000);
    const updated = await store.appendTurns(conversation.id, "append-user", [
      { role: "user", content: "질문" },
      { role: "assistant", content: "답변" },
    ]);

    expect(updated.updatedAt).toBe(NOW.getTime() + 1_000);
    expect(updated.turns).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "질문",
        createdAt: NOW.getTime() + 1_000,
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "답변",
        createdAt: NOW.getTime() + 1_000,
      },
    ]);
    expect(updated.turns[0]?.id).not.toBe(updated.turns[1]?.id);
    expect(evalCalls.at(-1)?.operation).toBe("append-conversation");
    expect(lists.get(`conversation:${conversation.id}:turns`)).toHaveLength(2);
  });

  it.each(["get", "appendTurns"] as const)(
    "throws FORBIDDEN when another user calls %s",
    async (method) => {
      const store = createConversationStoreRedis();
      const conversation = await store.create("owner");
      const operation = method === "get"
        ? store.get(conversation.id, "other-user")
        : store.appendTurns(conversation.id, "other-user", [
          { role: "user", content: "침입" },
        ]);

      await expect(operation).rejects.toThrow(
        `FORBIDDEN: conversation ${conversation.id} is owned by another user`,
      );
    },
  );

  it.each(["get", "appendTurns"] as const)(
    "throws NOT_FOUND when %s receives an unknown id",
    async (method) => {
      const store = createConversationStoreRedis();
      const operation = method === "get"
        ? store.get("missing-conversation", "user-a")
        : store.appendTurns("missing-conversation", "user-a", [
          { role: "user", content: "질문" },
        ]);

      await expect(operation).rejects.toThrow(
        "NOT_FOUND: conversation missing-conversation does not exist",
      );
    },
  );

  it("drops the oldest turns when the conversation exceeds its turn limit", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("limit-user");
    const turns = Array.from(
      { length: MAX_TURNS_PER_CONVERSATION + 1 },
      (_, index) => ({ role: "user" as const, content: `turn-${index}` }),
    );

    const updated = await store.appendTurns(conversation.id, "limit-user", turns);

    expect(updated.turns).toHaveLength(MAX_TURNS_PER_CONVERSATION);
    expect(updated.turns[0]?.content).toBe("turn-1");
    expect(updated.turns.at(-1)?.content).toBe(
      `turn-${MAX_TURNS_PER_CONVERSATION}`,
    );
  });

  it("truncates turn content at the storage boundary", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("content-user");
    const content = "x".repeat(MAX_TURN_CONTENT_LENGTH + 1);

    const updated = await store.appendTurns(conversation.id, "content-user", [
      { role: "operator", content },
    ]);

    expect(updated.turns[0]?.content).toBe("x".repeat(MAX_TURN_CONTENT_LENGTH));
  });

  it("expires conversations in Redis without resetting TTL on reads", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("expired-user");

    vi.advanceTimersByTime(CONVERSATION_TTL_MS - 1);
    await expect(store.get(conversation.id, "expired-user")).resolves.toBeDefined();
    vi.advanceTimersByTime(1);

    await expect(store.get(conversation.id, "expired-user")).rejects.toThrow(
      `NOT_FOUND: conversation ${conversation.id} does not exist`,
    );
  });

  it("restarts the TTL from the last append", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("ttl-user");

    vi.advanceTimersByTime(CONVERSATION_TTL_MS - 1);
    await store.appendTurns(conversation.id, "ttl-user", [
      { role: "notice", content: "TTL 갱신" },
    ]);
    vi.advanceTimersByTime(CONVERSATION_TTL_MS - 1);

    await expect(store.get(conversation.id, "ttl-user")).resolves.toBeDefined();
    vi.advanceTimersByTime(1);
    await expect(store.get(conversation.id, "ttl-user")).rejects.toThrow("NOT_FOUND");
  });

  it("does not lose turns when appends start concurrently", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("concurrent-user");

    await Promise.all([
      store.appendTurns(conversation.id, "concurrent-user", [
        { role: "user", content: "손님 질문" },
      ]),
      store.appendTurns(conversation.id, "concurrent-user", [
        { role: "operator", content: "상담원 답변" },
      ]),
    ]);

    const persisted = await store.get(conversation.id, "concurrent-user");
    expect(persisted.turns.map((turn) => turn.content)).toEqual([
      "손님 질문",
      "상담원 답변",
    ]);
    expect(evalCalls.filter(({ operation }) => operation === "append-conversation"))
      .toHaveLength(2);
  });
});
