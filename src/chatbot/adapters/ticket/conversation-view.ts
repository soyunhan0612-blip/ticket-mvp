import {
  isAwaitingOperator,
  isOperatorMode,
} from "@/chatbot/core/escalation";
import type { EscalationSnapshot } from "@/chatbot/core/escalation";
import type { ChatTurn, Conversation } from "@/types";

export interface ConversationSnapshotResponse {
  conversation: {
    id: string;
    turns: ChatTurn[];
    updatedAt: number;
  };
  awaitingOperator: boolean;
  operatorMode: boolean;
}

export function toEscalationSnapshot(
  conversation: Conversation,
): EscalationSnapshot | null {
  const escalation = conversation.escalation;
  if (escalation === null) return null;

  // slackThreadTs는 여기서 끊는다. core도, 응답도 스레드 식별자를 보면 안 된다.
  return {
    askedAt: escalation.askedAt,
    autoReplySentAt: escalation.autoReplySentAt,
    answeredAt: escalation.answeredAt,
  };
}

/**
 * 화이트리스트로 재구성한다. Conversation에 필드가 더 붙어도 여기에 적지 않는
 * 한 응답에 실리지 않는다.
 */
export function toConversationSnapshotResponse(
  conversation: Conversation,
): ConversationSnapshotResponse {
  const escalation = toEscalationSnapshot(conversation);

  return {
    conversation: {
      id: conversation.id,
      turns: conversation.turns,
      updatedAt: conversation.updatedAt,
    },
    awaitingOperator: isAwaitingOperator(escalation),
    operatorMode: isOperatorMode(escalation),
  };
}
