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
  operatorMode = awaitingOperator,
}: {
  id?: string;
  turns?: ChatTurnView[];
  awaitingOperator?: boolean;
  operatorMode?: boolean;
} = {}): Response {
  return Response.json({
    conversation: { id, turns, updatedAt: 1 },
    awaitingOperator,
    operatorMode,
  });
}

function createOperatorRelayResponse(
  conversationId = "conversation-1",
): Response {
  return new Response(null, {
    headers: {
      "X-Conversation-Id": conversationId,
      "X-Chat-Route": "operator",
    },
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

  it("requestOperator가 핸드오프 경로에 붙고 응답 스냅샷으로 상태를 바꾼다", async () => {
    const noticeTurns: ChatTurnView[] = [
      { id: "notice-1", role: "notice", content: "연결했습니다", createdAt: 1 },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createConversationResponse({
        id: "conversation-9",
        turns: noticeTurns,
        awaitingOperator: true,
      }),
    );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await expect(result.current.requestOperator()).resolves.toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/chat/handoff");
    expect(init?.method).toBe("POST");
    expect(result.current.operatorMode).toBe(true);
    expect(result.current.awaitingOperator).toBe(true);
    expect(result.current.turns).toEqual(noticeTurns);
    expect(result.current.error).toBeNull();
    expect(sessionStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY)).toBe(
      "conversation-9",
    );
  });

  it("핸드오프가 거절되면 상담원 모드로 넘어가지 않고 오류를 남긴다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "too many requests" }, { status: 429 }),
    );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await expect(result.current.requestOperator()).resolves.toBe(false);
    });

    expect(result.current.operatorMode).toBe(false);
    expect(result.current.awaitingOperator).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("상담원에게 릴레이된 응답에는 빈 assistant 턴을 만들지 않는다", async () => {
    const relayedTurns: ChatTurnView[] = [
      { id: "user-1", role: "user", content: "추가 질문", createdAt: 1 },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createOperatorRelayResponse("conversation-9"))
      .mockResolvedValueOnce(
        createConversationResponse({
          id: "conversation-9",
          turns: relayedTurns,
          awaitingOperator: true,
        }),
      );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await expect(result.current.send("추가 질문")).resolves.toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.turns).toEqual(relayedTurns);
    expect(
      result.current.turns.some((turn) => turn.role === "assistant"),
    ).toBe(false);
    expect(result.current.operatorMode).toBe(true);
    expect(result.current.isStreaming).toBe(false);
  });

  it("상담원이 답한 뒤에도 operatorMode인 동안 폴링을 이어간다", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(CHAT_CONVERSATION_STORAGE_KEY, "conversation-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createConversationResponse({
        awaitingOperator: false,
        operatorMode: true,
      }),
    );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.awaitingOperator).toBe(false);
    expect(result.current.operatorMode).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reset이 상담원 모드를 되돌린다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createConversationResponse({ awaitingOperator: true }),
    );
    const { result } = renderHook(() => useChat(OPTIONS));

    await act(async () => {
      await result.current.requestOperator();
    });
    expect(result.current.operatorMode).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.operatorMode).toBe(false);
    expect(result.current.awaitingOperator).toBe(false);
    expect(result.current.turns).toEqual([]);
    expect(sessionStorage.getItem(CHAT_CONVERSATION_STORAGE_KEY)).toBeNull();
  });

  it("서버 응답을 기다리지 않고 손님 턴을 먼저 올린다", async () => {
    let releaseResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pending)
      .mockResolvedValue(createConversationResponse());
    const { result } = renderHook(() => useChat(OPTIONS));

    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send("좌석 남았나요");
    });

    // POST가 아직 응답하지 않았는데도 친 문장이 화면에 있어야 한다.
    await waitFor(() => {
      expect(result.current.turns).toHaveLength(1);
    });
    expect(result.current.turns[0]).toMatchObject({
      role: "user",
      content: "좌석 남았나요",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseResponse(createStreamingResponse(["네, 남았습니다"]));
    await act(async () => {
      await sending;
    });
  });

  it("서버가 거절하면 낙관적으로 올린 손님 턴을 걷어낸다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 429 }),
    );
    const { result } = renderHook(() => useChat(OPTIONS));

    let sent!: boolean;
    await act(async () => {
      sent = await result.current.send("좌석 남았나요");
    });

    // 호출자가 입력을 되돌릴 수 있도록 false를 주고 화면도 원래대로 둔다.
    expect(sent).toBe(false);
    expect(result.current.turns).toEqual([]);
  });
});
