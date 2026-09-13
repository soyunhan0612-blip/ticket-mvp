import type { ConversationStore } from "@/services/conversation-store";

import {
  OPERATOR_HANDOFF_TEXT,
  isOperatorMode,
  summarizeForOperator,
} from "../../core/escalation";
import { neutralizeInput } from "../../core/sanitize";

export const OPERATOR_HANDOFF_SUMMARY_LIMIT = 1_000;

const SLACK_HEADLINE = "상담 요청";
const SLACK_REPLY_HINT = "스레드로 답장하면 손님에게 전달됩니다";

export type SlackBlock =
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | {
      type: "section";
      text: { type: "plain_text"; text: string; emoji: false };
    }
  | {
      type: "context";
      elements: readonly { type: "mrkdwn"; text: string }[];
    };

export interface SlackMessage {
  text: string;
  blocks: readonly SlackBlock[];
}

/**
 * Slack이 엔티티로 되돌리는 세 글자만 막는다. 보안 조치가 아니라 표시가
 * 깨지지 않게 하는 장치다 — 인젝션 방어는 모델에 넘기기 직전에 건다.
 */
function escapeSlackText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** 손님이 친 문자열은 언제나 plain_text로 싣는다. mrkdwn에 넣으면 `*`나
 * 백틱이 서식으로 먹혀 문장이 깨진다. */
function guestBlock(text: string): SlackBlock {
  return {
    type: "section",
    text: { type: "plain_text", text: escapeSlackText(text), emoji: false },
  };
}

function buildRequestMessage(input: {
  conversationId: string;
  summary: string;
  note?: string;
}): SlackMessage {
  const summary = neutralizeInput(
    input.summary,
    OPERATOR_HANDOFF_SUMMARY_LIMIT,
  );
  const headline =
    input.note === undefined
      ? `*${SLACK_HEADLINE}*`
      : `*${SLACK_HEADLINE}* · ${input.note}`;

  return {
    text: `${SLACK_HEADLINE} · ${escapeSlackText(summary)}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headline } },
      guestBlock(summary),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${SLACK_REPLY_HINT} · \`${input.conversationId}\``,
          },
        ],
      },
    ],
  };
}

/** 모델이 `escalate_to_human`으로 올리는 경로. */
export function buildEscalationMessage(input: {
  conversationId: string;
  summary: string;
}): SlackMessage {
  return buildRequestMessage(input);
}

export interface OperatorHandoffDeps {
  conversationId: string;
  userId: string;
  conversationStore: Pick<
    ConversationStore,
    "get" | "appendTurns" | "startEscalation"
  >;
  postMessage: (input: {
    text: string;
    blocks?: readonly SlackBlock[];
    threadTs?: string;
  }) => Promise<{ ts: string }>;
  now: () => number;
}

export type OperatorHandoffResult =
  | { status: "started" }
  | { status: "already_connected" }
  | { status: "unavailable" };

/** 손님이 버튼으로 올리는 경로. 모델 판단이 아니라는 것만 덧붙인다. */
export function buildHandoffMessage(input: {
  conversationId: string;
  summary: string;
}): SlackMessage {
  return buildRequestMessage({ ...input, note: "손님이 직접 연결" });
}

/**
 * 연결된 뒤 손님이 치는 매 메시지. 화자는 Slack 아바타가, 대화 ID는 스레드
 * 루트가 이미 말하므로 머리말 없이 한 줄로 보낸다.
 */
export function buildRelayMessage(
  message: string,
  limit: number,
): SlackMessage {
  const text = neutralizeInput(message, limit);
  return { text, blocks: [guestBlock(text)] };
}

/**
 * 손님이 버튼으로 직접 올리는 경로. 모델 툴과 같은 `startEscalation`으로
 * 수렴하되 요약을 모델에게 맡기지 않는다.
 *
 * 어떤 실패에도 throw하지 않는다. 호출자는 상태 코드만 보고 응답을 고른다.
 */
export async function startOperatorHandoff(
  deps: OperatorHandoffDeps,
): Promise<OperatorHandoffResult> {
  let ts: string;

  try {
    const conversation = await deps.conversationStore.get(
      deps.conversationId,
      deps.userId,
    );
    if (isOperatorMode(conversation.escalation)) {
      return { status: "already_connected" };
    }

    const message = buildHandoffMessage({
      conversationId: deps.conversationId,
      summary: summarizeForOperator(conversation.turns),
    });
    ts = (await deps.postMessage(message)).ts;
  } catch {
    return { status: "unavailable" };
  }

  try {
    await deps.conversationStore.startEscalation(
      deps.conversationId,
      deps.userId,
      ts,
      deps.now(),
    );
  } catch (error) {
    // 다른 탭이 먼저 연결했다. 방금 만든 Slack 스레드는 답장받을 곳이 없는 채로
    // 남지만, 손님에게는 이미 연결된 상태가 맞다.
    if (
      error instanceof Error &&
      error.message.startsWith("ESCALATION_IN_PROGRESS")
    ) {
      return { status: "already_connected" };
    }

    return { status: "unavailable" };
  }

  try {
    await deps.conversationStore.appendTurns(deps.conversationId, deps.userId, [
      { role: "notice", content: OPERATOR_HANDOFF_TEXT },
    ]);
  } catch {
    // 안내 턴이 없어도 연결 자체는 끝났다. 배너가 상태를 대신 알려준다.
  }

  return { status: "started" };
}

/** Slack이 거절하면 `false`. 호출자는 손님 턴을 저장하지 않고 되돌린다. */
export async function relayGuestMessage(deps: {
  threadTs: string;
  message: string;
  limit: number;
  postMessage: OperatorHandoffDeps["postMessage"];
}): Promise<boolean> {
  try {
    await deps.postMessage({
      ...buildRelayMessage(deps.message, deps.limit),
      threadTs: deps.threadTs,
    });
    return true;
  } catch {
    return false;
  }
}
