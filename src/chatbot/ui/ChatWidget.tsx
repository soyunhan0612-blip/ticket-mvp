"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type JSX } from "react";

import { CHAT_MESSAGE_LIMIT } from "@/chatbot/adapters/ticket/prompt";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";

import { ChatBubbleIcon, CloseIcon, HeadsetIcon, InfoIcon } from "./icons";
import { useChat, type ChatTurnView } from "./use-chat";

const TURN_LABELS: Record<ChatTurnView["role"], string> = {
  user: "나",
  assistant: "문의 도우미",
  operator: "상담원",
  notice: "안내",
};

/** 조회 툴이 실제로 답할 수 있는 것만 고른다. 빈 화면의 설명을 대신한다. */
const SUGGESTED_QUESTIONS = [
  "공연 목록 보여주세요",
  "내 예매 내역 알려주세요",
  "환불 규정이 어떻게 되나요",
];

/** 상한이 가까울 때만 남은 글자를 알린다. 그 전에는 자리만 먹는다. */
const CHARACTER_HINT_THRESHOLD = 50;

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

/** 손님 턴은 말풍선이라 아이콘을 두지 않는다. 정렬과 표면이 이미 화자다. */
const TURN_ICONS: Record<
  Exclude<ChatTurnView["role"], "user">,
  () => JSX.Element
> = {
  assistant: ChatBubbleIcon,
  operator: HeadsetIcon,
  notice: InfoIcon,
};

/**
 * 손님과 도우미는 번갈아 나오고 정렬·표면으로 이미 갈리므로 라벨이 중복이다.
 * 상담원과 안내는 "여기서부터 사람이다"가 정보라 눈에 보이게 남긴다.
 */
function isLabelVisible(role: ChatTurnView["role"]): boolean {
  return role === "operator" || role === "notice";
}

function ChatTurn({
  isStreaming,
  turn,
}: {
  isStreaming: boolean;
  turn: ChatTurnView;
}): JSX.Element {
  if (turn.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[80%] rounded-card bg-ink px-md py-sm">
          <span className="sr-only">{TURN_LABELS.user}</span>
          <p className="whitespace-pre-wrap text-body-sm text-on-dark">
            {turn.content}
          </p>
        </div>
      </li>
    );
  }

  const TurnIcon = TURN_ICONS[turn.role];
  // 스트리밍은 빈 assistant 턴을 먼저 올리고 조각으로 채운다. 그 사이를
  // 비워 두면 아이콘만 뜬 빈 줄로 보인다.
  const isAwaitingFirstChunk =
    isStreaming && turn.role === "assistant" && turn.content === "";

  return (
    <li
      className={
        turn.role === "notice"
          ? "flex gap-sm rounded-card bg-canvas-soft p-md"
          : "flex gap-sm"
      }
    >
      <span className="mt-xxs shrink-0 text-body-aa">
        <TurnIcon />
      </span>
      <div className="min-w-0 flex-1 space-y-xxs">
        <p
          className={
            isLabelVisible(turn.role)
              ? "text-caption-upper uppercase text-body-aa"
              : "sr-only"
          }
        >
          {TURN_LABELS[turn.role]}
        </p>
        {isAwaitingFirstChunk ? (
          <p className="text-body-sm text-body-aa">답변을 쓰고 있습니다</p>
        ) : (
          <p className="whitespace-pre-wrap text-body-sm text-ink">
            {turn.content}
          </p>
        )}
      </div>
    </li>
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
      {/* 그림자를 쓰지 않으므로 헤어라인이 고정 크롬과 대화를 가른다. */}
      <header className="flex shrink-0 items-center justify-between gap-sm border-b border-hairline pb-md">
        <h2 className="truncate text-display-xs">문의하기</h2>
        <div className="flex shrink-0 items-center gap-xs">
          {operatorHandoffEnabled && !operatorMode ? (
            <Button
              disabled={isRequestingOperator || isStreaming}
              onClick={() => {
                void requestOperator();
              }}
              size="sm"
              variant="text"
            >
              {isRequestingOperator ? (
                "연결 중..."
              ) : (
                <span className="inline-flex items-center gap-xs">
                  <HeadsetIcon />
                  상담원 연결
                </span>
              )}
            </Button>
          ) : null}
          <Button
            disabled={turns.length === 0 && !error}
            onClick={reset}
            size="sm"
            variant="text"
          >
            새 대화
          </Button>
          {/* 패널 안의 좁은 컨트롤이라 아이콘만 둔다(UI_GUIDE 예외). */}
          <Button onClick={onClose} size="sm" variant="text">
            <CloseIcon />
            <span className="sr-only">닫기</span>
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
          <div className="flex h-full flex-col items-center justify-center gap-lg text-center">
            <span className="text-body-aa">
              <ChatBubbleIcon />
            </span>
            <p className="text-body-sm text-body-aa">
              공연, 회차, 좌석 현황과 내 예매를 물어볼 수 있습니다.
            </p>
            <div className="flex w-full flex-col gap-xs">
              {SUGGESTED_QUESTIONS.map((question) => (
                <Button
                  key={question}
                  onClick={() => {
                    void send(question);
                  }}
                  size="sm"
                  variant="outline-dark"
                >
                  {question}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <ol aria-label="대화 내용" className="space-y-lg">
            {turns.map((turn) => (
              <ChatTurn isStreaming={isStreaming} key={turn.id} turn={turn} />
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
          hint={
            remainingCharacters <= CHARACTER_HINT_THRESHOLD
              ? `${remainingCharacters}자 남음`
              : undefined
          }
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
