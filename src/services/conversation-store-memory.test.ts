import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_TTL_MS,
  MAX_TURN_CONTENT_LENGTH,
  MAX_TURNS_PER_CONVERSATION,
} from "./conversation-store";
import { createConversationStoreMemory } from "./conversation-store-memory";

const NOW = new Date("2026-09-12T00:00:00.000Z");

describe("ConversationStore memory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and retrieves an owned conversation", async () => {
    const store = createConversationStoreMemory();
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
    await expect(store.get(conversation.id, "user-a")).resolves.toEqual(conversation);
  });

  it("appends turns with store-assigned ids and timestamps", async () => {
    const store = createConversationStoreMemory();
    const conversation = await store.create("append-user");

    vi.advanceTimersByTime(1_000);
    const updated = await store.appendTurns(conversation.id, "append-user", [
      { role: "user", content: "질문" },
      { role: "assistant", content: "답변" },
    ]);

    expect(updated.updatedAt).toBe(NOW.getTime() + 1_000);
    expect(updated.turns).toHaveLength(2);
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
  });

  it.each(["get", "appendTurns"] as const)(
    "throws FORBIDDEN when another user calls %s",
    async (method) => {
      const store = createConversationStoreMemory();
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
      const store = createConversationStoreMemory();
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
    const store = createConversationStoreMemory();
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
    const store = createConversationStoreMemory();
    const conversation = await store.create("content-user");
    const content = "x".repeat(MAX_TURN_CONTENT_LENGTH + 1);

    const updated = await store.appendTurns(conversation.id, "content-user", [
      { role: "operator", content },
    ]);

    expect(updated.turns[0]?.content).toBe("x".repeat(MAX_TURN_CONTENT_LENGTH));
  });

  it("expires conversations lazily without resetting TTL on reads", async () => {
    const store = createConversationStoreMemory();
    const conversation = await store.create("expired-user");

    vi.advanceTimersByTime(CONVERSATION_TTL_MS);

    await expect(store.get(conversation.id, "expired-user")).rejects.toThrow(
      `NOT_FOUND: conversation ${conversation.id} does not exist`,
    );
  });

  it("restarts the TTL from the last append", async () => {
    const store = createConversationStoreMemory();
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
});
