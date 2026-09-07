import { afterEach, describe, expect, it } from "vitest";

import { getSeatStore, getShowStore } from "@/services";

import { POST } from "./route";

function makeRequest(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/admin/ai-summary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

async function createSummarySession() {
  const result = await getShowStore().create({
    title: `운영 요약 ${crypto.randomUUID()}`,
    description: "운영 요약 라우트 테스트",
    posterUrl: "/posters/concert.svg",
    presetId: "small",
    sessions: ["2026-12-20T10:00:00.000Z"],
  });

  return { show: result.show, session: result.sessions[0] };
}

describe("POST /api/admin/ai-summary", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("streams a 200 fallback summary when the API key is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { show } = await createSummarySession();

    const response = await POST(
      makeRequest({ showId: show.id }, `fallback-${crypto.randomUUID()}`),
    );
    const summary = await response.text();

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(summary).toContain(show.title);
    expect(summary).toContain("전체 500석");
  });

  it("ignores client-provided metrics and summarizes only server aggregates", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { show, session } = await createSummarySession();
    const owner = `summary-owner-${crypto.randomUUID()}`;
    await getSeatStore().hold(session.id, ["A-1-1", "A-1-2"], owner);
    await getSeatStore().confirmSeats(session.id, ["A-1-2"], owner);

    const response = await POST(
      makeRequest(
        {
          showId: show.id,
          total: 999_999,
          available: 888_888,
          held: 777_777,
          sold: 666_666,
          salesRate: 555_555,
        },
        `forged-metrics-${crypto.randomUUID()}`,
      ),
    );
    const summary = await response.text();

    expect(response.status).toBe(200);
    expect(summary).toContain("전체 500석");
    expect(summary).toContain("예매 가능 498석");
    expect(summary).toContain("홀드 1석");
    expect(summary).toContain("판매 완료 1석");
    expect(summary).toContain("판매율 0.2%");
    expect(summary).not.toMatch(/999999|888888|777777|666666|555555/);
  });

  it("returns 400 for an invalid body", async () => {
    const response = await POST(
      makeRequest({ date: "2026-02-30" }, `invalid-${crypto.randomUUID()}`),
    );

    expect(response.status).toBe(400);
  });

  it("returns 429 with Retry-After on the fourth request from one IP", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const ip = `rate-limit-${crypto.randomUUID()}`;

    await POST(makeRequest({}, ip));
    await POST(makeRequest({}, ip));
    await POST(makeRequest({}, ip));
    const response = await POST(makeRequest({}, ip));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
