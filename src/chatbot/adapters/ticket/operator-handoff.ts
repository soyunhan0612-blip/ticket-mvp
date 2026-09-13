import type { ConversationStore } from "@/services/conversation-store";

import {
  OPERATOR_HANDOFF_TEXT,
  isOperatorMode,
  summarizeForOperator,
} from "../../core/escalation";
import { wrapUserInput } from "../../core/sanitize";

export const OPERATOR_HANDOFF_SUMMARY_LIMIT = 1_000;

export interface OperatorHandoffDeps {
  conversationId: string;
  userId: string;
  conversationStore: Pick<
    ConversationStore,
    "get" | "appendTurns" | "startEscalation"
  >;
  postMessage: (input: {
    text: string;
    threadTs?: string;
  }) => Promise<{ ts: string }>;
  now: () => number;
}

export type OperatorHandoffResult =
  | { status: "started" }
  | { status: "already_connected" }
  | { status: "unavailable" };

export function buildHandoffMessage(input: {
  conversationId: string;
  summary: string;
}): string {
  return [
    "관람객이 상담원 연결을 직접 요청했습니다",
    `대화 ID: ${input.conversationId}`,
    "최근 문의:",
    wrapUserInput(input.summary, OPERATOR_HANDOFF_SUMMARY_LIMIT),
    "이 메시지에 스레드로 답장하면 손님 화면에 전달됩니다.",
  ].join("\n");
}

export function buildRelayMessage(message: string, limit: number): string {
  return wrapUserInput(message, limit);
}

/**
 * 손님이 버튼으로 직접 올리는 경로. 모델 툴과 같은 `startEscalation`으로
 * 수렴하되 요약을 모델에게 맡기지 않는다.
 *
 * 어떤 실패에도 throw하지 않는다. 호출자는 상태 코드만 보고 응답을 고른다.
 */
export async function startOperatorHandoff(
  deps: OperatorHandoffDeps,
): Promise<OperatorHandoffResult> {
  let ts: string;

  try {
    const conversation = await deps.conversationStore.get(
      deps.conversationId,
      deps.userId,
    );
    if (isOperatorMode(conversation.escalation)) {
      return { status: "already_connected" };
    }

    const text = buildHandoffMessage({
      conversationId: deps.conversationId,
      summary: summarizeForOperator(conversation.turns),
    });
    ts = (await deps.postMessage({ text })).ts;
  } catch {
    return { status: "unavailable" };
  }

  try {
    await deps.conversationStore.startEscalation(
      deps.conversationId,
      deps.userId,
      ts,
      deps.now(),
    );
  } catch (error) {
    // 다른 탭이 먼저 연결했다. 방금 만든 Slack 스레드는 답장받을 곳이 없는 채로
    // 남지만, 손님에게는 이미 연결된 상태가 맞다.
    if (
      error instanceof Error &&
      error.message.startsWith("ESCALATION_IN_PROGRESS")
    ) {
      return { status: "already_connected" };
    }

    return { status: "unavailable" };
  }

  try {
    await deps.conversationStore.appendTurns(deps.conversationId, deps.userId, [
      { role: "notice", content: OPERATOR_HANDOFF_TEXT },
    ]);
  } catch {
    // 안내 턴이 없어도 연결 자체는 끝났다. 배너가 상태를 대신 알려준다.
  }

  return { status: "started" };
}

/** Slack이 거절하면 `false`. 호출자는 손님 턴을 저장하지 않고 되돌린다. */
export async function relayGuestMessage(deps: {
  threadTs: string;
  message: string;
  limit: number;
  postMessage: OperatorHandoffDeps["postMessage"];
}): Promise<boolean> {
  try {
    await deps.postMessage({
      text: buildRelayMessage(deps.message, deps.limit),
      threadTs: deps.threadTs,
    });
    return true;
  } catch {
    return false;
  }
}
