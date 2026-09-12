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
  error: null as Error | null,
  send: vi.fn(async (_message: string) => true),
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
    chatState.error = null;
    chatState.send.mockReset();
    chatState.send.mockResolvedValue(true);
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
});
