import { describe, expect, it, vi } from "vitest";

import {
  OPERATOR_HANDOFF_EMPTY_SUMMARY,
  OPERATOR_HANDOFF_TEXT,
} from "../../core/escalation";
import type { Conversation } from "@/types";

import {
  OPERATOR_HANDOFF_SUMMARY_LIMIT,
  buildEscalationMessage,
  buildHandoffMessage,
  buildRelayMessage,
  relayGuestMessage,
  startOperatorHandoff,
} from "./operator-handoff";

const SLACK_THREAD_TS = "1760000000.000100";

function makeConversation(
  escalation: Conversation["escalation"] = null,
  turns: Conversation["turns"] = [],
): Conversation {
  return {
    id: "conversation-123",
    userId: "private-user-id",
    turns,
    escalation,
    updatedAt: 1_000,
  };
}

function makeEscalation(
  overrides: Partial<NonNullable<Conversation["escalation"]>> = {},
): NonNullable<Conversation["escalation"]> {
  return {
    askedAt: 1_000,
    slackThreadTs: SLACK_THREAD_TS,
    autoReplySentAt: null,
    answeredAt: null,
    ...overrides,
  };
}

function makeDeps(conversation: Conversation = makeConversation()) {
  const conversationStore = {
    get: vi.fn().mockResolvedValue(conversation),
    appendTurns: vi.fn().mockResolvedValue(conversation),
    startEscalation: vi.fn().mockResolvedValue(
      makeConversation(makeEscalation()),
    ),
  };
  const postMessage = vi.fn().mockResolvedValue({ ts: SLACK_THREAD_TS });

  return {
    deps: {
      conversationId: "conversation-123",
      userId: "private-user-id",
      conversationStore,
      postMessage,
      now: vi.fn(() => 2_000),
    },
    conversationStore,
    postMessage,
  };
}

describe("buildHandoffMessage", () => {
  it("splits the headline, the guest text and the conversation id into blocks", () => {
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: "결제가 안 됩니다",
    });

    expect(message.blocks).toEqual([
      {
        type: "section",
        text: { type: "mrkdwn", text: "*상담 요청* · 손님이 직접 연결" },
      },
      {
        type: "section",
        text: { type: "plain_text", text: "결제가 안 됩니다", emoji: false },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "스레드로 답장하면 손님에게 전달됩니다 · `conversation-123`",
          },
        ],
      },
    ]);
  });

  it("repeats the guest text in the notification fallback", () => {
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: "결제가 안 됩니다",
    });

    expect(message.text).toContain("결제가 안 됩니다");
  });

  it("leaves the model input delimiters out of Slack", () => {
    // 인젝션 방어는 모델에 넘기기 직전(createHistory)에 건다. 슬랙은 출력
    // 싱크라 구분자가 상담원에게 노이즈로만 남는다.
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: "결제가 안 됩니다",
    });

    expect(JSON.stringify(message)).not.toContain("USER_INPUT_START");
  });

  it("shows guest markup as literal characters", () => {
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: "*굵게* <script> & 앰퍼샌드",
    });

    expect(message.blocks[1]).toEqual({
      type: "section",
      text: {
        type: "plain_text",
        text: "*굵게* &lt;script&gt; &amp; 앰퍼샌드",
        emoji: false,
      },
    });
  });

  it("says the guest asked for a person directly", () => {
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: OPERATOR_HANDOFF_EMPTY_SUMMARY,
    });

    expect(JSON.stringify(message.blocks[0])).toContain("직접");
  });

  it("never carries the owner id outside the guest text", () => {
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: "private-user-id 를 그대로 친 손님",
    });

    expect(JSON.stringify(message.blocks[0])).not.toContain("private-user-id");
    expect(JSON.stringify(message.blocks[2])).toContain("conversation-123");
    expect(JSON.stringify(message.blocks[2])).not.toContain("private-user-id");
  });

  it("truncates an oversized summary", () => {
    const message = buildHandoffMessage({
      conversationId: "conversation-123",
      summary: "가".repeat(OPERATOR_HANDOFF_SUMMARY_LIMIT + 500),
    });

    const body = JSON.stringify(message);
    expect(body).not.toContain("가".repeat(OPERATOR_HANDOFF_SUMMARY_LIMIT + 1));
    expect(body).toContain("가".repeat(OPERATOR_HANDOFF_SUMMARY_LIMIT));
  });
});

describe("buildEscalationMessage", () => {
  it("marks the model path without the direct-request note", () => {
    const message = buildEscalationMessage({
      conversationId: "conversation-123",
      summary: "결제가 안 됩니다",
    });

    expect(message.blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*상담 요청*" },
    });
    expect(message.blocks[1]).toEqual({
      type: "section",
      text: { type: "plain_text", text: "결제가 안 됩니다", emoji: false },
    });
  });
});

describe("buildRelayMessage", () => {
  it("sends the guest message as one plain-text block", () => {
    const message = buildRelayMessage("추가 질문입니다", 100);

    expect(message.text).toBe("추가 질문입니다");
    expect(message.blocks).toEqual([
      {
        type: "section",
        text: { type: "plain_text", text: "추가 질문입니다", emoji: false },
      },
    ]);
  });

  it("drops the delimiters that made every relayed line three lines", () => {
    const message = buildRelayMessage("추가 질문입니다", 100);

    expect(JSON.stringify(message)).not.toContain("USER_INPUT_START");
  });

  it("truncates an oversized message", () => {
    const message = buildRelayMessage("가".repeat(150), 100);

    expect(message.text).toBe("가".repeat(100));
  });
});

describe("startOperatorHandoff", () => {
  it("posts a top-level Slack message and records the thread", async () => {
    const { deps, conversationStore, postMessage } = makeDeps(
      makeConversation(null, [
        { id: "t1", role: "user", content: "환불 되나요?", createdAt: 1 },
      ]),
    );

    const result = await startOperatorHandoff(deps);

    expect(result).toEqual({ status: "started" });
    expect(postMessage).toHaveBeenCalledTimes(1);
    // 스레드 루트를 새로 만드는 호출이라 threadTs를 넘기지 않는다.
    expect(postMessage.mock.calls[0][0].threadTs).toBeUndefined();
    expect(postMessage.mock.calls[0][0].text).toContain("환불 되나요?");
    expect(conversationStore.startEscalation).toHaveBeenCalledWith(
      "conversation-123",
      "private-user-id",
      SLACK_THREAD_TS,
      2_000,
    );
  });

  it("tells the guest that further messages reach a person", async () => {
    const { deps, conversationStore } = makeDeps();

    await startOperatorHandoff(deps);

    expect(conversationStore.appendTurns).toHaveBeenCalledWith(
      "conversation-123",
      "private-user-id",
      [{ role: "notice", content: OPERATOR_HANDOFF_TEXT }],
    );
  });

  it("summarises an empty conversation with the fixed notice", async () => {
    const { deps, postMessage } = makeDeps();

    await startOperatorHandoff(deps);

    expect(postMessage.mock.calls[0][0].text).toContain(
      OPERATOR_HANDOFF_EMPTY_SUMMARY,
    );
  });

  it("does not post again for a conversation already in operator mode", async () => {
    const { deps, conversationStore, postMessage } = makeDeps(
      makeConversation(makeEscalation()),
    );

    const result = await startOperatorHandoff(deps);

    expect(result).toEqual({ status: "already_connected" });
    expect(postMessage).not.toHaveBeenCalled();
    expect(conversationStore.startEscalation).not.toHaveBeenCalled();
  });

  it("keeps operator mode after the operator answered", async () => {
    const { deps, postMessage } = makeDeps(
      makeConversation(makeEscalation({ answeredAt: 5_000 })),
    );

    const result = await startOperatorHandoff(deps);

    expect(result).toEqual({ status: "already_connected" });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reports the race lost by the store as already connected", async () => {
    const { deps, conversationStore } = makeDeps();
    conversationStore.startEscalation.mockRejectedValue(
      new Error("ESCALATION_IN_PROGRESS: conversation-123"),
    );

    expect(await startOperatorHandoff(deps)).toEqual({
      status: "already_connected",
    });
  });

  it("never records an escalation when Slack refuses the message", async () => {
    const { deps, conversationStore, postMessage } = makeDeps();
    postMessage.mockRejectedValue(new Error("slack down"));

    const result = await startOperatorHandoff(deps);

    expect(result).toEqual({ status: "unavailable" });
    expect(conversationStore.startEscalation).not.toHaveBeenCalled();
  });

  it("still reports success when the notice turn cannot be stored", async () => {
    const { deps, conversationStore } = makeDeps();
    conversationStore.appendTurns.mockRejectedValue(new Error("store down"));

    expect(await startOperatorHandoff(deps)).toEqual({ status: "started" });
  });

  it("does not throw when the conversation cannot be read", async () => {
    const { deps, conversationStore } = makeDeps();
    conversationStore.get.mockRejectedValue(
      new Error("NOT_FOUND: conversation-123"),
    );

    expect(await startOperatorHandoff(deps)).toEqual({
      status: "unavailable",
    });
  });
});

describe("relayGuestMessage", () => {
  it("posts into the recorded thread", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "1760000000.000200" });

    const delivered = await relayGuestMessage({
      threadTs: SLACK_THREAD_TS,
      message: "추가 질문입니다",
      limit: 1_000,
      postMessage,
    });

    expect(delivered).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].threadTs).toBe(SLACK_THREAD_TS);
    expect(postMessage.mock.calls[0][0].text).toContain("추가 질문입니다");
    expect(postMessage.mock.calls[0][0].blocks).toHaveLength(1);
  });

  it("reports a failure instead of throwing", async () => {
    const postMessage = vi.fn().mockRejectedValue(new Error("slack down"));

    expect(
      await relayGuestMessage({
        threadTs: SLACK_THREAD_TS,
        message: "추가 질문입니다",
        limit: 1_000,
        postMessage,
      }),
    ).toBe(false);
  });
});
