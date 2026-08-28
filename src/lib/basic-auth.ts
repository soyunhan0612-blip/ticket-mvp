export interface BasicAuthResult {
  authenticated: boolean;
}

const UNAUTHENTICATED: BasicAuthResult = { authenticated: false };

/**
 * 로그인 폼이 발급하는 HTTP-only 쿠키 이름.
 * 브라우저 인증 캐시가 하던 일을 그대로 옮겨온 것이라 값도 Basic 스킴의 base64 그대로다.
 */
export const AUTH_COOKIE_NAME = "sellerAdminAuth";

export function verifyBasicAuth(
  authorizationHeader: string | null,
  expectedUser: string | undefined,
  expectedPass: string | undefined,
): BasicAuthResult {
  if (
    !authorizationHeader ||
    expectedUser === undefined ||
    expectedUser === "" ||
    expectedPass === undefined ||
    expectedPass === ""
  ) {
    return UNAUTHENTICATED;
  }

  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorizationHeader);
  if (!match) return UNAUTHENTICATED;

  const encoded = match[1];
  if (encoded.length % 4 !== 0) return UNAUTHENTICATED;

  const decoded = Buffer.from(encoded, "base64").toString();
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return UNAUTHENTICATED;

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return { authenticated: user === expectedUser && password === expectedPass };
}

export function encodeBasicCredentials(user: string, password: string): string {
  return Buffer.from(`${user}:${password}`).toString("base64");
}

/*
 * 쿠키 값을 Basic 스킴으로 되감아 verifyBasicAuth에 위임한다. base64 형식 검사와
 * "설정되지 않은 자격증명은 닫히는 방향으로 실패한다" 규칙을 한 곳에만 두기 위해서다 —
 * 저장 위치가 브라우저 인증 캐시에서 쿠키로 바뀌었을 뿐 정책은 같아야 한다.
 */
export function verifyBasicAuthCookie(
  cookieValue: string | undefined,
  expectedUser: string | undefined,
  expectedPass: string | undefined,
): BasicAuthResult {
  if (!cookieValue) return UNAUTHENTICATED;

  return verifyBasicAuth(`Basic ${cookieValue}`, expectedUser, expectedPass);
}

/** 보호 경로 중 API. 미인증 응답을 401 JSON으로 줄지 로그인 화면으로 줄지 가른다. */
export function isProtectedApiPath(pathname: string): boolean {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export function isProtectedPath(pathname: string): boolean {
  return (
    isProtectedApiPath(pathname) ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/seller" ||
    pathname.startsWith("/seller/")
  );
}
