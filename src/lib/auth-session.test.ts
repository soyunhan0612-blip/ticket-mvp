import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeBasicCredentials } from "@/lib/basic-auth";

/*
 * vi.mock의 팩토리는 import보다 먼저 실행되므로 AUTH_COOKIE_NAME을 직접 참조할 수
 * 없다. 쿠키 이름을 문자열로 두는 대신 vi.hoisted로 상태만 끌어올린다.
 */
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "sellerAdminAuth" && state.cookie !== undefined
          ? { name, value: state.cookie }
          : undefined,
    }),
}));

const { isOperatorSession } = await import("@/lib/auth-session");

describe("isOperatorSession", () => {
  beforeEach(() => {
    process.env.BASIC_AUTH_USER = "operator";
    process.env.BASIC_AUTH_PASS = "secret";
    state.cookie = undefined;
  });

  afterEach(() => {
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASS;
  });

  it("자격증명이 일치하는 쿠키면 true다", async () => {
    state.cookie = encodeBasicCredentials("operator", "secret");

    await expect(isOperatorSession()).resolves.toBe(true);
  });

  it("쿠키가 없으면 false다", async () => {
    await expect(isOperatorSession()).resolves.toBe(false);
  });

  it("자격증명이 다른 쿠키면 false다", async () => {
    state.cookie = encodeBasicCredentials("operator", "wrong");

    await expect(isOperatorSession()).resolves.toBe(false);
  });

  it("환경변수가 비어 있으면 쿠키가 있어도 false다", async () => {
    // 미들웨어와 같은 규칙 — 설정되지 않은 자격증명은 닫히는 방향으로 실패한다.
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASS;
    state.cookie = encodeBasicCredentials("operator", "secret");

    await expect(isOperatorSession()).resolves.toBe(false);
  });
});
