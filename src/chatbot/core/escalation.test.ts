import { describe, expect, it } from "vitest";

import {
  AUTO_REPLY_DELAY_MS,
  AUTO_REPLY_TEXT,
  isAwaitingOperator,
  shouldSendAutoReply,
} from "./escalation";
import type { EscalationSnapshot } from "./escalation";

const ASKED_AT = 1_760_000_000_000;

function createEscalation(
  overrides: Partial<EscalationSnapshot> = {},
): EscalationSnapshot {
  return {
    askedAt: ASKED_AT,
    autoReplySentAt: null,
    answeredAt: null,
    ...overrides,
  };
}

describe("shouldSendAutoReply", () => {
  it("returns false when the conversation has no escalation", () => {
    expect(shouldSendAutoReply(null, ASKED_AT + AUTO_REPLY_DELAY_MS)).toBe(
      false,
    );
  });

  it("returns false when an operator has already answered", () => {
    const escalation = createEscalation({ answeredAt: ASKED_AT + 30_000 });

    expect(
      shouldSendAutoReply(escalation, ASKED_AT + AUTO_REPLY_DELAY_MS),
    ).toBe(false);
  });

  it("returns false when the automatic notice was already sent", () => {
    const escalation = createEscalation({
      autoReplySentAt: ASKED_AT + AUTO_REPLY_DELAY_MS,
    });

    expect(
      shouldSendAutoReply(escalation, ASKED_AT + AUTO_REPLY_DELAY_MS + 1),
    ).toBe(false);
  });

  it("returns false immediately before the one-minute boundary", () => {
    expect(
      shouldSendAutoReply(
        createEscalation(),
        ASKED_AT + AUTO_REPLY_DELAY_MS - 1,
      ),
    ).toBe(false);
  });

  it("returns true exactly at the one-minute boundary", () => {
    expect(
      shouldSendAutoReply(
        createEscalation(),
        ASKED_AT + AUTO_REPLY_DELAY_MS,
      ),
    ).toBe(true);
  });
});

describe("isAwaitingOperator", () => {
  it("returns false when the conversation has no escalation", () => {
    expect(isAwaitingOperator(null)).toBe(false);
  });

  it("returns true while an escalation is unanswered", () => {
    expect(isAwaitingOperator(createEscalation())).toBe(true);
  });

  it("returns false after an operator answers", () => {
    expect(
      isAwaitingOperator(createEscalation({ answeredAt: ASKED_AT + 1 })),
    ).toBe(false);
  });
});

describe("AUTO_REPLY_TEXT", () => {
  it("provides a single-paragraph delayed-response notice", () => {
    expect(AUTO_REPLY_TEXT).toBe(
      "지금 바로 상담원 응대가 어렵습니다. 문의를 확인하는 대로 답변드리겠습니다.",
    );
    expect(AUTO_REPLY_TEXT).not.toContain("\n");
  });
});
