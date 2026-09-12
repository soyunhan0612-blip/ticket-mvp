import { afterEach, describe, expect, it, vi } from "vitest";

import { getConversationStore } from "@/services";
import type { Conversation } from "@/types";
import {
  AUTO_REPLY_DELAY_MS,
  AUTO_REPLY_TEXT,
} from "@/chatbot/core/escalation";

import { dynamic, GET } from "./route";

function makeRequest(
  conversationId: string,
  ip: string,
  userId?: string,
): Request {
  return new Request(`http://localhost/api/chat/${conversationId}`, {
    headers: {
      "x-forwarded-for": ip,
      ...(userId ? { cookie: `userId=${userId}` } : {}),
    },
  });
}

function makeContext(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

describe("GET /api/chat/[conversationId]", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forces dynamic rendering for operator reply polling", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 without a userId cookie", async () => {
    const conversationId = "missing-cookie";
    const response = await GET(
      makeRequest(
        conversationId,
        `missing-cookie-${crypto.randomUUID()}`,
      ),
      makeContext(conversationId),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 403 for another user's conversation", async () => {
    const store = getConversationStore();
    const conversation = await store.create(
      `get-owner-${crypto.randomUUID()}`,
    );
    const response = await GET(
      makeRequest(
        conversation.id,
        `get-forbidden-${crypto.randomUUID()}`,
        `get-intruder-${crypto.randomUUID()}`,
      ),
      makeContext(conversation.id),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("returns 404 for an unknown conversation", async () => {
    const conversationId = "missing-conversation";
    const response = await GET(
      makeRequest(
        conversationId,
        `get-not-found-${crypto.randomUUID()}`,
        `get-not-found-user-${crypto.randomUUID()}`,
      ),
      makeContext(conversationId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
  });

  it("returns sanitized JSON with awaitingOperator false", async () => {
    const store = getConversationStore();
    const userId = `get-success-user-${crypto.randomUUID()}`;
    const conversation = await store.create(userId);
    const updated = await store.appendTurns(conversation.id, userId, [
      { role: "user", content: "질문" },
      { role: "assistant", content: "답변" },
      { role: "operator", content: "상담원 답변" },
      { role: "notice", content: "안내" },
    ]);
    const response = await GET(
      makeRequest(
        conversation.id,
        `get-success-${crypto.randomUUID()}`,
        userId,
      ),
      makeContext(conversation.id),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      conversation: {
        id: updated.id,
        turns: updated.turns,
        updatedAt: updated.updatedAt,
      },
      awaitingOperator: false,
    });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("escalation");
    expect(body.conversation).not.toHaveProperty("userId");
    expect(body.conversation).not.toHaveProperty("escalation");
    expect(JSON.stringify(body)).not.toContain(userId);
  });

  it("keeps future private conversation fields out of the response", async () => {
    const userId = `future-field-user-${crypto.randomUUID()}`;
    vi.spyOn(getConversationStore(), "get").mockResolvedValue({
      id: "conversation",
      userId,
      turns: [],
      escalation: null,
      updatedAt: 42,
      slackChannelId: "C0123456789",
    } as unknown as Conversation);

    const response = await GET(
      makeRequest(
        "conversation",
        `future-field-${crypto.randomUUID()}`,
        userId,
      ),
      makeContext("conversation"),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(body).toEqual({
      conversation: { id: "conversation", turns: [], updatedAt: 42 },
      awaitingOperator: false,
    });
    expect(JSON.stringify(body)).not.toContain("slackChannelId");
  });

  it("appends the overdue auto reply once and keeps only awaitingOperator public", async () => {
    const store = getConversationStore();
    const userId = `auto-reply-user-${crypto.randomUUID()}`;
    const conversation = await store.create(userId);
    await store.startEscalation(
      conversation.id,
      userId,
      "1234567890.123456",
      Date.now() - AUTO_REPLY_DELAY_MS,
    );

    const firstResponse = await GET(
      makeRequest(
        conversation.id,
        `auto-reply-first-${crypto.randomUUID()}`,
        userId,
      ),
      makeContext(conversation.id),
    );
    const secondResponse = await GET(
      makeRequest(
        conversation.id,
        `auto-reply-second-${crypto.randomUUID()}`,
        userId,
      ),
      makeContext(conversation.id),
    );
    const firstBody = await firstResponse.json() as Record<string, unknown>;
    const secondBody = await secondResponse.json() as Record<string, unknown>;
    const stored = await store.get(conversation.id, userId);
    const notices = stored.turns.filter(
      (turn) => turn.role === "notice" && turn.content === AUTO_REPLY_TEXT,
    );

    expect(firstBody.awaitingOperator).toBe(true);
    expect(secondBody.awaitingOperator).toBe(true);
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(firstBody)).not.toContain("escalation");
    expect(JSON.stringify(firstBody)).not.toContain("1234567890.123456");
    expect(JSON.stringify(secondBody)).not.toContain("escalation");
    expect(JSON.stringify(secondBody)).not.toContain("1234567890.123456");
  });

  it("returns 429 with Retry-After after sixty polls from one IP", async () => {
    const store = getConversationStore();
    const userId = `get-rate-limit-user-${crypto.randomUUID()}`;
    const conversation = await store.create(userId);
    const ip = `get-rate-limit-${crypto.randomUUID()}`;

    for (let index = 0; index < 60; index += 1) {
      const response = await GET(
        makeRequest(conversation.id, ip, userId),
        makeContext(conversation.id),
      );
      expect(response.status).toBe(200);
    }
    const response = await GET(
      makeRequest(conversation.id, ip, userId),
      makeContext(conversation.id),
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
