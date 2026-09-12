import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REFUND_POLICY_TEXT } from "./refund-policy";

describe("REFUND_POLICY_TEXT", () => {
  it("states only the cancellation rules implemented by the reservation store", () => {
    expect(REFUND_POLICY_TEXT).toContain("본인이 예매한 건만");
    expect(REFUND_POLICY_TEXT).toContain("예매 내역 화면에서 직접 취소");
    expect(REFUND_POLICY_TEXT).toContain("이미 취소한 예매는 다시 취소할 수 없습니다");
    expect(REFUND_POLICY_TEXT).toContain("취소 기한과 취소 수수료 규칙이 없습니다");
    expect(REFUND_POLICY_TEXT).toContain("즉시 다시 예매 가능");
    expect(REFUND_POLICY_TEXT).toContain("되돌릴 수 없습니다");
  });

  it("does not invent refund amounts, payment methods, or processing times", () => {
    expect(REFUND_POLICY_TEXT).not.toMatch(/\d+\s*(?:원|%|일|시간)/);
    expect(REFUND_POLICY_TEXT).not.toMatch(
      /환불 금액|결제 수단|카드|계좌|환불 소요|영업일/,
    );
  });

  it("fails when the memory-store cancel rule gains unreflected policy logic", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/services/reservation-store-memory.ts"),
      "utf8",
    );
    const cancelImplementation = source.match(
      /async cancel\([\s\S]*?\n {4}\},/,
    )?.[0];

    expect(cancelImplementation).toBeDefined();
    expect(cancelImplementation).not.toMatch(
      /\b(?:fee|deadline|startsAt|refund|amount|payment)\b/i,
    );
  });
});
