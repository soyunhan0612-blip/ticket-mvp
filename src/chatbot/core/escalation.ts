export const AUTO_REPLY_DELAY_MS = 60_000;
export const AUTO_REPLY_TEXT: string =
  "지금 바로 상담원 응대가 어렵습니다. 문의를 확인하는 대로 답변드리겠습니다.";

export interface EscalationSnapshot {
  askedAt: number;
  autoReplySentAt: number | null;
  answeredAt: number | null;
}

export function shouldSendAutoReply(
  escalation: EscalationSnapshot | null,
  now: number,
): boolean {
  if (escalation === null) return false;
  if (escalation.answeredAt !== null) return false;
  if (escalation.autoReplySentAt !== null) return false;
  if (now - escalation.askedAt < AUTO_REPLY_DELAY_MS) return false;

  return true;
}

export function isAwaitingOperator(
  escalation: EscalationSnapshot | null,
): boolean {
  return escalation !== null && escalation.answeredAt === null;
}

export const OPERATOR_HANDOFF_TEXT: string =
  "상담원에게 연결했습니다. 이제 보내는 메시지는 상담원에게 전달됩니다.";
export const OPERATOR_HANDOFF_EMPTY_SUMMARY: string =
  "손님이 대화 없이 상담원 연결을 요청했습니다.";
export const OPERATOR_SUMMARY_TURN_COUNT = 3;

const OPERATOR_SUMMARY_SEPARATOR = " | ";

/**
 * 라우팅 판정용. `isAwaitingOperator`와 달리 상담원이 답한 뒤에도 참으로 남는다.
 * 사람과 대화가 시작된 뒤에는 손님이 "새 대화"를 누르기 전까지 모델에게 되돌리지
 * 않는다.
 */
export function isOperatorMode(
  escalation: EscalationSnapshot | null,
): boolean {
  return escalation !== null;
}

export function summarizeForOperator(
  turns: ReadonlyArray<{ role: string; content: string }>,
  maxTurns: number = OPERATOR_SUMMARY_TURN_COUNT,
): string {
  const guestTurns = turns
    .filter((turn) => turn.role === "user")
    .slice(-maxTurns)
    .map((turn) => turn.content);

  if (guestTurns.length === 0) return OPERATOR_HANDOFF_EMPTY_SUMMARY;

  return guestTurns.join(OPERATOR_SUMMARY_SEPARATOR);
}
