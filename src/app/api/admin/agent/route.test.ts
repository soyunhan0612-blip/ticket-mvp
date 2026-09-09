import { afterEach, describe, expect, it } from "vitest";

import { AGENT_QUESTION_LIMIT } from "@/lib/ops-agent";
import { getSeatStore, getShowStore } from "@/services";

import { POST } from "./route";

function makeRequest(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/admin/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

async function createAgentSession() {
  const result = await getShowStore().create({
    title: `운영 Agent ${crypto.randomUUID()}`,
    description: "운영 Agent 라우트 테스트",
    posterUrl: "/posters/concert.svg",
    presetId: "small",
    sessions: ["2026-12-20T10:00:00.000Z"],
  });

  return { show: result.show, session: result.sessions[0] };
}

describe("POST /api/admin/agent", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("streams a 200 fallback with server aggregates when the API key is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { show } = await createAgentSession();

    const response = await POST(
      makeRequest(
        { question: "현재 좌석 현황을 알려줘", showId: show.id },
        `fallback-${crypto.randomUUID()}`,
      ),
    );
    const answer = await response.text();

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(answer).toContain("AI 키가 설정되지 않아 질문에 답할 수 없습니다.");
    expect(answer).toContain(show.title);
    expect(answer).toContain("전체 500석");
  });

  it("ignores client-provided metrics and reports only server aggregates", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { show, session } = await createAgentSession();
    const owner = `agent-owner-${crypto.randomUUID()}`;
    await getSeatStore().hold(session.id, ["A-1-1", "A-1-2"], owner);
    await getSeatStore().confirmSeats(session.id, ["A-1-2"], owner);

    const response = await POST(
      makeRequest(
        {
          question: "이 공연의 운영 현황은?",
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
    const answer = await response.text();

    expect(response.status).toBe(200);
    expect(answer).toContain("전체 500석");
    expect(answer).toContain("예매 가능 498석");
    expect(answer).toContain("홀드 1석");
    expect(answer).toContain("판매 완료 1석");
    expect(answer).toContain("판매율 0.2%");
    expect(answer).not.toMatch(/999999|888888|777777|666666|555555/);
  });

  it("returns 400 when question is missing or exceeds the configured limit", async () => {
    const missing = await POST(
      makeRequest({}, `missing-question-${crypto.randomUUID()}`),
    );
    const tooLong = await POST(
      makeRequest(
        { question: "가".repeat(AGENT_QUESTION_LIMIT + 1) },
        `long-question-${crypto.randomUUID()}`,
      ),
    );

    expect(missing.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  it("returns 429 with Retry-After on the fourth request from one IP", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const ip = `rate-limit-${crypto.randomUUID()}`;
    const body = { question: "전체 운영 현황을 알려줘" };

    await POST(makeRequest(body, ip));
    await POST(makeRequest(body, ip));
    await POST(makeRequest(body, ip));
    const response = await POST(makeRequest(body, ip));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
