import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OPS_AGENT_ERROR } from "@/components/admin/admin-query";

import { OpsAgentPanel } from "./OpsAgentPanel";

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

function renderPanel(showId = "") {
  return render(<OpsAgentPanel showId={showId} />);
}

async function submitQuestion(question: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "운영 질문" }), question);
  await user.click(screen.getByRole("button", { name: "질문 보내기" }));
}

describe("OpsAgentPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("질문이 비어 있거나 공백뿐이면 전송 버튼을 비활성한다", async () => {
    const user = userEvent.setup();

    renderPanel();

    const button = screen.getByRole("button", { name: "질문 보내기" });
    expect(button).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "운영 질문" }), "   ");
    expect(button).toBeDisabled();
  });

  it("질문을 넣으면 Agent API를 POST로 호출하고 바디에 질문을 담는다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(createStreamingResponse(["답변"]));

    renderPanel();
    await submitQuestion("판매율이 가장 높은 회차는?");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/agent",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "판매율이 가장 높은 회차는?" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ["", { question: "현재 운영 현황을 알려줘" }],
    ["show-1", { question: "현재 운영 현황을 알려줘", showId: "show-1" }],
  ])(
    "showId가 '%s'일 때 필요한 필터만 요청 바디에 담는다",
    async (showId, expectedBody) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(createStreamingResponse(["답변"]));

      renderPanel(showId);
      await submitQuestion("현재 운영 현황을 알려줘");

      const requestInit = fetchMock.mock.calls[0]?.[1];
      expect(JSON.parse(String(requestInit?.body))).toEqual(expectedBody);
    },
  );

  it("스트림의 여러 텍스트 조각을 누적해 plain text로 렌더한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createStreamingResponse(["판매율이 가장 높은 ", "회차는 첫 번째 공연입니다."]),
    );

    const { container } = renderPanel();
    await submitQuestion("가장 많이 팔린 회차는?");

    expect(
      await screen.findByText(
        "판매율이 가장 높은 회차는 첫 번째 공연입니다.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("0바이트 스트림이 끝나면 기존 실패 문구를 보인다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createStreamingResponse([]));

    renderPanel();
    await submitQuestion("운영 현황을 알려줘");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      OPS_AGENT_ERROR,
    );
  });

  it("401 응답이면 UnauthorizedNotice의 문구를 보인다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    renderPanel();
    await submitQuestion("운영 현황을 알려줘");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "로그인이 만료되었습니다. 다시 로그인해 주세요.",
    );
    expect(
      screen.getByRole("button", { name: "다시 로그인" }),
    ).toBeInTheDocument();
  });

  it("요청 중에는 진행 상태를 표시하고 전송 버튼을 비활성한다", async () => {
    let releaseAnswer!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAnswer = resolve;
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await gate;
        controller.enqueue(encoder.encode("답변 완료"));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream));

    renderPanel();
    await submitQuestion("운영 현황을 알려줘");

    expect(
      screen.getByRole("button", { name: "답변 생성 중..." }),
    ).toBeDisabled();

    releaseAnswer();
    expect(await screen.findByText("답변 완료")).toBeInTheDocument();
  });

  it("답변 도중 showId가 바뀌면 이전 답변과 에러를 남기지 않는다", async () => {
    let releaseLateChunk!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLateChunk = resolve;
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("이전 필터의 답변. "));
        await gate;
        controller.enqueue(encoder.encode("늦게-도착한-답변"));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream));

    const { rerender } = renderPanel();
    await submitQuestion("운영 현황을 알려줘");
    await screen.findByText("이전 필터의 답변.");

    rerender(<OpsAgentPanel showId="show-1" />);
    releaseLateChunk();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "질문 보내기" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByText(/이전 필터의 답변/)).not.toBeInTheDocument();
    expect(screen.queryByText(/늦게-도착한-답변/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
