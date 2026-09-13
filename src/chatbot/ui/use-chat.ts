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
  handoffPath?: string;
  conversationPath?: (conversationId: string) => string;
  messageLimit: number;
}

export interface UseChatResult {
  turns: ChatTurnView[];
  isStreaming: boolean;
  awaitingOperator: boolean;
  /**
   * 상담원과 연결된 뒤로는 답변을 받은 뒤에도 참으로 남는다. 보낸 메시지가
   * 사람에게 가는지 모델에게 가는지를 가르는 것은 이 값이다.
   */
  operatorMode: boolean;
  isRequestingOperator: boolean;
  error: Error | null;
  /**
   * 손님 턴이 화면에 올라가기 전에 실패하면 `false`를 돌려준다. 친 문장이 어디에도
   * 남지 않은 상태이므로, 호출자는 이 값을 보고 입력을 되돌려야 한다.
   */
  send: (message: string) => Promise<boolean>;
  requestOperator: () => Promise<boolean>;
  reset: () => void;
}

interface ConversationResponse {
  conversation: {
    id: string;
    turns: ChatTurnView[];
    updatedAt: number;
  };
  awaitingOperator: boolean;
  operatorMode: boolean;
}

export const CHAT_CONVERSATION_STORAGE_KEY = "chat-conversation-id";
export const CHAT_REFETCH_INTERVAL = 3_000;
export const OPERATOR_CHAT_ROUTE_HEADER = "X-Chat-Route";
export const OPERATOR_CHAT_ROUTE = "operator";

const DEFAULT_SEND_PATH = "/api/chat";
const DEFAULT_HANDOFF_PATH = "/api/chat/handoff";
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
  const [operatorMode, setOperatorMode] = useState(false);
  const [isRequestingOperator, setIsRequestingOperator] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendPathRef = useRef(options.sendPath ?? DEFAULT_SEND_PATH);
  const handoffPathRef = useRef(options.handoffPath ?? DEFAULT_HANDOFF_PATH);
  const conversationPathRef = useRef(
    options.conversationPath ?? defaultConversationPath,
  );
  const messageLimitRef = useRef(options.messageLimit);

  sendPathRef.current = options.sendPath ?? DEFAULT_SEND_PATH;
  handoffPathRef.current = options.handoffPath ?? DEFAULT_HANDOFF_PATH;
  conversationPathRef.current =
    options.conversationPath ?? defaultConversationPath;
  messageLimitRef.current = options.messageLimit;

  // 서버 스냅샷이 단일 출처다. 판정을 클라이언트에서 다시 계산하지 않는다.
  const applySnapshot = useCallback((snapshot: ConversationResponse): void => {
    setTurns(snapshot.conversation.turns);
    setAwaitingOperator(snapshot.awaitingOperator);
    setOperatorMode(snapshot.operatorMode);
    setError(null);
  }, []);

  const discardConversation = useCallback((): void => {
    conversationIdRef.current = null;
    removeStoredConversationId();
    setTurns([]);
    setAwaitingOperator(false);
    setOperatorMode(false);
    setError(null);
  }, []);

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
          applySnapshot(snapshot);
        })
        .catch((caught: unknown) => {
          if (restoreController?.signal.aborted) return;

          if (isMissingConversation(caught)) {
            discardConversation();
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
  }, [applySnapshot, discardConversation]);

  useEffect(() => {
    // 상담원이 답한 뒤에도 대화가 이어지므로 operatorMode 동안 폴링을 유지한다.
    if (!awaitingOperator && !operatorMode) return;

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

        applySnapshot(snapshot);
      } catch (caught: unknown) {
        if (controller.signal.aborted) return;

        if (isMissingConversation(caught)) {
          discardConversation();
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
  }, [applySnapshot, awaitingOperator, discardConversation, operatorMode]);

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
      if (!response.ok) {
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

      // 상담원에게 전달된 메시지에는 스트림도, 모델 답변도 없다. 빈 assistant
      // 턴을 만들면 화면에 빈 말풍선이 남는다. 본문 검사보다 먼저 갈라진다.
      if (
        response.headers.get(OPERATOR_CHAT_ROUTE_HEADER) === OPERATOR_CHAT_ROUTE
      ) {
        // 서버가 이미 손님 턴을 저장했다. 실패해도 입력을 되돌리지 않는다.
        userTurnVisible = true;
        const relayed = await fetchConversation(
          conversationPathRef.current(responseConversationId),
          abortController.signal,
        );
        if (abortController.signal.aborted) return true;

        applySnapshot(relayed);
        return true;
      }

      if (!response.body) {
        throw new ChatHttpError(response.status);
      }

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

      applySnapshot(snapshot);
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
  }, [applySnapshot]);

  const requestOperator = useCallback(async (): Promise<boolean> => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsRequestingOperator(true);
    setError(null);

    const conversationId = conversationIdRef.current;

    try {
      const response = await fetch(handoffPathRef.current, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conversationId ? { conversationId } : {}),
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) return false;
      if (!response.ok) throw await createGetError(response);

      const snapshot = (await response.json()) as ConversationResponse;
      if (abortController.signal.aborted) return false;

      conversationIdRef.current = snapshot.conversation.id;
      storeConversationId(snapshot.conversation.id);
      applySnapshot(snapshot);
      return true;
    } catch (caught) {
      if (abortController.signal.aborted) return false;

      setError(
        caught instanceof Error
          ? caught
          : new Error("Operator handoff failed"),
      );
      return false;
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
      setIsRequestingOperator(false);
    }
  }, [applySnapshot]);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    discardConversation();
    setIsStreaming(false);
    setIsRequestingOperator(false);
  }, [discardConversation]);

  return {
    turns,
    isStreaming,
    awaitingOperator,
    operatorMode,
    isRequestingOperator,
    error,
    send,
    requestOperator,
    reset,
  };
}
