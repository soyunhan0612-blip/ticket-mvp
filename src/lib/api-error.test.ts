import { describe, expect, it } from "vitest";

import { UnauthorizedError, retryUnlessUnauthorized } from "./api-error";

describe("UnauthorizedError", () => {
  it("이름으로 다른 실패와 구분된다", () => {
    const error = new UnauthorizedError();

    expect(error.name).toBe("UnauthorizedError");
    expect(error.message).toBe("로그인이 만료되었습니다.");
    expect(error instanceof Error).toBe(true);
  });
});

describe("retryUnlessUnauthorized", () => {
  it("인증이 끊긴 요청은 재시도하지 않는다", () => {
    expect(retryUnlessUnauthorized(0, new UnauthorizedError())).toBe(false);
  });

  it("그 밖의 실패는 기본 횟수만큼 재시도한다", () => {
    const error = new Error("운영 현황을 불러오지 못했습니다.");

    expect(retryUnlessUnauthorized(0, error)).toBe(true);
    expect(retryUnlessUnauthorized(2, error)).toBe(true);
    expect(retryUnlessUnauthorized(3, error)).toBe(false);
  });
});
