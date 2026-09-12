import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_LIMIT,
  buildTicketChatFallback,
} from "@/chatbot/adapters/ticket/prompt";
import { getConversationStore } from "@/services";

import { POST } from "./route";

function makeRequest(
  body: unknown,
  ip: string,
  userId?: string,
): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      ...(userId ? { cookie: `userId=${userId}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("returns 401 without a userId cookie", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await POST(
      makeRequest(
        { message: "공연을 추천해 줘" },
        `missing-cookie-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("returns 400 for invalid messages and conversation ids", async () => {
    const userId = `invalid-body-user-${crypto.randomUUID()}`;
    const blankMessage = await POST(
      makeRequest(
        { message: "   " },
        `blank-message-${crypto.randomUUID()}`,
        userId,
      ),
    );
    const longMessage = await POST(
      makeRequest(
        { message: "가".repeat(CHAT_MESSAGE_LIMIT + 1) },
        `long-message-${crypto.randomUUID()}`,
        userId,
      ),
    );
    const invalidConversationId = await POST(
      makeRequest(
        { conversationId: "invalid/id", message: "문의" },
        `invalid-id-${crypto.randomUUID()}`,
        userId,
      ),
    );

    expect(blankMessage.status).toBe(400);
    expect(longMessage.status).toBe(400);
    expect(invalidConversationId.status).toBe(400);
  });

  it("returns 403 for another user's conversation", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const store = getConversationStore();
    const conversation = await store.create(
      `conversation-owner-${crypto.randomUUID()}`,
    );

    const response = await POST(
      makeRequest(
        { conversationId: conversation.id, message: "침입 시도" },
        `forbidden-${crypto.randomUUID()}`,
        `conversation-intruder-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 for an unknown conversation", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await POST(
      makeRequest(
        { conversationId: "missing-conversation", message: "문의" },
        `not-found-${crypto.randomUUID()}`,
        `not-found-user-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(404);
  });

  it("returns 429 with Retry-After after ten requests from one IP", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const ip = `ip-rate-limit-${crypto.randomUUID()}`;
    const userId = `ip-rate-limit-user-${crypto.randomUUID()}`;

    for (let index = 0; index < 10; index += 1) {
      const response = await POST(
        makeRequest({ message: `문의 ${index}` }, ip, userId),
      );
      expect(response.status).toBe(200);
    }
    const response = await POST(
      makeRequest({ message: "열한 번째 문의" }, ip, userId),
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("limits one user across different IP addresses", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const userId = `user-rate-limit-${crypto.randomUUID()}`;

    for (let index = 0; index < 10; index += 1) {
      const response = await POST(
        makeRequest(
          { message: `문의 ${index}` },
          `user-rate-limit-ip-${crypto.randomUUID()}`,
          userId,
        ),
      );
      expect(response.status).toBe(200);
    }
    const response = await POST(
      makeRequest(
        { message: "열한 번째 문의" },
        `user-rate-limit-ip-${crypto.randomUUID()}`,
        userId,
      ),
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("streams a fallback and returns its conversation id when the key is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const userId = `fallback-user-${crypto.randomUUID()}`;
    const response = await POST(
      makeRequest(
        { message: "내 예매를 알려 줘" },
        `fallback-${crypto.randomUUID()}`,
        userId,
      ),
    );
    const answer = await response.text();
    const conversationId = response.headers.get("X-Conversation-Id");

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(conversationId).toMatch(/^[0-9a-f-]+$/i);
    expect(answer).toBe(buildTicketChatFallback());
    expect(answer).not.toContain(conversationId);

    const stored = await getConversationStore().get(conversationId!, userId);
    expect(stored.turns.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "내 예매를 알려 줘" },
      { role: "notice", content: buildTicketChatFallback() },
    ]);
  });

  it("uses the cookie owner even when the body contains a forged userId", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const cookieUserId = `cookie-owner-${crypto.randomUUID()}`;
    const forgedUserId = `forged-owner-${crypto.randomUUID()}`;
    const response = await POST(
      makeRequest(
        { message: "내 예매를 알려 줘", userId: forgedUserId },
        `forged-user-${crypto.randomUUID()}`,
        cookieUserId,
      ),
    );
    const conversationId = response.headers.get("X-Conversation-Id");

    expect(response.status).toBe(200);
    await expect(
      getConversationStore().get(conversationId!, cookieUserId),
    ).resolves.toBeDefined();
    await expect(
      getConversationStore().get(conversationId!, forgedUserId),
    ).rejects.toThrow("FORBIDDEN:");
  });
});
