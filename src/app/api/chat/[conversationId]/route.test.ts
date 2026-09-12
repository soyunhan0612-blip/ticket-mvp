import { describe, expect, it } from "vitest";

import { getConversationStore } from "@/services";
import type { Conversation } from "@/types";

import { dynamic, GET, sanitizeConversation } from "./route";

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

describe("sanitizeConversation", () => {
  it("keeps only the client-facing fields", () => {
    const sanitized = sanitizeConversation({
      id: "conversation",
      userId: "owner",
      turns: [],
      escalation: {
        askedAt: 1,
        slackThreadTs: "1700000000.000100",
        autoReplySentAt: null,
        answeredAt: null,
      },
      updatedAt: 42,
      // phase 16이 Conversation에 필드를 더해도 응답에 실리면 안 된다
      slackChannelId: "C0123456789",
    } as unknown as Conversation);

    expect(sanitized).toEqual({ id: "conversation", turns: [], updatedAt: 42 });
  });
});
