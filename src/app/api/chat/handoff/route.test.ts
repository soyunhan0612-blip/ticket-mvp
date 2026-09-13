import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPERATOR_HANDOFF_TEXT } from "@/chatbot/core/escalation";
import { getConversationStore } from "@/services";

import { POST } from "./route";

const postSlackMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/slack-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack-client")>(
    "@/lib/slack-client",
  );

  return { ...actual, postSlackMessage: postSlackMessageMock };
});

let threadSequence = 0;
function nextThreadTs(): string {
  threadSequence += 1;
  return `176000000${threadSequence}.000100`;
}

function makeRequest(body: unknown, ip: string, userId?: string): Request {
  return new Request("http://localhost/api/chat/handoff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      ...(userId ? { cookie: `userId=${userId}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat/handoff", () => {
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalSlackChannelId = process.env.SLACK_CHANNEL_ID;

  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_CHANNEL_ID = "C0TEST";
    postSlackMessageMock.mockReset();
    postSlackMessageMock.mockImplementation(async () => ({
      ts: nextThreadTs(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSlackBotToken === undefined) {
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    }
    if (originalSlackChannelId === undefined) {
      delete process.env.SLACK_CHANNEL_ID;
    } else {
      process.env.SLACK_CHANNEL_ID = originalSlackChannelId;
    }
  });

  it("returns 401 without a userId cookie", async () => {
    const response = await POST(
      makeRequest({}, `handoff-no-cookie-${crypto.randomUUID()}`),
    );

    expect(response.status).toBe(401);
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("rejects a conversation id that is not a plain token", async () => {
    const response = await POST(
      makeRequest(
        { conversationId: "../../etc/passwd" },
        `handoff-bad-id-${crypto.randomUUID()}`,
        `handoff-bad-id-user-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("returns 503 when Slack is not configured", async () => {
    delete process.env.SLACK_BOT_TOKEN;

    const response = await POST(
      makeRequest(
        {},
        `handoff-no-slack-${crypto.randomUUID()}`,
        `handoff-no-slack-user-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(503);
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown conversation", async () => {
    const response = await POST(
      makeRequest(
        { conversationId: "does-not-exist" },
        `handoff-404-${crypto.randomUUID()}`,
        `handoff-404-user-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 for someone else's conversation", async () => {
    const owner = `handoff-owner-${crypto.randomUUID()}`;
    const conversation = await getConversationStore().create(owner);

    const response = await POST(
      makeRequest(
        { conversationId: conversation.id },
        `handoff-403-${crypto.randomUUID()}`,
        `handoff-intruder-${crypto.randomUUID()}`,
      ),
    );

    expect(response.status).toBe(403);
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("connects an existing conversation and tells the guest", async () => {
    const userId = `handoff-ok-user-${crypto.randomUUID()}`;
    const store = getConversationStore();
    const conversation = await store.create(userId);
    await store.appendTurns(conversation.id, userId, [
      { role: "user", content: "결제가 안 됩니다" },
    ]);

    const response = await POST(
      makeRequest(
        { conversationId: conversation.id },
        `handoff-ok-${crypto.randomUUID()}`,
        userId,
      ),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.operatorMode).toBe(true);
    expect(body.awaitingOperator).toBe(true);

    const turns = (body.conversation as { turns: Array<Record<string, unknown>> })
      .turns;
    expect(turns[turns.length - 1]).toMatchObject({
      role: "notice",
      content: OPERATOR_HANDOFF_TEXT,
    });
    expect(postSlackMessageMock).toHaveBeenCalledTimes(1);
    expect(postSlackMessageMock.mock.calls[0][0].text).toContain(
      "결제가 안 됩니다",
    );
  });

  it("never leaks the owner id or the Slack thread id", async () => {
    const userId = `handoff-leak-user-${crypto.randomUUID()}`;
    const threadTs = nextThreadTs();
    postSlackMessageMock.mockResolvedValue({ ts: threadTs });
    const conversation = await getConversationStore().create(userId);

    const response = await POST(
      makeRequest(
        { conversationId: conversation.id },
        `handoff-leak-${crypto.randomUUID()}`,
        userId,
      ),
    );
    const serialised = JSON.stringify(await response.json());

    expect(serialised).not.toContain(userId);
    expect(serialised).not.toContain(threadTs);
    expect(serialised).not.toContain("escalation");
  });

  it("creates a conversation when the guest opens the panel and asks straight away", async () => {
    const userId = `handoff-new-user-${crypto.randomUUID()}`;

    const response = await POST(
      makeRequest({}, `handoff-new-${crypto.randomUUID()}`, userId),
    );
    const body = (await response.json()) as {
      conversation: { id: string };
      operatorMode: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.operatorMode).toBe(true);
    expect(body.conversation.id).toMatch(/^[A-Za-z0-9_-]+$/);

    const stored = await getConversationStore().get(
      body.conversation.id,
      userId,
    );
    expect(stored.escalation).not.toBeNull();
  });

  it("is idempotent and free once the conversation is already connected", async () => {
    const userId = `handoff-repeat-user-${crypto.randomUUID()}`;
    const conversation = await getConversationStore().create(userId);
    const ip = `handoff-repeat-${crypto.randomUUID()}`;

    await POST(makeRequest({ conversationId: conversation.id }, ip, userId));
    postSlackMessageMock.mockClear();

    // 이미 연결된 대화를 다시 눌러도 Slack을 부르지 않고 시간당 한도도 쓰지 않는다.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repeat = await POST(
        makeRequest({ conversationId: conversation.id }, ip, userId),
      );
      const body = (await repeat.json()) as Record<string, unknown>;

      expect(repeat.status).toBe(200);
      expect(body.operatorMode).toBe(true);
    }
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("returns 429 on the fourth handoff within the hour", async () => {
    const userId = `handoff-limit-user-${crypto.randomUUID()}`;
    const store = getConversationStore();
    const ip = `handoff-limit-${crypto.randomUUID()}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const conversation = await store.create(userId);
      const allowed = await POST(
        makeRequest({ conversationId: conversation.id }, ip, userId),
      );
      expect(allowed.status).toBe(200);
    }

    const fourth = await store.create(userId);
    const response = await POST(
      makeRequest({ conversationId: fourth.id }, ip, userId),
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("shares the hourly budget with the model-driven escalation tool", async () => {
    const { checkEscalationRateLimit } = await import(
      "@/lib/chat-escalation-limit"
    );
    const userId = `handoff-shared-user-${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      checkEscalationRateLimit(userId);
    }
    const conversation = await getConversationStore().create(userId);

    const response = await POST(
      makeRequest(
        { conversationId: conversation.id },
        `handoff-shared-${crypto.randomUUID()}`,
        userId,
      ),
    );

    expect(response.status).toBe(429);
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("leaves the conversation unescalated when Slack refuses the message", async () => {
    const userId = `handoff-slack-down-user-${crypto.randomUUID()}`;
    postSlackMessageMock.mockRejectedValue(new Error("slack down"));
    const conversation = await getConversationStore().create(userId);

    const response = await POST(
      makeRequest(
        { conversationId: conversation.id },
        `handoff-slack-down-${crypto.randomUUID()}`,
        userId,
      ),
    );

    expect(response.status).toBe(502);

    const stored = await getConversationStore().get(conversation.id, userId);
    expect(stored.escalation).toBeNull();
  });

  it("returns 429 after ten requests from one IP", async () => {
    const ip = `handoff-ip-limit-${crypto.randomUUID()}`;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await POST(
        makeRequest({}, ip, `handoff-ip-user-${crypto.randomUUID()}`),
      );
    }

    const response = await POST(
      makeRequest({}, ip, `handoff-ip-user-${crypto.randomUUID()}`),
    );

    expect(response.status).toBe(429);
  });
});
