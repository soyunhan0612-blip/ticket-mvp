"use client";

import { usePathname } from "next/navigation";
import { useState, type JSX } from "react";

import { CHAT_MESSAGE_LIMIT } from "@/chatbot/adapters/ticket/prompt";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";

import { useChat, type ChatTurnView } from "./use-chat";

const TURN_LABELS: Record<ChatTurnView["role"], string> = {
  user: "나",
  assistant: "문의 도우미",
  operator: "상담원",
  notice: "안내",
};

function isOperatorPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/seller" ||
    pathname.startsWith("/seller/")
  );
}

function getErrorStatus(error: Error): number | undefined {
  if (!("status" in error)) return undefined;

  const status = error.status;
  return typeof status === "number" ? status : undefined;
}

function getErrorMessage(error: Error): string {
  switch (getErrorStatus(error)) {
    case 400:
      return "문의 내용을 확인해 주세요.";
    case 401:
      return "문의 기능을 사용하려면 페이지를 새로고침해 주세요.";
    case 403:
    case 404:
      return "이 대화를 이어갈 수 없습니다. 새 대화를 시작해 주세요.";
    case 429:
      return "문의가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return "답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

function ChatPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [message, setMessage] = useState("");
  const {
    turns,
    isStreaming,
    awaitingOperator,
    error,
    send,
    reset,
  } = useChat({ messageLimit: CHAT_MESSAGE_LIMIT });
  const remainingCharacters = CHAT_MESSAGE_LIMIT - message.length;

  return (
    <Card
      aria-label="문의하기"
      className="fixed inset-x-lg bottom-3xl z-40 flex max-h-[calc(100vh-4rem)] flex-col gap-lg sm:left-auto sm:right-lg sm:w-full sm:max-w-md"
      role="region"
    >
      <header className="flex items-start justify-between gap-md">
        <div className="space-y-xs">
          <h2 className="text-display-xs">문의하기</h2>
          <p className="text-body-sm text-body-aa">
            공연과 예매에 관해 물어보세요.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-xs">
          <Button
            disabled={turns.length === 0 && !error}
            onClick={reset}
            size="sm"
            variant="text"
          >
            새 대화
          </Button>
          <Button onClick={onClose} size="sm" variant="text">
            닫기
          </Button>
        </div>
      </header>

      {turns.length === 0 ? (
        <p className="rounded-card bg-canvas-soft p-md text-body-sm text-body-aa">
          공연, 회차, 좌석 현황과 내 예매를 물어볼 수 있습니다.
        </p>
      ) : (
        <ol
          aria-label="대화 내용"
          className="min-h-0 flex-1 space-y-md overflow-y-auto"
        >
          {turns.map((turn) => (
            <li
              className={
                turn.role === "notice"
                  ? "space-y-xs rounded-card bg-canvas-soft p-md"
                  : "space-y-xs border-b border-hairline pb-md last:border-b-0 last:pb-0"
              }
              key={turn.id}
            >
              <p className="text-caption-upper uppercase text-body-aa">
                {TURN_LABELS[turn.role]}
              </p>
              <p className="whitespace-pre-wrap text-body-sm text-ink">
                {turn.content}
              </p>
            </li>
          ))}
        </ol>
      )}

      {awaitingOperator ? (
        <p
          className="rounded-card bg-canvas-soft p-md text-body-sm text-ink"
          role="status"
        >
          상담원 답변을 기다리고 있습니다.
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-card bg-primary p-md text-body-sm text-on-primary"
          role="alert"
        >
          {getErrorMessage(error)}
        </p>
      ) : null}

      <form
        className="space-y-md"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedMessage = message.trim();
          if (normalizedMessage.length === 0 || isStreaming) return;

          // 낙관적으로 비우되, 손님 턴이 화면에 오르지 못한 실패는 되돌린다.
          // 그러지 않으면 429·500에서 친 문장이 어디에도 남지 않는다.
          setMessage("");
          void send(normalizedMessage).then((sent) => {
            if (!sent) setMessage(normalizedMessage);
          });
        }}
      >
        <TextInput
          autoComplete="off"
          hint={`${remainingCharacters}자 남음`}
          id="chat-message"
          label="문의 내용"
          maxLength={CHAT_MESSAGE_LIMIT}
          onChange={(event) => setMessage(event.target.value)}
          value={message}
        />
        <Button
          className="w-full"
          disabled={isStreaming || message.trim().length === 0}
          size="sm"
          type="submit"
        >
          {isStreaming ? "답변 받는 중..." : "보내기"}
        </Button>
      </form>
    </Card>
  );
}

export function ChatWidget(): JSX.Element | null {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  if (isOperatorPath(pathname)) return null;

  if (isOpen) {
    return <ChatPanel onClose={() => setIsOpen(false)} />;
  }

  return (
    <Button
      className="fixed bottom-3xl right-lg z-40"
      onClick={() => setIsOpen(true)}
      size="sm"
      variant="outline-dark"
    >
      문의하기
    </Button>
  );
}
