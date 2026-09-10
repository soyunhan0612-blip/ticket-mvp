/*
 * 세션이 만료되면 미들웨어가 401을 준다. 데이터 오류와 뭉뚱그리면 같은 문구만
 * 반복되고 다시 로그인할 길이 없다 — 인증 실패는 따로 구분한다.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("로그인이 만료되었습니다.");
    this.name = "UnauthorizedError";
  }
}

const DEFAULT_RETRY_COUNT = 3;

/*
 * 인증이 끊긴 요청은 재시도해도 401이다. Tanstack Query 기본값(3회)에 맡기면
 * 지수 백오프까지 기다린 뒤에야 만료 안내가 떠서, 그동안 사용자는 원인을 모른 채
 * 멈춘 화면을 본다. 그 밖의 실패는 일시적일 수 있으므로 기본 횟수를 유지한다.
 */
export function retryUnlessUnauthorized(
  failureCount: number,
  error: Error,
): boolean {
  if (error instanceof UnauthorizedError) return false;

  return failureCount < DEFAULT_RETRY_COUNT;
}
