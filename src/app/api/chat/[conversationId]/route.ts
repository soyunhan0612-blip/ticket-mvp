import {
  AUTO_REPLY_TEXT,
  isAwaitingOperator,
  shouldSendAutoReply,
} from "@/chatbot/core/escalation";
import type { EscalationSnapshot } from "@/chatbot/core/escalation";
import { getUserIdFromRequest } from "@/lib/cookie";
import { createRateLimiter } from "@/lib/rate-limit";
import { getConversationStore } from "@/services";
import type { Conversation } from "@/types";

export const dynamic = "force-dynamic";

const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
});

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function sanitizeConversation(conversation: Conversation) {
  // 화이트리스트로 재구성한다. phase 16이 Conversation에 필드를 더해도
  // 여기에 적지 않는 한 응답에 실리지 않는다.
  return {
    id: conversation.id,
    turns: conversation.turns,
    updatedAt: conversation.updatedAt,
  };
}

function toEscalationSnapshot(
  conversation: Conversation,
): EscalationSnapshot | null {
  const escalation = conversation.escalation;
  if (escalation === null) return null;

  return {
    askedAt: escalation.askedAt,
    autoReplySentAt: escalation.autoReplySentAt,
    answeredAt: escalation.answeredAt,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rateLimit = rateLimiter.check(getClientIp(request));
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rateLimit.retryAfterMs ?? 1) / 1_000),
          ),
        },
      },
    );
  }

  const { conversationId } = await context.params;
  try {
    const conversationStore = getConversationStore();
    let conversation = await conversationStore.get(
      conversationId,
      userId,
    );
    let escalation = toEscalationSnapshot(conversation);
    const now = Date.now();

    if (shouldSendAutoReply(escalation, now)) {
      const claimed = await conversationStore.markAutoReplySent(
        conversationId,
        userId,
        now,
      );
      if (claimed) {
        // 이 표시와 턴 추가 사이에 인스턴스가 종료되면 안내 턴 없이 표시만
        // 남을 수 있다. 드문 저피해 실패 창으로 허용한다.
        conversation = await conversationStore.appendTurns(
          conversationId,
          userId,
          [{ role: "notice", content: AUTO_REPLY_TEXT }],
        );
      } else {
        conversation = await conversationStore.get(conversationId, userId);
      }
      escalation = toEscalationSnapshot(conversation);
    }

    return Response.json({
      conversation: sanitizeConversation(conversation),
      awaitingOperator: isAwaitingOperator(escalation),
    });
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
}
