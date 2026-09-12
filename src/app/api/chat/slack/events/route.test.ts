import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConversationStore } from "@/services";

import { POST } from "./route";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const SIGNING_SECRET = "slack-signing-secret";
const CHANNEL_ID = "C1234567890";

interface EventOverrides {
  bot_id?: string;
  channel?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
}

function sign(rawBody: string, timestamp: string, secret: string): string {
  return `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
}

function makeSignedRequest(
  body: unknown,
  options: {
    secret?: string;
    signature?: string;
    timestamp?: string;
  } = {},
): Request {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = options.timestamp
    ?? String(Math.floor(NOW.getTime() / 1_000));
  const secret = options.secret ?? SIGNING_SECRET;

  return new Request("http://localhost/api/chat/slack/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": options.signature
        ?? sign(rawBody, timestamp, secret),
    },
    body: rawBody,
  });
}

function makeEvent(
  eventId: string,
  threadTs: string,
  overrides: EventOverrides = {},
) {
  return {
    type: "event_callback",
    event_id: eventId,
    event: {
      type: "message",
      channel: CHANNEL_ID,
      thread_ts: threadTs,
      ts: `${threadTs.split(".")[0]}.999999`,
      text: "상담원 답변입니다.",
      ...overrides,
    },
  };
}

async function createEscalatedConversation(
  userId: string,
  threadTs: string,
) {
  const store = getConversationStore();
  const conversation = await store.create(userId);
  await store.startEscalation(
    conversation.id,
    userId,
    threadTs,
    NOW.getTime(),
  );
  return conversation;
}

describe("POST /api/chat/slack/events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("SLACK_SIGNING_SECRET", SIGNING_SECRET);
    vi.stubEnv("SLACK_CHANNEL_ID", CHANNEL_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("appends a valid Slack thread reply and returns no conversation data", async () => {
    const userId = `slack-route-user-${crypto.randomUUID()}`;
    const threadTs = "1789214400.000001";
    const conversation = await createEscalatedConversation(userId, threadTs);
    const reply = "결제 오류를 확인했습니다.";

    const response = await POST(makeSignedRequest(
      makeEvent("Ev-valid-reply", threadTs, { text: reply }),
    ));

    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(responseBody).toBe("");
    expect(responseBody).not.toContain(userId);
    expect(responseBody).not.toContain(reply);

    const persisted = await getConversationStore().get(
      conversation.id,
      userId,
    );
    expect(persisted.turns).toContainEqual({
      id: expect.any(String),
      role: "operator",
      content: reply,
      createdAt: NOW.getTime(),
    });
  });

  it("returns 401 for an invalid signature without changing the conversation", async () => {
    const userId = `invalid-signature-user-${crypto.randomUUID()}`;
    const threadTs = "1789214401.000002";
    const conversation = await createEscalatedConversation(userId, threadTs);

    const response = await POST(makeSignedRequest(
      makeEvent("Ev-invalid-signature", threadTs),
      { signature: `v0=${"0".repeat(64)}` },
    ));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    const persisted = await getConversationStore().get(
      conversation.id,
      userId,
    );
    expect(persisted.turns).toHaveLength(0);
  });

  it("fails closed with 401 when SLACK_SIGNING_SECRET is empty", async () => {
    vi.stubEnv("SLACK_SIGNING_SECRET", "");
    const threadTs = "1789214402.000003";

    const response = await POST(makeSignedRequest(
      makeEvent("Ev-missing-secret", threadTs),
    ));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("returns 401 for a timestamp older than the five-minute tolerance", async () => {
    const timestamp = String(Math.floor((NOW.getTime() - 6 * 60_000) / 1_000));
    const threadTs = "1789214403.000004";

    const response = await POST(makeSignedRequest(
      makeEvent("Ev-stale-timestamp", threadTs),
      { timestamp },
    ));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("returns the URL verification challenge unchanged", async () => {
    const challenge = "slack-url-verification-challenge";

    const response = await POST(makeSignedRequest({
      type: "url_verification",
      challenge,
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(challenge);
  });

  it("ignores bot messages with a 200 response", async () => {
    const userId = `bot-message-user-${crypto.randomUUID()}`;
    const threadTs = "1789214404.000005";
    const conversation = await createEscalatedConversation(userId, threadTs);

    const response = await POST(makeSignedRequest(
      makeEvent("Ev-bot-message", threadTs, { bot_id: "B1234567890" }),
    ));

    expect(response.status).toBe(200);
    expect((await getConversationStore().get(conversation.id, userId)).turns)
      .toHaveLength(0);
  });

  it("ignores messages from another channel with a 200 response", async () => {
    const userId = `other-channel-user-${crypto.randomUUID()}`;
    const threadTs = "1789214405.000006";
    const conversation = await createEscalatedConversation(userId, threadTs);

    const response = await POST(makeSignedRequest(
      makeEvent("Ev-other-channel", threadTs, { channel: "C9999999999" }),
    ));

    expect(response.status).toBe(200);
    expect((await getConversationStore().get(conversation.id, userId)).turns)
      .toHaveLength(0);
  });

  it("returns 200 for an unknown Slack thread", async () => {
    const response = await POST(makeSignedRequest(
      makeEvent("Ev-unknown-thread", "1789214406.000007"),
    ));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("appends a retried event_id only once", async () => {
    const userId = `duplicate-event-user-${crypto.randomUUID()}`;
    const threadTs = "1789214407.000008";
    const conversation = await createEscalatedConversation(userId, threadTs);
    const body = makeEvent("Ev-duplicate", threadTs);

    const firstResponse = await POST(makeSignedRequest(body));
    const retryResponse = await POST(makeSignedRequest(body));

    expect(firstResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    const persisted = await getConversationStore().get(
      conversation.id,
      userId,
    );
    expect(persisted.turns).toHaveLength(1);
  });

  it("returns 400 when the signed body is not JSON", async () => {
    const response = await POST(makeSignedRequest("not-json"));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
  });
});
