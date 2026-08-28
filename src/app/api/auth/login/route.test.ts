import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUTH_COOKIE_NAME, encodeBasicCredentials } from "@/lib/basic-auth";

import { POST } from "./route";

function makeRequest(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  const originalUser = process.env.BASIC_AUTH_USER;
  const originalPass = process.env.BASIC_AUTH_PASS;

  beforeEach(() => {
    process.env.BASIC_AUTH_USER = "seller";
    process.env.BASIC_AUTH_PASS = "secret";
  });

  afterEach(() => {
    if (originalUser === undefined) {
      delete process.env.BASIC_AUTH_USER;
    } else {
      process.env.BASIC_AUTH_USER = originalUser;
    }
    if (originalPass === undefined) {
      delete process.env.BASIC_AUTH_PASS;
    } else {
      process.env.BASIC_AUTH_PASS = originalPass;
    }
  });

  it("올바른 자격증명이면 HTTP-only 인증 쿠키를 세팅한다", async () => {
    const response = await POST(
      makeRequest({ username: "seller", password: "secret" }, "login-ok-ip"),
    );

    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(
      `${AUTH_COOKIE_NAME}=${encodeBasicCredentials("seller", "secret")}`,
    );
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it("잘못된 비밀번호는 401이고 쿠키를 세팅하지 않는다", async () => {
    const response = await POST(
      makeRequest({ username: "seller", password: "wrong" }, "login-bad-ip"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("존재하지 않는 사용자명도 같은 401 메시지로 답한다", async () => {
    const wrongUser = await POST(
      makeRequest({ username: "nobody", password: "secret" }, "login-user-ip"),
    );
    const wrongPass = await POST(
      makeRequest({ username: "seller", password: "wrong" }, "login-pass-ip"),
    );

    expect(wrongUser.status).toBe(401);
    expect(await wrongUser.text()).toBe(await wrongPass.text());
  });

  /*
   * README에 결함 서사로 남아 있는 fail-closed 규칙. 자격증명이 설정되지 않았을 때
   * 로그인 폼이 열리는 방향으로 실패하면 미들웨어를 고쳐둔 의미가 사라진다.
   */
  it.each([
    [["BASIC_AUTH_USER"]],
    [["BASIC_AUTH_PASS"]],
    // .env.example을 복사만 하고 채우지 않은 상태 — fail-closed 서사의 원래 대상이다.
    [["BASIC_AUTH_USER", "BASIC_AUTH_PASS"]],
  ])("%s가 없으면 어떤 입력도 401이다", async (missing) => {
    for (const name of missing) delete process.env[name];

    const response = await POST(
      makeRequest(
        { username: "seller", password: "secret" },
        `login-missing-${missing.join("-")}`,
      ),
    );

    expect(response.status).toBe(401);
  });

  it("빈 문자열 자격증명으로는 통과할 수 없다", async () => {
    process.env.BASIC_AUTH_USER = "";
    process.env.BASIC_AUTH_PASS = "";

    const response = await POST(
      makeRequest({ username: "", password: "" }, "login-empty-ip"),
    );

    expect(response.status).toBe(401);
  });

  it("username이나 password가 없으면 400이다", async () => {
    const response = await POST(
      makeRequest({ username: "seller" }, "login-invalid-ip"),
    );

    expect(response.status).toBe(400);
  });

  it("한 IP에서 6번째 시도는 429이고 Retry-After를 준다", async () => {
    const ip = "login-rate-limit-ip";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await POST(makeRequest({ username: "seller", password: "wrong" }, ip));
    }
    const response = await POST(
      makeRequest({ username: "seller", password: "secret" }, ip),
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
