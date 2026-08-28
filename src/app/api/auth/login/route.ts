import { z } from "zod";

import {
  AUTH_COOKIE_NAME,
  encodeBasicCredentials,
  verifyBasicAuth,
} from "@/lib/basic-auth";
import { createRateLimiter } from "@/lib/rate-limit";

const requestBodySchema = z.object({
  username: z.string().max(200),
  password: z.string().max(200),
});

/*
 * 공개 URL에서 자격증명을 대조하므로 무차별 대입 속도를 묶는다.
 * AI 라우트와 같은 인메모리 리미터라 서버리스 인스턴스별로 동작한다 —
 * 완전한 방어가 아니라 브라우저 한 대의 반복 시도를 늦추는 용도다.
 */
const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
});

/*
 * Basic Auth는 브라우저를 닫을 때까지 자격증명을 들고 있었다. 쿠키로 옮기면서
 * 수명을 12시간으로 못박는다 — 관리 화면 세션이 익명 userId 쿠키(30일)만큼
 * 오래 남을 이유가 없다.
 */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function parseRequestBody(request: Request) {
  try {
    return requestBodySchema.safeParse(await request.json());
  } catch {
    return requestBodySchema.safeParse(undefined);
  }
}

function serializeAuthCookie(value: string): string {
  const attributes = [
    `${AUTH_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export async function POST(request: Request): Promise<Response> {
  const rateLimit = rateLimiter.check(getClientIp(request));
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1) / 1_000)),
        },
      },
    );
  }

  const parsed = await parseRequestBody(request);
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const credentials = encodeBasicCredentials(username, password);
  const result = verifyBasicAuth(
    `Basic ${credentials}`,
    process.env.BASIC_AUTH_USER,
    process.env.BASIC_AUTH_PASS,
  );

  // 사용자명 오류와 비밀번호 오류를 구분하지 않는다 — 어느 쪽이 맞았는지 알려주면
  // 계정 하나짜리 구조에서 사용자명을 확정해 주는 셈이 된다.
  if (!result.authenticated) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": serializeAuthCookie(credentials) } },
  );
}
