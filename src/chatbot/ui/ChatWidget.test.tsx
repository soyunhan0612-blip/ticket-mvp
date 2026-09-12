import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_MESSAGE_LIMIT } from "@/chatbot/adapters/ticket/prompt";

import { ChatWidget } from "./ChatWidget";

const pathnameState = vi.hoisted(() => ({ value: "/shows" }));
const chatState = vi.hoisted(() => ({
  turns: [],
  isStreaming: false,
  awaitingOperator: false,
  error: null,
  send: vi.fn(),
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

  it("입력을 서버 상한으로 제한하고 남은 글자 수를 표시한다", async () => {
    render(<ChatWidget />);
    await userEvent.click(screen.getByRole("button", { name: "문의하기" }));

    const input = screen.getByRole("textbox", { name: "문의 내용" });
    expect(input).toHaveAttribute("maxLength", String(CHAT_MESSAGE_LIMIT));
    expect(screen.getByText(`${CHAT_MESSAGE_LIMIT}자 남음`)).toBeInTheDocument();
  });
});
