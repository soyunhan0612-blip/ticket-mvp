export const SLACK_POST_MESSAGE_URL =
  "https://slack.com/api/chat.postMessage";
export const SLACK_REQUEST_TIMEOUT_MS = 5_000;

export interface SlackPostMessageInput {
  /** Block Kit을 함께 보내도 알림에는 이 문자열이 뜬다. 항상 채운다. */
  text: string;
  /** 도메인을 모르는 계층이라 블록 모양은 호출자가 정한다. */
  blocks?: readonly unknown[];
  threadTs?: string;
}

export interface SlackPostMessageResult {
  ts: string;
}

interface SlackPostMessageResponse {
  ok?: unknown;
  ts?: unknown;
  error?: unknown;
}

export function hasSlackConfig(): boolean {
  return Boolean(
    process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID,
  );
}

export async function postSlackMessage(
  input: SlackPostMessageInput,
): Promise<SlackPostMessageResult> {
  if (!hasSlackConfig()) {
    throw new Error(
      "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must both be configured",
    );
  }

  const token = process.env.SLACK_BOT_TOKEN!;
  const requestBody: {
    channel: string;
    text: string;
    blocks?: readonly unknown[];
    thread_ts?: string;
  } = {
    channel: process.env.SLACK_CHANNEL_ID!,
    text: input.text,
  };

  if (input.blocks !== undefined) {
    requestBody.blocks = input.blocks;
  }

  if (input.threadTs !== undefined) {
    requestBody.thread_ts = input.threadTs;
  }

  let response: Response;
  try {
    response = await fetch(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Slack API request failed");
  }

  if (!response.ok) {
    throw new Error(`Slack API request failed with HTTP ${response.status}`);
  }

  let result: SlackPostMessageResponse;
  try {
    result = (await response.json()) as SlackPostMessageResponse;
  } catch {
    throw new Error("Slack API returned an invalid JSON response");
  }

  if (result.ok !== true) {
    const slackError =
      typeof result.error === "string"
        ? result.error.replaceAll(token, "[redacted]")
        : "unknown_error";
    throw new Error(`Slack API request failed: ${slackError}`);
  }

  if (typeof result.ts !== "string" || result.ts === "") {
    throw new Error("Slack API response did not include ts");
  }

  return { ts: result.ts };
}
