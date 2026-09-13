import { describe, expect, it } from "vitest";

import {
  ESCALATION_MAX_REQUESTS,
  ESCALATION_WINDOW_MS,
  checkEscalationRateLimit,
} from "./chat-escalation-limit";

// 모듈 레벨 싱글턴이라 테스트끼리 버킷을 공유한다. userId를 매번 다르게 준다.
let userSequence = 0;
function nextUserId(): string {
  userSequence += 1;
  return `user-${userSequence}`;
}

describe("checkEscalationRateLimit", () => {
  it("allows the configured number of requests per user", () => {
    const userId = nextUserId();

    for (let attempt = 0; attempt < ESCALATION_MAX_REQUESTS; attempt += 1) {
      expect(checkEscalationRateLimit(userId).allowed).toBe(true);
    }
  });

  it("rejects the next request with a retry hint", () => {
    const userId = nextUserId();
    for (let attempt = 0; attempt < ESCALATION_MAX_REQUESTS; attempt += 1) {
      checkEscalationRateLimit(userId);
    }

    const rejected = checkEscalationRateLimit(userId);

    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs ?? 0).toBeGreaterThan(0);
    expect(rejected.retryAfterMs ?? 0).toBeLessThanOrEqual(
      ESCALATION_WINDOW_MS,
    );
  });

  it("keeps separate buckets per user", () => {
    const exhausted = nextUserId();
    for (let attempt = 0; attempt < ESCALATION_MAX_REQUESTS; attempt += 1) {
      checkEscalationRateLimit(exhausted);
    }
    expect(checkEscalationRateLimit(exhausted).allowed).toBe(false);

    expect(checkEscalationRateLimit(nextUserId()).allowed).toBe(true);
  });

  it("limits handoffs to three per hour", () => {
    expect(ESCALATION_MAX_REQUESTS).toBe(3);
    expect(ESCALATION_WINDOW_MS).toBe(60 * 60_000);
  });
});
