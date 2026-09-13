import { z } from "zod";

import { toConversationSnapshotResponse } from "@/chatbot/adapters/ticket/conversation-view";
import { startOperatorHandoff } from "@/chatbot/adapters/ticket/operator-handoff";
import { isOperatorMode } from "@/chatbot/core/escalation";
import { checkEscalationRateLimit } from "@/lib/chat-escalation-limit";
import { getUserIdFromRequest } from "@/lib/cookie";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasSlackConfig, postSlackMessage } from "@/lib/slack-client";
import { getConversationStore } from "@/services";
import type { Conversation } from "@/types";

const requestBodySchema = z.object({
  conversationId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
});

const ipRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
});

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function parseRequestBody(request: Request) {
  try {
    return requestBodySchema.safeParse(await request.json());
  } catch {
    // 본문 없는 POST도 "새 대화로 상담원 연결"이라는 뜻으로 받는다.
    return requestBodySchema.safeParse({});
  }
}

export async function POST(request: Request): Promise<Response> {
  const ipRateLimit = ipRateLimiter.check(getClientIp(request));
  if (!ipRateLimit.allowed) {
    return Response.json(
      { error: "too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((ipRateLimit.retryAfterMs ?? 1) / 1_000),
          ),
        },
      },
    );
  }

  const parsed = await parseRequestBody(request);
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!hasSlackConfig()) {
    return Response.json({ error: "handoff disabled" }, { status: 503 });
  }

  const conversationStore = getConversationStore();
  let conversation: Conversation;
  try {
    conversation = parsed.data.conversationId
      ? await conversationStore.get(parsed.data.conversationId, userId)
      : await conversationStore.create(userId);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith("NOT_FOUND:")) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (error.message.startsWith("FORBIDDEN:")) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
    }
    throw error;
  }

  // 이미 연결된 대화를 다시 눌렀다. 시간당 한도를 쓰지 않고 스냅샷만 돌려준다.
  // 클라이언트가 409에 할 수 있는 유일하게 옳은 일이 재동기화이므로 그것을 바로 준다.
  if (isOperatorMode(conversation.escalation)) {
    return Response.json(toConversationSnapshotResponse(conversation));
  }

  const escalationRateLimit = checkEscalationRateLimit(userId);
  if (!escalationRateLimit.allowed) {
    return Response.json(
      { error: "too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((escalationRateLimit.retryAfterMs ?? 1) / 1_000),
          ),
        },
      },
    );
  }

  const result = await startOperatorHandoff({
    conversationId: conversation.id,
    userId,
    conversationStore,
    postMessage: (input) => postSlackMessage(input),
    now: () => Date.now(),
  });

  if (result.status === "unavailable") {
    return Response.json({ error: "handoff unavailable" }, { status: 502 });
  }

  return Response.json(
    toConversationSnapshotResponse(
      await conversationStore.get(conversation.id, userId),
    ),
  );
}
