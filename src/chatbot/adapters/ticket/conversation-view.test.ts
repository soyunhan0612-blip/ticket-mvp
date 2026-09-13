import { describe, expect, it } from "vitest";

import type { Conversation } from "@/types";

import {
  toConversationSnapshotResponse,
  toEscalationSnapshot,
} from "./conversation-view";

const ASKED_AT = 1_760_000_000_000;
const SLACK_THREAD_TS = "1760000000.000100";

function createConversation(
  escalation: Conversation["escalation"] = null,
): Conversation {
  return {
    id: "conv-1",
    userId: "user-secret",
    turns: [
      { id: "t1", role: "user", content: "환불 되나요?", createdAt: ASKED_AT },
    ],
    escalation,
    updatedAt: ASKED_AT + 10,
  };
}

function createEscalation(
  overrides: Partial<NonNullable<Conversation["escalation"]>> = {},
): NonNullable<Conversation["escalation"]> {
  return {
    askedAt: ASKED_AT,
    slackThreadTs: SLACK_THREAD_TS,
    autoReplySentAt: null,
    answeredAt: null,
    ...overrides,
  };
}

describe("toEscalationSnapshot", () => {
  it("returns null when the conversation was never escalated", () => {
    expect(toEscalationSnapshot(createConversation())).toBeNull();
  });

  it("drops the Slack thread id so core never sees it", () => {
    const snapshot = toEscalationSnapshot(
      createConversation(createEscalation()),
    );

    expect(snapshot).toEqual({
      askedAt: ASKED_AT,
      autoReplySentAt: null,
      answeredAt: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain(SLACK_THREAD_TS);
  });
});

describe("toConversationSnapshotResponse", () => {
  it("exposes only whitelisted conversation fields", () => {
    const response = toConversationSnapshotResponse(createConversation());

    expect(response.conversation).toEqual({
      id: "conv-1",
      turns: [
        { id: "t1", role: "user", content: "환불 되나요?", createdAt: ASKED_AT },
      ],
      updatedAt: ASKED_AT + 10,
    });
  });

  it("never serialises the owner id, the escalation object or the thread id", () => {
    const serialised = JSON.stringify(
      toConversationSnapshotResponse(createConversation(createEscalation())),
    );

    expect(serialised).not.toContain("user-secret");
    expect(serialised).not.toContain(SLACK_THREAD_TS);
    expect(serialised).not.toContain("escalation");
    expect(serialised).not.toContain("slackThreadTs");
  });

  it("ignores fields added to Conversation later", () => {
    const conversation = {
      ...createConversation(),
      slackChannelId: "C0LEAK",
    } as unknown as Conversation;

    expect(
      JSON.stringify(toConversationSnapshotResponse(conversation)),
    ).not.toContain("C0LEAK");
  });

  it("reports no operator involvement without an escalation", () => {
    const response = toConversationSnapshotResponse(createConversation());

    expect(response.awaitingOperator).toBe(false);
    expect(response.operatorMode).toBe(false);
  });

  it("reports waiting and operator mode while the escalation is unanswered", () => {
    const response = toConversationSnapshotResponse(
      createConversation(createEscalation()),
    );

    expect(response.awaitingOperator).toBe(true);
    expect(response.operatorMode).toBe(true);
  });

  it("keeps operator mode after the operator answers", () => {
    const response = toConversationSnapshotResponse(
      createConversation(createEscalation({ answeredAt: ASKED_AT + 5 })),
    );

    expect(response.awaitingOperator).toBe(false);
    expect(response.operatorMode).toBe(true);
  });
});
