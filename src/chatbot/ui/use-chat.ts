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
  send: (message: string) => Promise<void>;
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

  const send = useCallback(async (message: string): Promise<void> => {
    const normalizedMessage = message.trim().slice(0, messageLimitRef.current);
    if (normalizedMessage.length === 0) return;

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

      if (abortController.signal.aborted) return;
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortController.signal.aborted) return;

        const chunk = decoder.decode(value, { stream: true });
        setTurns((current) =>
          current.map((turn) =>
            turn.id === assistantTurnId
              ? { ...turn, content: turn.content + chunk }
              : turn,
          ),
        );
      }

      if (abortController.signal.aborted) return;

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
      if (abortController.signal.aborted) return;

      setTurns(snapshot.conversation.turns);
      setAwaitingOperator(snapshot.awaitingOperator);
    } catch (caught) {
      if (abortController.signal.aborted) return;

      setError(
        caught instanceof Error
          ? caught
          : new Error("Chat request failed"),
      );
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
