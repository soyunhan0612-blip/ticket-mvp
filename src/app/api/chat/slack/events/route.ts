import { verifySlackSignature } from "@/lib/slack-signature";
import { getConversationStore } from "@/services";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function emptyResponse(status = 200): Response {
  return new Response(null, { status });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!timestamp || !signature) return emptyResponse(401);
  if (!verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
    timestamp,
    signature,
    rawBody,
    now: Date.now(),
  })) {
    return emptyResponse(401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return emptyResponse(400);
  }

  if (!isRecord(body)) return emptyResponse();

  if (body.type === "url_verification") {
    return typeof body.challenge === "string"
      ? new Response(body.challenge, { status: 200 })
      : emptyResponse();
  }

  if (body.type !== "event_callback" || !isRecord(body.event)) {
    return emptyResponse();
  }

  const event = body.event;
  if (
    (typeof event.bot_id === "string" && event.bot_id !== "")
    || event.subtype === "bot_message"
  ) {
    return emptyResponse();
  }
  if (event.type !== "message") return emptyResponse();
  if (event.channel !== process.env.SLACK_CHANNEL_ID) return emptyResponse();
  if (
    typeof event.thread_ts !== "string"
    || typeof event.ts !== "string"
    || event.thread_ts === event.ts
  ) {
    return emptyResponse();
  }
  if (typeof event.text !== "string" || event.text.trim() === "") {
    return emptyResponse();
  }
  if (typeof body.event_id !== "string" || body.event_id === "") {
    return emptyResponse();
  }

  await getConversationStore().appendOperatorReply(
    event.thread_ts,
    event.text,
    body.event_id,
    Date.now(),
  );

  return emptyResponse();
}
