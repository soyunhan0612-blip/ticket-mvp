import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelloutAlertPanel } from "./SelloutAlertPanel";

const ALERT_TEXT = [
  "매진 임박: 두 번째 공연 · 시작 2026-09-09T10:00:00.000Z · 판매율 95.0% · 남은 좌석 48석",
  "매진 임박: 첫 번째 공연 · 시작 2026-09-08T10:00:00.000Z · 판매율 91.0% · 남은 좌석 175석",
].join("\n");

const ALERT_RESPONSE = {
  threshold: 90,
  sessions: [
    {
      showId: "show-2",
      showTitle: "두 번째 공연",
      sessionId: "session-2",
      startsAt: "2026-09-09T10:00:00.000Z",
      total: 1_000,
      available: 48,
      held: 2,
      sold: 950,
      salesRate: 95,
    },
    {
      showId: "show-1",
      showTitle: "첫 번째 공연",
      sessionId: "session-1",
      startsAt: "2026-09-08T10:00:00.000Z",
      total: 2_000,
      available: 175,
      held: 5,
      sold: 1_820,
      salesRate: 91,
    },
  ],
  text: ALERT_TEXT,
};

/** 대상이 없을 때 서버가 돌려주는 모양. 빈 문자열이 n8n의 IF를 false로 만든다. */
const SILENT_RESPONSE = { threshold: 90, sessions: [], text: "" };

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPanel(showId = ""): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <SelloutAlertPanel showId={showId} />
    </QueryClientProvider>,
  );
}

describe("SelloutAlertPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("기본 임계값으로 조회하고 대상 회차를 렌더한다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(ALERT_RESPONSE));

    renderPanel();

    expect(await screen.findByText("두 번째 공연")).toBeInTheDocument();
    expect(screen.getByText("95.0%")).toBeInTheDocument();
    expect(screen.getByText("기준 90% 이상 · 대상 2건")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/alerts/sellout?threshold=90",
    );
  });

  it("공연 필터가 있으면 쿼리에 실린다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(ALERT_RESPONSE));

    renderPanel("show-2");

    await screen.findByText("두 번째 공연");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/alerts/sellout?threshold=90&showId=show-2",
    );
  });

  it("대상이 없으면 정상 침묵임을 알리고 전송 문장을 렌더하지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(SILENT_RESPONSE),
    );

    renderPanel();

    expect(await screen.findByText(/정상 침묵/)).toBeInTheDocument();
    expect(screen.getByText("기준 90% 이상 · 대상 0건")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Slack으로 보낼 문장" }),
    ).not.toBeInTheDocument();
  });

  it("임계값을 바꿔 제출하면 새 임계값으로 다시 조회한다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(SILENT_RESPONSE))
      .mockResolvedValueOnce(Response.json({ ...ALERT_RESPONSE, threshold: 0 }));
    const user = userEvent.setup();

    renderPanel();
    await screen.findByText(/정상 침묵/);

    const thresholdInput = screen.getByLabelText("판매율 임계값 (%)");
    await user.clear(thresholdInput);
    await user.type(thresholdInput, "0");
    await user.click(screen.getByRole("button", { name: "알림 조회" }));

    expect(await screen.findByText("두 번째 공연")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/admin/alerts/sellout?threshold=0",
    );
    // 화면의 기준은 입력값이 아니라 서버가 확정해 돌려준 값이다.
    expect(screen.getByText("기준 0% 이상 · 대상 2건")).toBeInTheDocument();
  });

  it("401이면 다시 로그인 안내를 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );

    renderPanel();

    expect(
      await screen.findByRole("button", { name: "다시 로그인" }),
    ).toBeInTheDocument();
  });

  it("서버가 거절하면 실패 문구를 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "invalid query" }, { status: 400 }),
    );

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "매진 임박 현황을 불러오지 못했습니다.",
    );
  });

  it("전송 문장을 줄바꿈을 유지한 일반 텍스트로 렌더한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(ALERT_RESPONSE),
    );

    renderPanel();

    const heading = await screen.findByRole("heading", {
      name: "Slack으로 보낼 문장",
    });
    const paragraph = heading.nextElementSibling;

    expect(paragraph).toHaveClass("whitespace-pre-wrap");
    expect(paragraph?.textContent).toBe(ALERT_TEXT);
  });
});
