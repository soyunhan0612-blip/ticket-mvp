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

function makeConversationStoreMemory(): ConversationStore {
  const conversations = new Map<string, Conversation>();

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
  };
}

export function createConversationStoreMemory(): ConversationStore {
  globalForConversationStore.conversationStoreMemory ??=
    makeConversationStoreMemory();
  return globalForConversationStore.conversationStoreMemory;
}
