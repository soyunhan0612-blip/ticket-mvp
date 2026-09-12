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
