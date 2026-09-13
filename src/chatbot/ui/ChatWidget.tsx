"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type JSX } from "react";

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
    case 502:
      return "상담원에게 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    case 503:
      return "지금은 상담원 연결을 이용할 수 없습니다.";
    default:
      return "답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

// DS는 아이콘 세트를 주지 않는다(UI_GUIDE). 인라인 SVG를 쓰되 둥근 배경으로
// 감싸지 않고 텍스트 라벨과 함께만 쓴다.
function ChatBubbleIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path d="M20 4.75H4a1.25 1.25 0 0 0-1.25 1.25v9.5A1.25 1.25 0 0 0 4 16.75h3.25v3.5l4.2-3.5H20a1.25 1.25 0 0 0 1.25-1.25V6A1.25 1.25 0 0 0 20 4.75Z" />
    </svg>
  );
}

function ChatPanel({
  onClose,
  operatorHandoffEnabled,
}: {
  onClose: () => void;
  operatorHandoffEnabled: boolean;
}): JSX.Element {
  const [message, setMessage] = useState("");
  const {
    turns,
    isStreaming,
    awaitingOperator,
    operatorMode,
    isRequestingOperator,
    error,
    send,
    requestOperator,
    reset,
  } = useChat({ messageLimit: CHAT_MESSAGE_LIMIT });
  const remainingCharacters = CHAT_MESSAGE_LIMIT - message.length;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 턴과 스트리밍 청크마다 바닥에 붙인다. 손님이 위로 읽는 중일 때 멈추는
  // 로직은 알고 뺐다 — 되돌릴 어포던스(배지)를 못 쓰는 자리라 반쪽만 만들면
  // 새 답변이 온 줄도 모른 채 멈춘 화면을 보게 된다.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns]);

  return (
    <Card
      aria-label="문의하기"
      className="fixed inset-x-lg bottom-3xl z-40 flex h-[30rem] max-h-[calc(100dvh-5rem)] flex-col gap-lg sm:left-auto sm:right-lg sm:w-full sm:max-w-md"
      role="region"
    >
      <header className="flex shrink-0 items-start justify-between gap-md">
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

      {/* 스크롤 컨테이너는 항상 마운트해 둔다. 빈 상태와 목록을 갈아끼우면
          첫 메시지에서 재마운트돼 ref가 끊긴다. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        ref={scrollRef}
      >
        {turns.length === 0 ? (
          <p className="rounded-card bg-canvas-soft p-md text-body-sm text-body-aa">
            공연, 회차, 좌석 현황과 내 예매를 물어볼 수 있습니다.
          </p>
        ) : (
          <ol aria-label="대화 내용" className="space-y-md">
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
      </div>

      {awaitingOperator || operatorMode ? (
        <p
          className="shrink-0 rounded-card bg-canvas-soft p-md text-body-sm text-ink"
          role="status"
        >
          {awaitingOperator
            ? "상담원 답변을 기다리고 있습니다."
            : "상담원과 연결되어 있습니다. 보내는 메시지는 상담원에게 전달됩니다."}
        </p>
      ) : null}

      {error ? (
        <p
          className="shrink-0 rounded-card bg-primary p-md text-body-sm text-on-primary"
          role="alert"
        >
          {getErrorMessage(error)}
        </p>
      ) : null}

      {operatorHandoffEnabled && !operatorMode ? (
        <Button
          className="w-full shrink-0"
          disabled={isRequestingOperator || isStreaming}
          onClick={() => {
            void requestOperator();
          }}
          size="sm"
          variant="outline-dark"
        >
          {isRequestingOperator ? "연결 중..." : "상담원에게 직접 문의하기"}
        </Button>
      ) : null}

      <form
        className="shrink-0 space-y-md"
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
          label={operatorMode ? "상담원에게 보낼 메시지" : "문의 내용"}
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
          {isStreaming
            ? operatorMode
              ? "보내는 중..."
              : "답변 받는 중..."
            : "보내기"}
        </Button>
      </form>
    </Card>
  );
}

export function ChatWidget({
  operatorHandoffEnabled = false,
}: {
  /**
   * Slack 자격 증명은 서버에만 있다. RSC가 `hasSlackConfig()`를 읽어 내려주고,
   * 위젯은 늘 503을 받는 죽은 버튼을 그리지 않는다.
   */
  operatorHandoffEnabled?: boolean;
} = {}): JSX.Element | null {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  if (isOperatorPath(pathname)) return null;

  if (isOpen) {
    return (
      <ChatPanel
        onClose={() => setIsOpen(false)}
        operatorHandoffEnabled={operatorHandoffEnabled}
      />
    );
  }

  return (
    <Button
      className="fixed bottom-3xl right-lg z-40"
      onClick={() => setIsOpen(true)}
      size="sm"
      variant="outline-dark"
    >
      <span className="inline-flex items-center gap-xs">
        <ChatBubbleIcon />
        문의하기
      </span>
    </Button>
  );
}
