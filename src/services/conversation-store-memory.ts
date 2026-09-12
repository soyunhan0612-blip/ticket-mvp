import type { ChatTurn, Conversation } from "@/types";

import {
  CONVERSATION_TTL_MS,
  MAX_TURN_CONTENT_LENGTH,
  MAX_TURNS_PER_CONVERSATION,
} from "./conversation-store";
import type {
  ConversationStore,
  NewChatTurn,
} from "./conversation-store";

const globalForConversationStore = globalThis as typeof globalThis & {
  conversationStoreMemory?: ConversationStore;
};

const SLACK_THREAD_TS_PATTERN = /^\d+\.\d+$/;
const SLACK_EVENT_TTL_MS = 60 * 60 * 1_000;

function notFound(conversationId: string): Error {
  return new Error(`NOT_FOUND: conversation ${conversationId} does not exist`);
}

function getOwnedConversation(
  conversations: Map<string, Conversation>,
  conversationId: string,
  userId: string,
): Conversation {
  const conversation = conversations.get(conversationId);
  if (
    !conversation
    || conversation.updatedAt + CONVERSATION_TTL_MS <= Date.now()
  ) {
    conversations.delete(conversationId);
    throw notFound(conversationId);
  }
  if (conversation.userId !== userId) {
    throw new Error(
      `FORBIDDEN: conversation ${conversationId} is owned by another user`,
    );
  }
  return conversation;
}

function createStoredTurn(turn: NewChatTurn, createdAt: number): ChatTurn {
  return {
    id: crypto.randomUUID(),
    role: turn.role,
    content: turn.content.slice(0, MAX_TURN_CONTENT_LENGTH),
    createdAt,
  };
}

function assertValidSlackThreadTs(slackThreadTs: string): void {
  if (!SLACK_THREAD_TS_PATTERN.test(slackThreadTs)) {
    throw new Error(
      `INVALID_SLACK_THREAD_TS: ${slackThreadTs} is not a Slack thread timestamp`,
    );
  }
}

function makeConversationStoreMemory(): ConversationStore {
  const conversations = new Map<string, Conversation>();
  const conversationIdsBySlackThread = new Map<string, string>();
  const processedSlackEvents = new Map<string, number>();

  return {
    async create(userId) {
      const now = Date.now();
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        userId,
        turns: [],
        escalation: null,
        updatedAt: now,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },

    async get(conversationId, userId) {
      return getOwnedConversation(conversations, conversationId, userId);
    },

    async appendTurns(conversationId, userId, turns) {
      const conversation = getOwnedConversation(
        conversations,
        conversationId,
        userId,
      );
      const now = Date.now();
      const appendedTurns = turns.map((turn) => createStoredTurn(turn, now));

      conversation.turns = [...conversation.turns, ...appendedTurns].slice(
        -MAX_TURNS_PER_CONVERSATION,
      );
      conversation.updatedAt = now;

      return conversation;
    },

    async startEscalation(conversationId, userId, slackThreadTs, now) {
      assertValidSlackThreadTs(slackThreadTs);
      const conversation = getOwnedConversation(
        conversations,
        conversationId,
        userId,
      );
      if (
        conversation.escalation !== null
        && conversation.escalation.answeredAt === null
      ) {
        throw new Error(
          `ESCALATION_IN_PROGRESS: conversation ${conversationId}`,
        );
      }

      conversation.escalation = {
        askedAt: now,
        slackThreadTs,
        autoReplySentAt: null,
        answeredAt: null,
      };
      conversation.updatedAt = now;
      conversationIdsBySlackThread.set(slackThreadTs, conversationId);

      return conversation;
    },

    async markAutoReplySent(conversationId, userId, now) {
      const conversation = getOwnedConversation(
        conversations,
        conversationId,
        userId,
      );
      const escalation = conversation.escalation;
      if (
        escalation === null
        || escalation.autoReplySentAt !== null
        || escalation.answeredAt !== null
      ) {
        return false;
      }

      escalation.autoReplySentAt = now;
      conversation.updatedAt = now;
      return true;
    },

    async appendOperatorReply(slackThreadTs, content, eventId, now) {
      if (!SLACK_THREAD_TS_PATTERN.test(slackThreadTs)) return null;

      const eventExpiry = processedSlackEvents.get(eventId);
      if (eventExpiry !== undefined) {
        if (eventExpiry > Date.now()) return null;
        processedSlackEvents.delete(eventId);
      }

      const conversationId = conversationIdsBySlackThread.get(slackThreadTs);
      if (!conversationId) return null;

      const conversation = conversations.get(conversationId);
      if (!conversation) {
        conversationIdsBySlackThread.delete(slackThreadTs);
        return null;
      }
      if (conversation.updatedAt + CONVERSATION_TTL_MS <= Date.now()) {
        conversationIdsBySlackThread.delete(slackThreadTs);
        conversations.delete(conversationId);
        return null;
      }
      if (conversation.escalation?.slackThreadTs !== slackThreadTs) {
        conversationIdsBySlackThread.delete(slackThreadTs);
        return null;
      }

      const operatorTurn = createStoredTurn(
        { role: "operator", content },
        now,
      );
      conversation.turns = [...conversation.turns, operatorTurn].slice(
        -MAX_TURNS_PER_CONVERSATION,
      );
      if (conversation.escalation.answeredAt === null) {
        conversation.escalation.answeredAt = now;
      }
      conversation.updatedAt = now;
      processedSlackEvents.set(eventId, Date.now() + SLACK_EVENT_TTL_MS);

      return conversation;
    },
  };
}

export function createConversationStoreMemory(): ConversationStore {
  globalForConversationStore.conversationStoreMemory ??=
    makeConversationStoreMemory();
  return globalForConversationStore.conversationStoreMemory;
}
