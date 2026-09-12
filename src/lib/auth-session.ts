import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME, verifyBasicAuthCookie } from "@/lib/basic-auth";

/*
 * 서버 컴포넌트에서 운영자 로그인 여부를 읽는다. 판정은 미들웨어와 같은 함수에
 * 위임한다 — 화면이 자기 규칙을 따로 가지면 게이트와 메뉴가 어긋난다.
 *
 * 쿠키만 본다. 미들웨어는 `Authorization` 헤더도 받지만 그 경로는 심사자용 curl을
 * 위한 것이고, curl은 네비게이션을 렌더하지 않는다.
 *
 * 이 함수를 부르는 세그먼트는 동적 렌더가 된다. 메뉴가 로그인 상태에 따라 달라지는
 * 이상 프리렌더된 HTML을 재사용할 수 없으므로 피할 수 없는 비용이다.
 */
export async function isOperatorSession(): Promise<boolean> {
  const cookieStore = await cookies();

  return verifyBasicAuthCookie(
    cookieStore.get(AUTH_COOKIE_NAME)?.value,
    process.env.BASIC_AUTH_USER,
    process.env.BASIC_AUTH_PASS,
  ).authenticated;
}
