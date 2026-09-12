import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_CONVERSATION_STORAGE_KEY,
  useChat,
  type ChatTurnView,
} from "./use-chat";

const OPTIONS = { messageLimit: 100 };

function createStreamingResponse(
  chunks: Array<string | Uint8Array>,
  conversationId = "conversation-1",
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "X-Conversation-Id": conversationId },
  });
}

function createConversationResponse({
  id = "conversation-1",
  turns = [],
  awaitingOperator = false,
}: {
  id?: string;
  turns?: ChatTurnView[];
  awaitingOperator?: boolean;
} = {}): Response {
  return Response.json({
    conversation: { id, turns, updatedAt: 1 },
    awaitingOperator,
  });
}

describe("useChat", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("스트림 조각이 도착하는 순서대로 assistant 턴에 누적한다", async () => {
    let releaseSecondChunk!: () => void;
    const secondChunkGate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("첫 조각"));
        await secondChunkGate;
        controller.enqueue(encoder.encode("과 두 번째 조각"));
        controller.close();
      },
    });
    const storedTurns: ChatTurnView[] = [
      { id: "user-1", role: "user", content: "질문", createdAt: 1 },
      {
        id: "assistant-1",
        role: "assistant",
        content: "첫 조각과 두 번째 조각",
        createdAt: 2,
      },
    ];
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(stream, {
          headers: { "X-Conversation-Id": "conversation-1" },
        }),
      )
      .mockResolvedValueOnce(createConversationResponse({ turns: storedTurns }));
    const { result } = renderHook(() => useChat(OPTIONS));
    let sendPromise!: Promise<boolean>;

    act(() => {
      sendPromise = result.current.send("질문");
    });

    await waitFor(() => {
      expect(result.current.turns.at(-1)).toMatchObject({
        role: "assistant",
        content: "첫 조각",
      });
    });
    expect(result.current.isStreaming).toBe(true);

    releaseSecondChunk();
    await act(async () => {
      await sendPromise;
    });

    expect(result.current.turns).toEqual(storedTurns);
    expect(result.current.isStreaming).toBe(false);
  });

  it("한글 멀티바이트 문자가 Uint8Array 경계에 걸려도 깨뜨리지 않는다", async () => {
    const encoded = new TextEncoder().encode("한글");
    let resolveGet!: (response: Response) => void;
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createStreamingResponse([
          encoded.slice(0, encoded.length - 1),
          encoded.slice(encoded.length - 1),
        ]),
      )
      .mockReturnValueOnce(pendingGet);
    const { result } = renderHook(() => useChat(OPTIONS));
    let sendPromise!: Promise<boolean>;

    act(() => {
      sendPromise = result.current.send("질문");
    });

    await waitFor(() => {
      expect(result.current.turns.at(-1)?.content).toBe("한글");
    });

    resolveGet(createConversationResponse());
    await act(async () => {
      await sendPromise;
    });
  });

  it("스트림이 끝나면 저장된 대화와 awaitingOperator를 GET으로 한 번 동기화한다", async () => {
    const storedTurns: ChatTurnView[] = [
      { id: "user-1", role: "user", content: "질문", createdAt: 1 },
      { id: "notice-1", role: "notice", content: "안내", createdAt: 2 },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createStreamingResponse(["안내"]))
      .mockResolvedValueOnce(
        createConversationResponse({ turns: storedTurns, awaitingOperator: true }),
      );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await result.current.send("질문");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/chat/conversation-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.turns).toEqual(storedTurns);
    expect(result.current.awaitingOperator).toBe(true);
    expect(sessionStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY)).toBe(
      "conversation-1",
    );
  });

  it("손님 턴이 화면에 오르기 전에 실패하면 send가 false를 돌려준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("요청이 너무 많습니다.", { status: 429 }),
    );
    const { result } = renderHook(() => useChat(OPTIONS));

    let sent!: boolean;
    await act(async () => {
      sent = await result.current.send("질문");
    });

    expect(sent).toBe(false);
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("언마운트하면 진행 중인 요청의 AbortController를 중단한다", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { result, unmount } = renderHook(() => useChat(OPTIONS));

    act(() => {
      void result.current.send("질문");
    });
    await waitFor(() => expect(requestSignal).toBeDefined());

    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("sessionStorage 복원 GET이 404면 저장된 id를 버리고 조용히 빈 대화로 시작한다", async () => {
    sessionStorage.setItem(
      CHAT_CONVERSATION_STORAGE_KEY,
      "missing-conversation",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "not found" }, { status: 404 }),
    );

    const { result } = renderHook(() => useChat(OPTIONS));

    await waitFor(() => {
      expect(
        sessionStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY),
      ).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/missing-conversation",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.turns).toEqual([]);
    expect(result.current.awaitingOperator).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("awaitingOperator가 true인 동안 3초마다 서버 턴으로 동기화하고 false가 되면 멈춘다", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(
      CHAT_CONVERSATION_STORAGE_KEY,
      "conversation-1",
    );
    const initialTurns: ChatTurnView[] = [
      { id: "notice-1", role: "notice", content: "연결 중", createdAt: 1 },
    ];
    const waitingTurns: ChatTurnView[] = [
      ...initialTurns,
      { id: "notice-2", role: "notice", content: "안내", createdAt: 2 },
    ];
    const answeredTurns: ChatTurnView[] = [
      ...waitingTurns,
      {
        id: "operator-1",
        role: "operator",
        content: "상담원 답변",
        createdAt: 3,
      },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createConversationResponse({
          turns: initialTurns,
          awaitingOperator: true,
        }),
      )
      .mockResolvedValueOnce(
        createConversationResponse({
          turns: waitingTurns,
          awaitingOperator: true,
        }),
      )
      .mockResolvedValueOnce(
        createConversationResponse({
          turns: answeredTurns,
          awaitingOperator: false,
        }),
      );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.awaitingOperator).toBe(true);
    expect(result.current.turns).toEqual(initialTurns);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.awaitingOperator).toBe(true);
    expect(result.current.turns).toEqual(waitingTurns);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.awaitingOperator).toBe(false);
    expect(result.current.turns).toEqual(answeredTurns);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("대기 중 폴링 요청을 언마운트에서 중단하고 반복 예약을 정리한다", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(
      CHAT_CONVERSATION_STORAGE_KEY,
      "conversation-1",
    );
    let pollingSignal: AbortSignal | undefined;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        createConversationResponse({ awaitingOperator: true }),
      )
      .mockImplementationOnce((_input, init) => {
        pollingSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });
    const { unmount } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(pollingSignal).toBeDefined();

    unmount();

    expect(pollingSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
