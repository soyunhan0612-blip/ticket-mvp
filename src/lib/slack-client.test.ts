import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasSlackConfig,
  postSlackMessage,
  SLACK_POST_MESSAGE_URL,
  SLACK_REQUEST_TIMEOUT_MS,
} from "@/lib/slack-client";

const BOT_TOKEN = "xoxb-test-bot-token";
const CHANNEL_ID = "C0123456789";

function configureSlack(): void {
  vi.stubEnv("SLACK_BOT_TOKEN", BOT_TOKEN);
  vi.stubEnv("SLACK_CHANNEL_ID", CHANNEL_ID);
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("Expected promise to reject");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("hasSlackConfig", () => {
  it("returns true only when both Slack environment variables are present", () => {
    configureSlack();

    expect(hasSlackConfig()).toBe(true);
  });

  it.each([
    [undefined, undefined],
    [BOT_TOKEN, undefined],
    [undefined, CHANNEL_ID],
    ["", CHANNEL_ID],
    [BOT_TOKEN, ""],
  ])("returns false when either variable is missing or empty", (token, channel) => {
    vi.stubEnv("SLACK_BOT_TOKEN", token);
    vi.stubEnv("SLACK_CHANNEL_ID", channel);

    expect(hasSlackConfig()).toBe(false);
  });
});

describe("postSlackMessage", () => {
  it("posts a message with bearer authentication and returns its timestamp", async () => {
    configureSlack();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: "1760000000.000100" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(postSlackMessage({ text: "상담 요청" })).resolves.toEqual({
      ts: "1760000000.000100",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      SLACK_POST_MESSAGE_URL,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: CHANNEL_ID, text: "상담 요청" }),
        signal: expect.any(AbortSignal),
      }),
    );
    const [, request] = fetchSpy.mock.calls[0];
    const headers = request?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(SLACK_REQUEST_TIMEOUT_MS).toBe(5_000);
  });

  it("includes thread_ts when a thread timestamp is provided", async () => {
    configureSlack();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: "1760000000.000200" })),
    );

    await postSlackMessage({
      text: "스레드 답장",
      threadTs: "1760000000.000100",
    });

    const [, request] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual({
      channel: CHANNEL_ID,
      text: "스레드 답장",
      thread_ts: "1760000000.000100",
    });
  });

  it("throws the Slack error when a HTTP 200 response has ok false", async () => {
    configureSlack();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "channel_not_found" }),
        { status: 200 },
      ),
    );

    const error = await captureError(postSlackMessage({ text: "상담 요청" }));

    expect(error.message).toContain("channel_not_found");
    expect(error.message).not.toContain(BOT_TOKEN);
  });

  it("throws when a successful Slack response omits ts", async () => {
    configureSlack();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const error = await captureError(postSlackMessage({ text: "상담 요청" }));

    expect(error.message).toContain("ts");
    expect(error.message).not.toContain(BOT_TOKEN);
  });

  it("throws on an HTTP error without exposing the token", async () => {
    configureSlack();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "server_error" }), {
        status: 500,
      }),
    );

    const error = await captureError(postSlackMessage({ text: "상담 요청" }));

    expect(error.message).toContain("500");
    expect(error.message).not.toContain(BOT_TOKEN);
  });

  it("does not call fetch when Slack configuration is missing", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", BOT_TOKEN);
    vi.stubEnv("SLACK_CHANNEL_ID", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const error = await captureError(postSlackMessage({ text: "상담 요청" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(error.message).not.toContain(BOT_TOKEN);
  });
});
