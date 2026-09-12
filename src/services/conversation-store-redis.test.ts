import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_TTL_MS,
  MAX_TURN_CONTENT_LENGTH,
  MAX_TURNS_PER_CONVERSATION,
} from "./conversation-store";

const hashes = new Map<string, Map<string, string>>();
const lists = new Map<string, string[]>();
const strings = new Map<string, string>();
const expiresAt = new Map<string, number>();
const evalCalls: Array<{ operation: string | undefined; keys: string[] }> = [];

function expireKeyIfNeeded(key: string): void {
  const expiry = expiresAt.get(key);
  if (expiry !== undefined && expiry <= Date.now()) {
    hashes.delete(key);
    lists.delete(key);
    strings.delete(key);
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

    if (operation === "append-operator-reply") {
      const threadIndexKey = keys[0]!;
      const eventKey = keys[1]!;
      expireKeyIfNeeded(eventKey);
      if (strings.has(eventKey)) return [0];

      expireKeyIfNeeded(threadIndexKey);
      const conversationId = strings.get(threadIndexKey);
      if (!conversationId) return [0];

      const metaKey = `conversation:${conversationId}:meta`;
      const turnsKey = `conversation:${conversationId}:turns`;
      const meta = hash(metaKey);
      if (!meta) return [0];

      const escalation = JSON.parse(meta.get("escalation")!);
      if (escalation?.slackThreadTs !== String(args[0])) return [0];

      const target = list(turnsKey);
      target.push(String(args[5]));
      lists.set(turnsKey, target.slice(-Number(args[4])));
      if (escalation.answeredAt === null) escalation.answeredAt = Number(args[1]);
      meta.set("escalation", JSON.stringify(escalation));
      meta.set("updatedAt", String(args[1]));

      const conversationExpiry = Date.now() + Number(args[2]) * 1_000;
      expiresAt.set(metaKey, conversationExpiry);
      expiresAt.set(turnsKey, conversationExpiry);
      expiresAt.set(threadIndexKey, conversationExpiry);
      strings.set(eventKey, "1");
      expiresAt.set(eventKey, Date.now() + Number(args[3]) * 1_000);

      return [
        2,
        conversationId,
        meta.get("userId"),
        meta.get("escalation"),
        meta.get("updatedAt"),
        ...list(turnsKey),
      ];
    }

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

    if (operation === "start-escalation") {
      const currentEscalation = JSON.parse(meta.get("escalation")!);
      if (currentEscalation?.answeredAt === null) return [3];

      const escalation = JSON.parse(String(args[1]));
      meta.set("escalation", JSON.stringify(escalation));
      meta.set("updatedAt", String(args[2]));
      strings.set(keys[2]!, metaKey.slice("conversation:".length, -":meta".length));

      const expiry = Date.now() + Number(args[3]) * 1_000;
      expiresAt.set(metaKey, expiry);
      if (lists.has(turnsKey)) expiresAt.set(turnsKey, expiry);
      expiresAt.set(keys[2]!, expiry);
      return successResult(metaKey, turnsKey);
    }

    if (operation === "mark-auto-reply-sent") {
      const escalation = JSON.parse(meta.get("escalation")!);
      if (
        !escalation
        || escalation.autoReplySentAt !== null
        || escalation.answeredAt !== null
      ) {
        return [2];
      }

      escalation.autoReplySentAt = Number(args[1]);
      meta.set("escalation", JSON.stringify(escalation));
      meta.set("updatedAt", String(args[1]));
      const expiry = Date.now() + Number(args[2]) * 1_000;
      expiresAt.set(metaKey, expiry);
      if (lists.has(turnsKey)) expiresAt.set(turnsKey, expiry);
      return [3];
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
    strings.clear();
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

  it("rejects a second escalation while the first is unanswered", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("escalation-user");

    await store.startEscalation(
      conversation.id,
      "escalation-user",
      "1757635200.000001",
      NOW.getTime(),
    );

    await expect(store.startEscalation(
      conversation.id,
      "escalation-user",
      "1757635201.000002",
      NOW.getTime() + 1,
    )).rejects.toThrow(
      `ESCALATION_IN_PROGRESS: conversation ${conversation.id}`,
    );
    expect(evalCalls.at(-1)?.operation).toBe("start-escalation");
  });

  it("rejects an invalid Slack thread timestamp before building a Redis key", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("invalid-thread-user");
    const callsBeforeValidation = evalCalls.length;

    await expect(store.startEscalation(
      conversation.id,
      "invalid-thread-user",
      "1757635200:not-a-thread",
      NOW.getTime(),
    )).rejects.toThrow("INVALID_SLACK_THREAD_TS");
    expect(evalCalls).toHaveLength(callsBeforeValidation);
  });

  it("marks the automatic reply with one compare-and-set eval", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("auto-reply-user");
    await store.startEscalation(
      conversation.id,
      "auto-reply-user",
      "1757635202.000003",
      NOW.getTime(),
    );

    await expect(store.markAutoReplySent(
      conversation.id,
      "auto-reply-user",
      NOW.getTime() + 60_000,
    )).resolves.toBe(true);
    await expect(store.markAutoReplySent(
      conversation.id,
      "auto-reply-user",
      NOW.getTime() + 60_001,
    )).resolves.toBe(false);

    expect(evalCalls.filter(({ operation }) => operation === "mark-auto-reply-sent"))
      .toHaveLength(2);
    const persisted = await store.get(conversation.id, "auto-reply-user");
    expect(persisted.escalation?.autoReplySentAt).toBe(NOW.getTime() + 60_000);
  });

  it("does not mark an automatic reply after an operator has answered", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("answered-user");
    const threadTs = "1757635203.000004";
    await store.startEscalation(
      conversation.id,
      "answered-user",
      threadTs,
      NOW.getTime(),
    );
    await store.appendOperatorReply(
      threadTs,
      "operator answer",
      "event-answered",
      NOW.getTime() + 30_000,
    );

    await expect(store.markAutoReplySent(
      conversation.id,
      "answered-user",
      NOW.getTime() + 60_000,
    )).resolves.toBe(false);
  });

  it("appends a Slack event only once", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("idempotent-user");
    const threadTs = "1757635204.000005";
    await store.startEscalation(
      conversation.id,
      "idempotent-user",
      threadTs,
      NOW.getTime(),
    );

    await expect(store.appendOperatorReply(
      threadTs,
      "single answer",
      "event-idempotent",
      NOW.getTime() + 10_000,
    )).resolves.not.toBeNull();
    await expect(store.appendOperatorReply(
      threadTs,
      "duplicate answer",
      "event-idempotent",
      NOW.getTime() + 10_001,
    )).resolves.toBeNull();

    expect(evalCalls.at(-1)).toEqual({
      operation: "append-operator-reply",
      keys: [
        `conversation:slack-thread:${threadTs}`,
        "conversation:slack-event:event-idempotent",
      ],
    });
    const persisted = await store.get(conversation.id, "idempotent-user");
    expect(persisted.turns).toHaveLength(1);
    expect(persisted.turns[0]?.content).toBe("single answer");
  });

  it("returns null for an unknown Slack thread", async () => {
    const store = createConversationStoreRedis();

    await expect(store.appendOperatorReply(
      "1757635205.000006",
      "orphan answer",
      "event-orphan",
      NOW.getTime(),
    )).resolves.toBeNull();
  });

  it("sets answeredAt when appending the first operator reply", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("answer-time-user");
    const threadTs = "1757635206.000007";
    await store.startEscalation(
      conversation.id,
      "answer-time-user",
      threadTs,
      NOW.getTime(),
    );

    const answered = await store.appendOperatorReply(
      threadTs,
      "first answer",
      "event-answer-time",
      NOW.getTime() + 20_000,
    );

    expect(answered?.escalation?.answeredAt).toBe(NOW.getTime() + 20_000);
  });

  it("persists operator turns for owned reads", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("operator-turn-user");
    const threadTs = "1757635207.000008";
    await store.startEscalation(
      conversation.id,
      "operator-turn-user",
      threadTs,
      NOW.getTime(),
    );
    await store.appendOperatorReply(
      threadTs,
      "persisted operator answer",
      "event-operator-turn",
      NOW.getTime() + 40_000,
    );

    const persisted = await store.get(conversation.id, "operator-turn-user");
    expect(persisted.turns).toContainEqual({
      id: expect.any(String),
      role: "operator",
      content: "persisted operator answer",
      createdAt: NOW.getTime() + 40_000,
    });
  });

  it("ignores a stale Slack thread after a new escalation starts", async () => {
    const store = createConversationStoreRedis();
    const conversation = await store.create("re-escalation-user");
    const previousThreadTs = "1757635208.000009";
    const currentThreadTs = "1757635209.000010";
    await store.startEscalation(
      conversation.id,
      "re-escalation-user",
      previousThreadTs,
      NOW.getTime(),
    );
    await store.appendOperatorReply(
      previousThreadTs,
      "first escalation answer",
      "event-first-escalation",
      NOW.getTime() + 10_000,
    );
    await store.startEscalation(
      conversation.id,
      "re-escalation-user",
      currentThreadTs,
      NOW.getTime() + 20_000,
    );

    await expect(store.appendOperatorReply(
      previousThreadTs,
      "late answer on stale thread",
      "event-stale-thread",
      NOW.getTime() + 30_000,
    )).resolves.toBeNull();
    await expect(store.get(conversation.id, "re-escalation-user"))
      .resolves.toMatchObject({
        escalation: {
          slackThreadTs: currentThreadTs,
          answeredAt: null,
        },
      });
  });
});
