import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * 조회 전용 어댑터만 명시적으로 검사한다. phase 16의 부작용 툴은 별도 파일로
 * 추가되므로, 디렉터리 순회 대신 이 배열을 다음 단계의 변경 지점으로 유지한다.
 */
export const TICKET_CHAT_READ_ONLY_SOURCE_PATHS = [
  "src/chatbot/adapters/ticket/deps.ts",
  "src/chatbot/adapters/ticket/prompt.ts",
  "src/chatbot/adapters/ticket/refund-policy.ts",
  "src/chatbot/adapters/ticket/tools.ts",
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
});
