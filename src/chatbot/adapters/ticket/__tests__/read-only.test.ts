import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * 조회 전용 어댑터만 명시적으로 검사한다. phase 16의 부작용 툴은 별도 파일로
 * 추가되므로, 디렉터리 순회 대신 이 배열을 다음 단계의 변경 지점으로 유지한다.
 */
export const TICKET_CHAT_READ_ONLY_SOURCE_PATHS = [
  "src/chatbot/adapters/ticket/conversation-view.ts",
  "src/chatbot/adapters/ticket/deps.ts",
  "src/chatbot/adapters/ticket/prompt.ts",
  "src/chatbot/adapters/ticket/refund-policy.ts",
  "src/chatbot/adapters/ticket/tools.ts",
] as const;

// 아래 두 파일은 Slack 전송과 startEscalation이라는 허용된 부작용을 가지므로
// 위 조회 전용 배열에서 명시적으로 제외하고 아래에서 별도로 검사한다.
const TICKET_CHAT_ESCALATION_SOURCE_PATHS = [
  "src/chatbot/adapters/ticket/escalation-tool.ts",
  "src/chatbot/adapters/ticket/operator-handoff.ts",
] as const;

const FORBIDDEN_WRITE_IDENTIFIERS = [
  "hold",
  "release",
  "confirmSeats",
  "releaseSold",
  "revertSold",
  "cancel",
  "create",
  "getSeatStore",
  "getShowStore",
  "getReservationStore",
] as const;

describe("ticket chat read-only boundary", () => {
  it("does not reference write methods or bypass the injected stores", () => {
    for (const modulePath of TICKET_CHAT_READ_ONLY_SOURCE_PATHS) {
      const source = readFileSync(resolve(process.cwd(), modulePath), "utf8");

      for (const identifier of FORBIDDEN_WRITE_IDENTIFIERS) {
        expect(source).not.toMatch(new RegExp(`\\b${identifier}\\b`));
      }
    }
  });

  it("limits the escalation paths to Slack and conversation escalation effects", () => {
    const forbiddenIdentifiers = [
      "hold",
      "confirmSeats",
      "releaseSold",
      "revertSold",
      "cancel",
      "getSeatStore",
      "getShowStore",
      "getReservationStore",
    ] as const;

    for (const modulePath of TICKET_CHAT_ESCALATION_SOURCE_PATHS) {
      const source = readFileSync(resolve(process.cwd(), modulePath), "utf8");

      for (const identifier of forbiddenIdentifiers) {
        expect(source).not.toMatch(new RegExp(`\\b${identifier}\\b`));
      }
      expect(source).toContain("postMessage");
      expect(source).toContain("startEscalation");
    }
  });
});
