import { describe, expect, it } from "vitest";

import {
  encodeBasicCredentials,
  isProtectedApiPath,
  isProtectedPath,
  verifyBasicAuth,
  verifyBasicAuthCookie,
} from "@/lib/basic-auth";

function basicAuthorization(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

describe("verifyBasicAuth", () => {
  it("올바른 credentials의 Authorization 헤더를 통과시킨다", () => {
    expect(verifyBasicAuth(basicAuthorization("seller", "secret"), "seller", "secret")).toEqual({
      authenticated: true,
    });
  });

  it("잘못된 비밀번호를 거부한다", () => {
    expect(verifyBasicAuth(basicAuthorization("seller", "wrong"), "seller", "secret")).toEqual({
      authenticated: false,
    });
  });

  it("Authorization 헤더가 없으면 거부한다", () => {
    expect(verifyBasicAuth(null, "seller", "secret")).toEqual({ authenticated: false });
  });

  it("Basic 이외의 인증 스킴을 거부한다", () => {
    expect(verifyBasicAuth("Bearer token", "seller", "secret")).toEqual({ authenticated: false });
  });

  it("잘못된 base64 인코딩을 거부한다", () => {
    expect(verifyBasicAuth("Basic !!!not-base64!!!", "seller", "secret")).toEqual({
      authenticated: false,
    });
  });

  it.each([
    [undefined, "secret"],
    ["seller", undefined],
  ])("expected credential이 undefined면 거부한다", (expectedUser, expectedPass) => {
    expect(
      verifyBasicAuth(basicAuthorization("seller", "secret"), expectedUser, expectedPass),
    ).toEqual({ authenticated: false });
  });

  it("expectedUser가 빈 문자열이면 거부한다", () => {
    expect(verifyBasicAuth(basicAuthorization("", "secret"), "", "secret")).toEqual({
      authenticated: false,
    });
  });

  it("expectedPass가 빈 문자열이면 거부한다", () => {
    expect(verifyBasicAuth(basicAuthorization("seller", ""), "seller", "")).toEqual({
      authenticated: false,
    });
  });

  it("빈 사용자명과 빈 비밀번호를 담은 Basic 인증을 거부한다", () => {
    expect(verifyBasicAuth("Basic Og==", "", "")).toEqual({ authenticated: false });
  });
});

describe("encodeBasicCredentials", () => {
  it("user:password를 base64로 인코딩한다", () => {
    expect(encodeBasicCredentials("seller", "secret")).toBe(
      Buffer.from("seller:secret").toString("base64"),
    );
  });

  it("verifyBasicAuth가 그대로 검증할 수 있는 값을 만든다", () => {
    expect(
      verifyBasicAuth(
        `Basic ${encodeBasicCredentials("seller", "secret")}`,
        "seller",
        "secret",
      ),
    ).toEqual({ authenticated: true });
  });

  /*
   * 경계는 첫 콜론이므로 비밀번호에 콜론이 들어가도 왕복한다.
   * 반대 방향(사용자명에 콜론이 있는 입력)까지 막아 주지는 않는다 —
   * 그러려면 user:pass 전체 문자열을 이미 알아야 해서 권한 상승은 아니다.
   */
  it("비밀번호에 콜론이 있어도 왕복한다", () => {
    expect(
      verifyBasicAuth(
        `Basic ${encodeBasicCredentials("seller", "a:b:c")}`,
        "seller",
        "a:b:c",
      ),
    ).toEqual({ authenticated: true });
  });
});

describe("verifyBasicAuthCookie", () => {
  it("올바른 자격증명을 담은 쿠키를 통과시킨다", () => {
    expect(
      verifyBasicAuthCookie(
        encodeBasicCredentials("seller", "secret"),
        "seller",
        "secret",
      ),
    ).toEqual({ authenticated: true });
  });

  it("잘못된 비밀번호를 거부한다", () => {
    expect(
      verifyBasicAuthCookie(
        encodeBasicCredentials("seller", "wrong"),
        "seller",
        "secret",
      ),
    ).toEqual({ authenticated: false });
  });

  it.each([undefined, ""])("쿠키가 없으면 거부한다 (%s)", (cookieValue) => {
    expect(verifyBasicAuthCookie(cookieValue, "seller", "secret")).toEqual({
      authenticated: false,
    });
  });

  it("base64가 아닌 쿠키 값을 거부한다", () => {
    expect(verifyBasicAuthCookie("!!!not-base64!!!", "seller", "secret")).toEqual(
      { authenticated: false },
    );
  });

  it("쿠키 값에 스킴이 이미 붙어 있으면 거부한다", () => {
    expect(
      verifyBasicAuthCookie(
        `Basic ${encodeBasicCredentials("seller", "secret")}`,
        "seller",
        "secret",
      ),
    ).toEqual({ authenticated: false });
  });

  /*
   * 헤더 경로의 fail-closed 규칙(README "빈 문자열 자격증명으로 Basic Auth가 뚫리던 결함")이
   * 쿠키 경로에서도 유지되는지 못박는다. 저장 위치가 바뀌었을 뿐 정책은 같아야 한다.
   */
  it.each([
    [undefined, "secret"],
    ["seller", undefined],
    ["", "secret"],
    ["seller", ""],
    ["", ""],
  ])(
    "환경변수가 %s/%s면 올바른 쿠키라도 거부한다",
    (expectedUser, expectedPass) => {
      expect(
        verifyBasicAuthCookie(
          encodeBasicCredentials(expectedUser ?? "", expectedPass ?? ""),
          expectedUser,
          expectedPass,
        ),
      ).toEqual({ authenticated: false });
    },
  );
});

describe("isProtectedApiPath", () => {
  it.each(["/api/admin", "/api/admin/stats"])(
    "%s를 API 경로로 본다",
    (pathname) => {
      expect(isProtectedApiPath(pathname)).toBe(true);
    },
  );

  it.each(["/admin", "/admin/dashboard", "/seller/new", "/api/shows"])(
    "%s를 API 경로로 보지 않는다",
    (pathname) => {
      expect(isProtectedApiPath(pathname)).toBe(false);
    },
  );
});

describe("isProtectedPath", () => {
  it.each([
    "/seller/new",
    "/admin",
    "/admin/dashboard",
    "/api/admin",
    "/api/admin/stats",
  ])("%s를 보호한다", (pathname) => {
    expect(isProtectedPath(pathname)).toBe(true);
  });

  it.each(["/shows", "/api/shows", "/api/holds"])(
    "%s를 보호하지 않는다",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(false);
    },
  );
});
