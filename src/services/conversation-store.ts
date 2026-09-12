import type { ChatTurnRole, Conversation } from "@/types";

export const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_TURNS_PER_CONVERSATION = 100;
export const MAX_TURN_CONTENT_LENGTH = 4_000;

export interface NewChatTurn {
  role: ChatTurnRole;
  content: string;
}

export interface ConversationStore {
  create(userId: string): Promise<Conversation>;
  get(conversationId: string, userId: string): Promise<Conversation>;
  appendTurns(
    conversationId: string,
    userId: string,
    turns: NewChatTurn[],
  ): Promise<Conversation>;
  startEscalation(
    conversationId: string,
    userId: string,
    slackThreadTs: string,
    now: number,
  ): Promise<Conversation>;
  markAutoReplySent(
    conversationId: string,
    userId: string,
    now: number,
  ): Promise<boolean>;
  appendOperatorReply(
    slackThreadTs: string,
    content: string,
    eventId: string,
    now: number,
  ): Promise<Conversation | null>;
}
