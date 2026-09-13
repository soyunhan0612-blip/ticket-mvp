import { createRateLimiter } from "./rate-limit";

export const ESCALATION_WINDOW_MS = 60 * 60_000;
export const ESCALATION_MAX_REQUESTS = 3;

// 상담원 연결 진입점은 둘이다. 모델이 부르는 escalate_to_human 툴(/api/chat)과
// 손님이 직접 누르는 버튼(/api/chat/handoff). 두 라우트가 각자 리미터를 들면
// 한도가 시간당 6회로 불어나므로 버킷을 여기 하나로 모은다. route.ts는 헬퍼를
// export할 수 없어(next build가 깨진다) 공유 지점이 lib에 있어야 한다.
const escalationRateLimiter = createRateLimiter({
  windowMs: ESCALATION_WINDOW_MS,
  maxRequests: ESCALATION_MAX_REQUESTS,
});

/** 호출할 때마다 한 칸을 소모한다. 경로당 정확히 한 번만 부른다. */
export function checkEscalationRateLimit(
  userId: string,
): { allowed: boolean; retryAfterMs?: number } {
  return escalationRateLimiter.check(userId);
}
