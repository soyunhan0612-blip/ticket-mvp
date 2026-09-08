import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperationsPanel } from "./OperationsPanel";

const OPERATIONS_RESPONSE = {
  sessions: [
    {
      showId: "show-1",
      showTitle: "첫 번째 공연",
      sessionId: "session-1",
      startsAt: "2026-09-08T10:00:00.000Z",
      total: 2_000,
      available: 1_495,
      held: 5,
      sold: 500,
      salesRate: 25,
    },
    {
      showId: "show-2",
      showTitle: "두 번째 공연",
      sessionId: "session-2",
      startsAt: "2026-09-09T10:00:00.000Z",
      total: 1_000,
      available: 98,
      held: 2,
      sold: 900,
      salesRate: 90,
    },
  ],
};

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPanel(showId = ""): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <OperationsPanel showId={showId} />
    </QueryClientProvider>,
  );
}

function createStreamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  return new Response(stream);
}

describe("OperationsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("응답의 모든 회차와 판매율을 렌더한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(OPERATIONS_RESPONSE),
    );

    renderPanel();

    expect(await screen.findByText("첫 번째 공연")).toBeInTheDocument();
    expect(screen.getByText("두 번째 공연")).toBeInTheDocument();
    expect(screen.getByText("25.0%")).toBeInTheDocument();
    expect(screen.getByText("90.0%")).toBeInTheDocument();
  });

  it("showId가 빈 문자열이면 요청 URL에 포함하지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ sessions: [] }),
    );

    renderPanel("");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/operations");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("showId");
  });

  it("401 응답이면 로그인 만료 문구를 보인다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "로그인이 만료되었습니다. 다시 로그인해 주세요.",
    );
    expect(
      screen.getByRole("button", { name: "다시 로그인" }),
    ).toBeInTheDocument();
  });

  it("요약 스트림의 여러 조각을 누적해 렌더한다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(OPERATIONS_RESPONSE))
      .mockResolvedValueOnce(
        createStreamingResponse(["판매율이 가장 높은 ", "회차는 두 번째 공연입니다."]),
      );
    const user = userEvent.setup();

    renderPanel();
    await screen.findByText("첫 번째 공연");
    await user.click(screen.getByRole("button", { name: "운영 현황 요약" }));

    expect(
      await screen.findByText(
        "판매율이 가장 높은 회차는 두 번째 공연입니다.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/ai-summary",
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
  });

  it("요약 스트림이 빈 채로 끝나면 실패 문구를 보인다", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(OPERATIONS_RESPONSE))
      .mockResolvedValueOnce(createStreamingResponse([]));
    const user = userEvent.setup();

    renderPanel();
    await screen.findByText("첫 번째 공연");
    await user.click(screen.getByRole("button", { name: "운영 현황 요약" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "운영 요약을 생성하지 못했습니다.",
    );
  });

  it("요약의 HTML 문자열을 실행하지 않고 plain text로 렌더한다", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(OPERATIONS_RESPONSE))
      .mockResolvedValueOnce(
        createStreamingResponse(['<script>alert("xss")</script>']),
      );
    const user = userEvent.setup();

    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <OperationsPanel showId="show-1" />
      </QueryClientProvider>,
    );
    await screen.findByText("첫 번째 공연");
    await user.click(screen.getByRole("button", { name: "운영 현황 요약" }));

    expect(
      await screen.findByText('<script>alert("xss")</script>'),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("요약 도중 공연이 바뀌면 이전 필터의 조각을 쌓지 않는다", async () => {
    let releaseLateChunk!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLateChunk = resolve;
    });
    const encoder = new TextEncoder();
    const gatedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("이전 필터의 조각. "));
        await gate;
        controller.enqueue(encoder.encode("늦게-도착한-조각"));
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("ai-summary")
          ? new Response(gatedStream)
          : Response.json(OPERATIONS_RESPONSE),
      ),
    );
    const user = userEvent.setup();
    const queryClient = createQueryClient();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <OperationsPanel showId="" />
      </QueryClientProvider>,
    );
    await screen.findByText("첫 번째 공연");
    await user.click(screen.getByRole("button", { name: "운영 현황 요약" }));
    await screen.findByText("이전 필터의 조각.");

    rerender(
      <QueryClientProvider client={queryClient}>
        <OperationsPanel showId="show-1" />
      </QueryClientProvider>,
    );
    releaseLateChunk();

    /* 요약이 끝나야(버튼이 다시 활성화돼야) 늦은 조각의 도착 여부를 판정할 수 있다 */
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "운영 현황 요약" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByText(/늦게-도착한-조각/)).not.toBeInTheDocument();
    expect(screen.queryByText(/이전 필터의 조각/)).not.toBeInTheDocument();
  });
});
