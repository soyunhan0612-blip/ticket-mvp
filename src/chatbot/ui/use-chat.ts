"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ChatTurnView {
  id: string;
  role: "user" | "assistant" | "operator" | "notice";
  content: string;
  createdAt: number;
}

export interface UseChatOptions {
  sendPath?: string;
  conversationPath?: (conversationId: string) => string;
  messageLimit: number;
}

export interface UseChatResult {
  turns: ChatTurnView[];
  isStreaming: boolean;
  awaitingOperator: boolean;
  error: Error | null;
  /**
   * 손님 턴이 화면에 올라가기 전에 실패하면 `false`를 돌려준다. 친 문장이 어디에도
   * 남지 않은 상태이므로, 호출자는 이 값을 보고 입력을 되돌려야 한다.
   */
  send: (message: string) => Promise<boolean>;
  reset: () => void;
}

interface ConversationResponse {
  conversation: {
    id: string;
    turns: ChatTurnView[];
    updatedAt: number;
  };
  awaitingOperator: boolean;
}

export const CHAT_CONVERSATION_STORAGE_KEY = "chat-conversation-id";
export const CHAT_REFETCH_INTERVAL = 3_000;

const DEFAULT_SEND_PATH = "/api/chat";
const defaultConversationPath = (conversationId: string): string =>
  `/api/chat/${conversationId}`;

let localTurnSequence = 0;

export class ChatHttpError extends Error {
  readonly status: number;

  constructor(status: number, message = `Chat request failed (${status})`) {
    super(message);
    this.name = "ChatHttpError";
    this.status = status;
  }
}

function createLocalTurnId(role: "user" | "assistant"): string {
  localTurnSequence += 1;
  return `local-${role}-${Date.now()}-${localTurnSequence}`;
}

function readStoredConversationId(): string | null {
  try {
    return window.sessionStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeConversationId(conversationId: string): void {
  try {
    window.sessionStorage.setItem(
      CHAT_CONVERSATION_STORAGE_KEY,
      conversationId,
    );
  } catch {
    // 사생활 보호 모드에서는 sessionStorage 자체가 예외를 던질 수 있다.
  }
}

function removeStoredConversationId(): void {
  try {
    window.sessionStorage.removeItem(CHAT_CONVERSATION_STORAGE_KEY);
  } catch {
    // 저장소를 쓸 수 없어도 현재 탭의 대화 상태는 초기화할 수 있다.
  }
}

async function createGetError(response: Response): Promise<ChatHttpError> {
  let message: string | undefined;

  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // GET 계약이 깨져도 상태 코드는 보존해 호출자가 문구를 고를 수 있게 한다.
  }

  return new ChatHttpError(response.status, message);
}

async function fetchConversation(
  path: string,
  signal: AbortSignal,
): Promise<ConversationResponse> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw await createGetError(response);

  return (await response.json()) as ConversationResponse;
}

function isMissingConversation(error: unknown): boolean {
  return (
    error instanceof ChatHttpError &&
    (error.status === 403 || error.status === 404)
  );
}

export function useChat(options: UseChatOptions): UseChatResult {
  const [turns, setTurns] = useState<ChatTurnView[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [awaitingOperator, setAwaitingOperator] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendPathRef = useRef(options.sendPath ?? DEFAULT_SEND_PATH);
  const conversationPathRef = useRef(
    options.conversationPath ?? defaultConversationPath,
  );
  const messageLimitRef = useRef(options.messageLimit);

  sendPathRef.current = options.sendPath ?? DEFAULT_SEND_PATH;
  conversationPathRef.current =
    options.conversationPath ?? defaultConversationPath;
  messageLimitRef.current = options.messageLimit;

  useEffect(() => {
    const storedConversationId = readStoredConversationId();
    let restoreController: AbortController | null = null;

    if (storedConversationId) {
      conversationIdRef.current = storedConversationId;
      restoreController = new AbortController();
      abortRef.current = restoreController;

      void fetchConversation(
        conversationPathRef.current(storedConversationId),
        restoreController.signal,
      )
        .then((snapshot) => {
          if (restoreController?.signal.aborted) return;
          setTurns(snapshot.conversation.turns);
          setAwaitingOperator(snapshot.awaitingOperator);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (restoreController?.signal.aborted) return;

          if (isMissingConversation(caught)) {
            conversationIdRef.current = null;
            removeStoredConversationId();
            setTurns([]);
            setAwaitingOperator(false);
            setError(null);
            return;
          }

          setError(
            caught instanceof Error
              ? caught
              : new Error("Chat conversation restore failed"),
          );
        })
        .finally(() => {
          if (abortRef.current === restoreController) abortRef.current = null;
        });
    }

    return () => {
      restoreController?.abort();
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!awaitingOperator) return;

    const conversationId = conversationIdRef.current;
    if (!conversationId) return;

    let pollingController: AbortController | null = null;
    let requestInFlight = false;

    const pollConversation = async (): Promise<void> => {
      if (requestInFlight) return;

      const controller = new AbortController();
      pollingController = controller;
      requestInFlight = true;

      try {
        const snapshot = await fetchConversation(
          conversationPathRef.current(conversationId),
          controller.signal,
        );
        if (controller.signal.aborted) return;

        setTurns(snapshot.conversation.turns);
        setAwaitingOperator(snapshot.awaitingOperator);
        setError(null);
      } catch (caught: unknown) {
        if (controller.signal.aborted) return;

        if (isMissingConversation(caught)) {
          conversationIdRef.current = null;
          removeStoredConversationId();
          setTurns([]);
          setAwaitingOperator(false);
          setError(null);
          return;
        }

        setError(
          caught instanceof Error
            ? caught
            : new Error("Chat conversation polling failed"),
        );
      } finally {
        if (pollingController === controller) pollingController = null;
        requestInFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void pollConversation();
    }, CHAT_REFETCH_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
      pollingController?.abort();
    };
  }, [awaitingOperator]);

  const send = useCallback(async (message: string): Promise<boolean> => {
    const normalizedMessage = message.trim().slice(0, messageLimitRef.current);
    if (normalizedMessage.length === 0) return true;

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsStreaming(true);
    setError(null);

    const conversationId = conversationIdRef.current;
    const userTurn: ChatTurnView = {
      id: createLocalTurnId("user"),
      role: "user",
      content: normalizedMessage,
      createdAt: Date.now(),
    };
    const assistantTurnId = createLocalTurnId("assistant");
    // 손님 턴이 transcript에 올라간 뒤의 실패는 친 문장이 화면에 남아 있으므로
    // 되돌릴 필요가 없다. 올라가기 전의 실패만 호출자에게 알린다.
    let userTurnVisible = false;

    try {
      const response = await fetch(sendPathRef.current, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(conversationId ? { conversationId } : {}),
          message: normalizedMessage,
        }),
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) return true;
      if (!response.ok || !response.body) {
        // POST 실패 본문은 text/plain이다. JSON으로 파싱하지 않고 상태만 보존한다.
        throw new ChatHttpError(response.status);
      }

      const responseConversationId = response.headers.get(
        "X-Conversation-Id",
      );
      if (!responseConversationId) {
        throw new ChatHttpError(response.status, "Missing conversation id");
      }

      conversationIdRef.current = responseConversationId;
      storeConversationId(responseConversationId);
      setTurns((current) => [
        ...current,
        userTurn,
        {
          id: assistantTurnId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        },
      ]);
      userTurnVisible = true;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortController.signal.aborted) return true;

        const chunk = decoder.decode(value, { stream: true });
        setTurns((current) =>
          current.map((turn) =>
            turn.id === assistantTurnId
              ? { ...turn, content: turn.content + chunk }
              : turn,
          ),
        );
      }

      if (abortController.signal.aborted) return true;

      const finalChunk = decoder.decode();
      setTurns((current) =>
        current.map((turn) =>
          turn.id === assistantTurnId
            ? { ...turn, content: turn.content + finalChunk }
            : turn,
        ),
      );

      const snapshot = await fetchConversation(
        conversationPathRef.current(responseConversationId),
        abortController.signal,
      );
      if (abortController.signal.aborted) return true;

      setTurns(snapshot.conversation.turns);
      setAwaitingOperator(snapshot.awaitingOperator);
      return true;
    } catch (caught) {
      if (abortController.signal.aborted) return true;

      setError(
        caught instanceof Error
          ? caught
          : new Error("Chat request failed"),
      );
      return userTurnVisible;
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
        setIsStreaming(false);
      }
    }
  }, []);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationIdRef.current = null;
    removeStoredConversationId();
    setTurns([]);
    setIsStreaming(false);
    setAwaitingOperator(false);
    setError(null);
  }, []);

  return {
    turns,
    isStreaming,
    awaitingOperator,
    error,
    send,
    reset,
  };
}
