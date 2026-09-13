import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_MESSAGE_LIMIT } from "@/chatbot/adapters/ticket/prompt";

import { ChatWidget } from "./ChatWidget";
import type { ChatTurnView } from "./use-chat";

const pathnameState = vi.hoisted(() => ({ value: "/shows" }));
// 필드마다 타입을 못박아 둔다. 훅의 반환 타입이 바뀌면 이 목이 먼저 깨져야 한다
// (`as UseChatResult`로 한 번에 캐스팅하면 send/reset의 mock 메서드를 잃는다).
const chatState = vi.hoisted(() => ({
  turns: [] as ChatTurnView[],
  isStreaming: false,
  awaitingOperator: false,
  operatorMode: false,
  isRequestingOperator: false,
  error: null as Error | null,
  send: vi.fn(async (_message: string) => true),
  requestOperator: vi.fn(async () => true),
  reset: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
}));

vi.mock("./use-chat", () => ({
  useChat: () => chatState,
}));

describe("ChatWidget", () => {
  beforeEach(() => {
    pathnameState.value = "/shows";
    chatState.turns = [];
    chatState.isStreaming = false;
    chatState.awaitingOperator = false;
    chatState.operatorMode = false;
    chatState.isRequestingOperator = false;
    chatState.error = null;
    chatState.send.mockReset();
    chatState.send.mockResolvedValue(true);
    chatState.requestOperator.mockReset();
    chatState.requestOperator.mockResolvedValue(true);
    chatState.reset.mockReset();
  });

  it("화면 오른쪽 아래 런처에 접근 가능한 텍스트 이름을 붙인다", () => {
    render(<ChatWidget />);

    expect(
      screen.getByRole("button", { name: "문의하기" }),
    ).toBeInTheDocument();
  });

  it.each(["/admin", "/admin/reports", "/seller", "/seller/new"])(
    "%s 하위에서는 렌더하지 않는다",
    (pathname) => {
      pathnameState.value = pathname;

      const { container } = render(<ChatWidget />);

      expect(container).toBeEmptyDOMElement();
    },
  );

  it("operator 턴을 상담원 텍스트 라벨과 plain text로 렌더한다", async () => {
    chatState.turns = [
      {
        id: "operator-1",
        role: "operator",
        content: '<script>alert("xss")</script> 상담원 답변',
        createdAt: 1,
      },
    ];
    const { container } = render(<ChatWidget />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(screen.getByText("상담원")).toBeInTheDocument();
    expect(
      screen.getByText('<script>alert("xss")</script> 상담원 답변'),
    ).toHaveClass("whitespace-pre-wrap");
    expect(container.querySelector("script")).toBeNull();
  });

  it("notice 턴을 안내 텍스트 라벨과 plain text로 렌더한다", async () => {
    chatState.turns = [
      {
        id: "notice-1",
        role: "notice",
        content: "1분 안에 답변이 없어 안내드립니다.\n잠시만 기다려 주세요.",
        createdAt: 1,
      },
    ];
    render(<ChatWidget />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(screen.getByText("안내")).toBeInTheDocument();
    expect(
      screen.getByText(
        /1분 안에 답변이 없어 안내드립니다\.\s+잠시만 기다려 주세요\./,
      ),
    ).toHaveClass("whitespace-pre-wrap");
  });

  it("상담원 답변을 기다리는 동안 대기 상태를 알린다", async () => {
    chatState.awaitingOperator = true;
    render(<ChatWidget />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "상담원 답변을 기다리고 있습니다.",
    );
  });

  it("전송이 실패하면 입력한 문장을 되돌린다", async () => {
    chatState.send.mockResolvedValue(false);
    render(<ChatWidget />);
    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    const input = screen.getByRole("textbox", { name: "문의 내용" });
    await userEvent.type(input, "회차가 언제인가요");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(chatState.send).toHaveBeenCalledWith("회차가 언제인가요");
    expect(input).toHaveValue("회차가 언제인가요");
  });

  it("전송에 성공하면 입력을 비운 채로 둔다", async () => {
    render(<ChatWidget />);
    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    const input = screen.getByRole("textbox", { name: "문의 내용" });
    await userEvent.type(input, "좌석이 얼마나 남았나요");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(input).toHaveValue("");
  });

  it("입력을 서버 상한으로 제한하고 남은 글자 수를 표시한다", async () => {
    render(<ChatWidget />);
    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    const input = screen.getByRole("textbox", { name: "문의 내용" });
    expect(input).toHaveAttribute("maxLength", String(CHAT_MESSAGE_LIMIT));
    expect(screen.getByText(`${CHAT_MESSAGE_LIMIT}자 남음`)).toBeInTheDocument();
  });

  it("런처 아이콘을 장식으로 두고 텍스트 라벨을 남긴다", () => {
    const { container } = render(<ChatWidget />);

    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("button", { name: "문의하기" }),
    ).toHaveTextContent("문의하기");
  });

  it("상담원 연결을 쓸 수 없으면 연결 버튼을 내보이지 않는다", async () => {
    render(<ChatWidget />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(
      screen.queryByRole("button", { name: "상담원에게 직접 문의하기" }),
    ).not.toBeInTheDocument();
  });

  it("상담원 연결 버튼을 누르면 핸드오프를 요청한다", async () => {
    render(<ChatWidget operatorHandoffEnabled />);
    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    await userEvent.click(
      screen.getByRole("button", { name: "상담원에게 직접 문의하기" }),
    );

    expect(chatState.requestOperator).toHaveBeenCalledTimes(1);
  });

  it("연결 중에는 상담원 버튼을 잠그고 진행 상태를 알린다", async () => {
    chatState.isRequestingOperator = true;
    render(<ChatWidget operatorHandoffEnabled />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(screen.getByRole("button", { name: "연결 중..." })).toBeDisabled();
  });

  it("이미 연결된 뒤에는 상담원 버튼을 감추고 입력 라벨을 바꾼다", async () => {
    chatState.operatorMode = true;
    chatState.awaitingOperator = true;
    render(<ChatWidget operatorHandoffEnabled />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(
      screen.queryByRole("button", { name: "상담원에게 직접 문의하기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "상담원에게 보낼 메시지" }),
    ).toBeInTheDocument();
  });

  it("상담원이 답한 뒤에도 사람과 연결돼 있다고 알린다", async () => {
    chatState.operatorMode = true;
    chatState.awaitingOperator = false;
    render(<ChatWidget operatorHandoffEnabled />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("상담원과 연결되어 있습니다");
    expect(status).not.toHaveTextContent("기다리고 있습니다");
  });

  it("상담원 모드에서는 전송 중 문구를 답변 대기로 쓰지 않는다", async () => {
    chatState.operatorMode = true;
    chatState.isStreaming = true;
    render(<ChatWidget operatorHandoffEnabled />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(
      screen.getByRole("button", { name: "보내는 중..." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "답변 받는 중..." }),
    ).not.toBeInTheDocument();
  });

  it("상담원 연결이 막힌 응답을 사람이 읽을 문구로 옮긴다", async () => {
    chatState.error = Object.assign(new Error("handoff disabled"), {
      status: 503,
    });
    render(<ChatWidget operatorHandoffEnabled />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "지금은 상담원 연결을 이용할 수 없습니다.",
    );
  });

  it("상담원에게 전달하지 못한 응답을 사람이 읽을 문구로 옮긴다", async () => {
    chatState.error = Object.assign(new Error("handoff unavailable"), {
      status: 502,
    });
    render(<ChatWidget operatorHandoffEnabled />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "상담원에게 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("대화가 비어 있어도 스크롤 컨테이너를 그대로 둔다", async () => {
    // 빈 상태에서 컨테이너를 떼면 첫 메시지에서 재마운트돼 ref가 끊긴다.
    const { container } = render(<ChatWidget />);

    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
  });

  it("턴이 있으면 대화 목록을 바닥으로 내린다", async () => {
    // jsdom에는 레이아웃이 없어 scrollHeight가 늘 0이다. 자동 스크롤이
    // 실제로 걸리는지 보려면 두 접근자를 대신 심어야 한다.
    const scrollHeight = vi
      .spyOn(Element.prototype, "scrollHeight", "get")
      .mockReturnValue(480);
    const scrollTop = vi.spyOn(Element.prototype, "scrollTop", "set");
    chatState.turns = [
      { id: "a1", role: "assistant", content: "답변입니다", createdAt: 1 },
    ];

    render(<ChatWidget />);
    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    expect(scrollTop).toHaveBeenCalledWith(480);

    scrollTop.mockRestore();
    scrollHeight.mockRestore();
  });
});
