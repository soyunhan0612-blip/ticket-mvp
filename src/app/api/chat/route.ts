import { z } from "zod";

import { createEscalationTool } from "@/chatbot/adapters/ticket/escalation-tool";
import {
  CHAT_MAX_ITERATIONS,
  CHAT_MAX_TOKENS,
  CHAT_MESSAGE_LIMIT,
  CHAT_MODEL,
  buildTicketChatFallback,
  buildTicketChatSystemPrompt,
} from "@/chatbot/adapters/ticket/prompt";
import { relayGuestMessage } from "@/chatbot/adapters/ticket/operator-handoff";
import { createTicketChatTools } from "@/chatbot/adapters/ticket/tools";
import { createChatStream } from "@/chatbot/core/engine";
import { isOperatorMode } from "@/chatbot/core/escalation";
import { createTextStream } from "@/chatbot/core/fallback";
import { wrapUserInput } from "@/chatbot/core/sanitize";
import type { ChatHistoryTurn } from "@/chatbot/core/types";
import { getUserIdFromRequest } from "@/lib/cookie";
import { checkEscalationRateLimit } from "@/lib/chat-escalation-limit";
import { createRateLimiter } from "@/lib/rate-limit";
import { hasSlackConfig, postSlackMessage } from "@/lib/slack-client";
import {
  getConversationStore,
  getReservationStore,
  getSeatStore,
  getShowStore,
} from "@/services";
import type { Conversation } from "@/types";

const requestBodySchema = z.object({
  conversationId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  message: z.string().trim().min(1).max(CHAT_MESSAGE_LIMIT),
});

const ipRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
});

const userRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
});

const responseHeaders = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache",
};

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function parseRequestBody(request: Request) {
  try {
    return requestBodySchema.safeParse(await request.json());
  } catch {
    return requestBodySchema.safeParse(undefined);
  }
}

function rateLimitResponse(retryAfterMs: number | undefined): Response {
  return new Response("요청이 너무 많습니다.", {
    status: 429,
    headers: {
      ...responseHeaders,
      "Retry-After": String(Math.ceil((retryAfterMs ?? 1) / 1_000)),
    },
  });
}

function conversationErrorResponse(error: unknown): Response | null {
  if (!(error instanceof Error)) return null;
  if (error.message.startsWith("NOT_FOUND:")) {
    return new Response("대화를 찾을 수 없습니다.", {
      status: 404,
      headers: responseHeaders,
    });
  }
  if (error.message.startsWith("FORBIDDEN:")) {
    return new Response("접근 권한이 없습니다.", {
      status: 403,
      headers: responseHeaders,
    });
  }

  return null;
}

function createHistory(conversation: Conversation): ChatHistoryTurn[] {
  return conversation.turns.flatMap((turn): ChatHistoryTurn[] => {
    if (turn.role === "user") {
      return [{
        role: "user",
        content: wrapUserInput(turn.content, CHAT_MESSAGE_LIMIT),
      }];
    }
    if (turn.role === "assistant") {
      return [{ role: "assistant", content: turn.content }];
    }
    return [];
  });
}

function persistAssistantAnswer(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  userId: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let answer = "";

  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      answer += decoder.decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    async flush() {
      answer += decoder.decode();
      // 클라이언트가 스트림 도중 연결을 닫으면 flush가 실행되지 않아 답변 턴이
      // 저장되지 않을 수 있다. 다음 요청의 연속 user 턴은 Messages API가 합치므로 허용한다.
      try {
        await getConversationStore().appendTurns(conversationId, userId, [
          { role: "assistant", content: answer },
        ]);
      } catch {
        // 저장 실패로 flush가 reject하면 readable이 error로 닫혀, 답변을 이미 다 받은
        // 클라이언트까지 네트워크 오류를 보게 된다. 전달을 저장보다 우선한다.
      }
    },
  }));
}

export async function POST(request: Request): Promise<Response> {
  const ipRateLimit = ipRateLimiter.check(getClientIp(request));
  if (!ipRateLimit.allowed) {
    return rateLimitResponse(ipRateLimit.retryAfterMs);
  }

  const parsed = await parseRequestBody(request);
  if (!parsed.success) {
    return new Response("잘못된 요청입니다.", {
      status: 400,
      headers: responseHeaders,
    });
  }

  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return new Response("인증이 필요합니다.", {
      status: 401,
      headers: responseHeaders,
    });
  }

  const userRateLimit = userRateLimiter.check(userId);
  if (!userRateLimit.allowed) {
    return rateLimitResponse(userRateLimit.retryAfterMs);
  }

  const conversationStore = getConversationStore();
  let conversation: Conversation;
  try {
    conversation = parsed.data.conversationId
      ? await conversationStore.get(parsed.data.conversationId, userId)
      : await conversationStore.create(userId);
  } catch (error) {
    const response = conversationErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const headers = {
    ...responseHeaders,
    "X-Conversation-Id": conversation.id,
  };

  // 상담원과 연결된 대화는 모델을 거치지 않는다. 상담원이 한 번 답한 뒤에도
  // 마찬가지다. 손님을 사람과의 대화 도중에 말없이 봇으로 되돌리지 않는다.
  const operatorThreadTs = conversation.escalation?.slackThreadTs;
  if (
    isOperatorMode(conversation.escalation) &&
    typeof operatorThreadTs === "string" &&
    operatorThreadTs !== ""
  ) {
    const delivered = await relayGuestMessage({
      threadTs: operatorThreadTs,
      message: parsed.data.message,
      limit: CHAT_MESSAGE_LIMIT,
      postMessage: postSlackMessage,
    });
    // Slack이 받지 못한 문장은 저장하지도 않는다. 위젯이 입력을 되돌려 다시 친다.
    if (!delivered) {
      return new Response("상담원에게 전달하지 못했습니다.", {
        status: 502,
        headers,
      });
    }

    await conversationStore.appendTurns(conversation.id, userId, [
      { role: "user", content: parsed.data.message },
    ]);

    return new Response(null, {
      headers: { ...headers, "X-Chat-Route": "operator" },
    });
  }

  try {
    conversation = await conversationStore.appendTurns(
      conversation.id,
      userId,
      [{ role: "user", content: parsed.data.message }],
    );
  } catch (error) {
    const response = conversationErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    const fallback = buildTicketChatFallback();
    await conversationStore.appendTurns(conversation.id, userId, [
      { role: "notice", content: fallback },
    ]);

    return new Response(createTextStream(fallback), { headers });
  }

  const canEscalate = hasSlackConfig();
  const tools = createTicketChatTools({
    showStore: getShowStore(),
    seatStore: getSeatStore(),
    reservationStore: getReservationStore(),
    userId,
  });
  if (canEscalate) {
    tools.push(createEscalationTool({
      conversationId: conversation.id,
      userId,
      conversationStore,
      postMessage: postSlackMessage,
      canEscalateNow: () => checkEscalationRateLimit(userId).allowed,
      now: () => Date.now(),
    }));
  }

  const stream = createChatStream({
    apiKey,
    model: CHAT_MODEL,
    maxTokens: CHAT_MAX_TOKENS,
    maxIterations: CHAT_MAX_ITERATIONS,
    systemPrompt: buildTicketChatSystemPrompt({ canEscalate }),
    tools,
    history: createHistory(conversation),
  });

  return new Response(
    persistAssistantAnswer(stream, conversation.id, userId),
    { headers },
  );
}
