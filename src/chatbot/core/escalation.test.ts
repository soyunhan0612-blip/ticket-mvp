import { describe, expect, it } from "vitest";

import {
  AUTO_REPLY_DELAY_MS,
  AUTO_REPLY_TEXT,
  OPERATOR_HANDOFF_EMPTY_SUMMARY,
  OPERATOR_HANDOFF_TEXT,
  OPERATOR_SUMMARY_TURN_COUNT,
  isAwaitingOperator,
  isOperatorMode,
  shouldSendAutoReply,
  summarizeForOperator,
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

describe("isOperatorMode", () => {
  it("returns false when the conversation has no escalation", () => {
    expect(isOperatorMode(null)).toBe(false);
  });

  it("returns true while an escalation is unanswered", () => {
    expect(isOperatorMode(createEscalation())).toBe(true);
  });

  it("stays true after an operator answers", () => {
    // isAwaitingOperator와 정반대다. answeredAt은 첫 답장에서 한 번만 세팅되므로,
    // 라우팅을 isAwaitingOperator로 하면 상담원이 한 번 답한 순간 손님이 말없이
    // 모델에게 되돌아간다.
    expect(isOperatorMode(createEscalation({ answeredAt: ASKED_AT + 1 }))).toBe(
      true,
    );
  });
});

describe("summarizeForOperator", () => {
  it("falls back to a fixed notice when there is no guest turn", () => {
    expect(summarizeForOperator([])).toBe(OPERATOR_HANDOFF_EMPTY_SUMMARY);
    expect(
      summarizeForOperator([
        { role: "assistant", content: "무엇을 도와드릴까요?" },
        { role: "notice", content: "안내" },
      ]),
    ).toBe(OPERATOR_HANDOFF_EMPTY_SUMMARY);
  });

  it("keeps only guest turns", () => {
    expect(
      summarizeForOperator([
        { role: "user", content: "환불 되나요?" },
        { role: "assistant", content: "관람일 3일 전까지 가능합니다." },
        { role: "operator", content: "상담원입니다." },
        { role: "notice", content: "안내" },
      ]),
    ).toBe("환불 되나요?");
  });

  it("keeps the most recent turns up to the limit", () => {
    const summary = summarizeForOperator([
      { role: "user", content: "하나" },
      { role: "user", content: "둘" },
      { role: "user", content: "셋" },
      { role: "user", content: "넷" },
    ]);

    expect(summary).toBe("둘 | 셋 | 넷");
    expect(summary).not.toContain("하나");
  });

  it("honours an explicit turn limit", () => {
    expect(
      summarizeForOperator(
        [
          { role: "user", content: "하나" },
          { role: "user", content: "둘" },
        ],
        1,
      ),
    ).toBe("둘");
  });

  it("joins turns without newlines so the operator sees one line per handoff", () => {
    // neutralizeInput이 개행을 접으므로 구분자로 개행을 쓰면 경계가 사라진다.
    expect(
      summarizeForOperator([
        { role: "user", content: "첫 줄\n둘째 줄" },
        { role: "user", content: "다음 문의" },
      ]),
    ).toBe("첫 줄\n둘째 줄 | 다음 문의");
  });

  it("defaults to three turns", () => {
    expect(OPERATOR_SUMMARY_TURN_COUNT).toBe(3);
  });
});

describe("OPERATOR_HANDOFF_TEXT", () => {
  it("tells the guest that further messages reach a person", () => {
    expect(OPERATOR_HANDOFF_TEXT).toContain("상담원");
    expect(OPERATOR_HANDOFF_TEXT).not.toContain("\n");
  });
});
