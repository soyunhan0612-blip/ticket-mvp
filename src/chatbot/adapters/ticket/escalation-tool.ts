import { z } from "zod";

import type { ConversationStore } from "@/services/conversation-store";

import { isAwaitingOperator } from "../../core/escalation";
import type { ChatToolDescriptor } from "../../core/types";

import { buildEscalationMessage, type SlackBlock } from "./operator-handoff";

export const ESCALATION_SUMMARY_LIMIT = 1_000;

const escalationInputSchema = z.object({
  summary: z.string().min(1).max(ESCALATION_SUMMARY_LIMIT),
});

export interface EscalationToolDeps {
  conversationId: string;
  userId: string;
  conversationStore: Pick<
    ConversationStore,
    "get" | "startEscalation"
  >;
  postMessage: (input: {
    text: string;
    blocks?: readonly SlackBlock[];
    threadTs?: string;
  }) => Promise<{ ts: string }>;
  canEscalateNow: () => boolean;
  now: () => number;
}

export function createEscalationTool(
  deps: EscalationToolDeps,
): ChatToolDescriptor<typeof escalationInputSchema> {
  return {
    name: "escalate_to_human",
    description:
      "주어진 툴로 조회할 수 없는 문의인 결제 오류, 계정 문제, 현장 안내 등을 상담원에게 전달할 때만 사용한다. 공연·회차·예매·환불 규정 질문에는 사용하지 않는다.",
    inputSchema: escalationInputSchema,
    async run({ summary }) {
      try {
        if (!deps.canEscalateNow()) {
          return JSON.stringify({
            escalated: false,
            reason: "rate_limited",
          });
        }

        const conversation = await deps.conversationStore.get(
          deps.conversationId,
          deps.userId,
        );
        if (isAwaitingOperator(conversation.escalation)) {
          return JSON.stringify({
            escalated: false,
            reason: "already_waiting",
          });
        }

        const { ts } = await deps.postMessage(
          buildEscalationMessage({
            conversationId: deps.conversationId,
            summary,
          }),
        );

        await deps.conversationStore.startEscalation(
          deps.conversationId,
          deps.userId,
          ts,
          deps.now(),
        );

        return JSON.stringify({ escalated: true });
      } catch {
        return JSON.stringify({
          escalated: false,
          reason: "unavailable",
        });
      }
    },
  };
}
