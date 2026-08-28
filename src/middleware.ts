import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_COOKIE_NAME,
  isProtectedApiPath,
  isProtectedPath,
  verifyBasicAuth,
  verifyBasicAuthCookie,
} from "@/lib/basic-auth";
import { USER_ID_COOKIE_NAME } from "@/lib/cookie";

const USER_ID_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/*
 * 쿠키가 먼저, Authorization 헤더가 그다음이다.
 * 헤더 경로를 남겨두는 이유는 README의 심사자용 `curl -u`가 그대로 살아 있어야 하기
 * 때문이다. WWW-Authenticate를 응답에 싣지 않으므로 브라우저는 헤더를 지원한다는
 * 사실을 모르고, 따라서 네이티브 로그인 프롬프트도 뜨지 않는다.
 */
function isAuthenticated(request: NextRequest): boolean {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  return (
    verifyBasicAuthCookie(request.cookies.get(AUTH_COOKIE_NAME)?.value, user, pass)
      .authenticated ||
    verifyBasicAuth(request.headers.get("authorization"), user, pass).authenticated
  );
}

/** 익명 UUID 쿠키는 응답 종류와 무관하게 유지돼야 한다 (로그인 화면에서도 마찬가지). */
function withUserIdCookie(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  if (request.cookies.has(USER_ID_COOKIE_NAME)) {
    return response;
  }

  response.cookies.set(USER_ID_COOKIE_NAME, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: USER_ID_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !isAuthenticated(request)) {
    // API는 모달을 띄울 자리가 없다. 화면 없이 상태만 돌려준다.
    if (isProtectedApiPath(pathname)) {
      return withUserIdCookie(
        request,
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      );
    }

    /*
     * 리다이렉트가 아니라 리라이트다. 주소창이 원래 경로로 남으므로 로그인 후
     * router.refresh() 한 번이면 같은 URL에서 실제 화면이 렌더된다 —
     * 되돌아갈 경로를 쿼리로 실어 나를 필요가 없고, 그래서 오픈 리다이렉트도 없다.
     */
    return withUserIdCookie(
      request,
      NextResponse.rewrite(new URL("/login", request.url)),
    );
  }

  return withUserIdCookie(request, NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
