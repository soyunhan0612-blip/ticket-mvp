import { expect, expectTypeOf, it } from "vitest";

import { MAX_HISTORY_TURNS } from "@/chatbot/core/history";

import {
  CONVERSATION_TTL_MS,
  MAX_TURN_CONTENT_LENGTH,
  MAX_TURNS_PER_CONVERSATION,
} from "./conversation-store";
import type { ConversationStore, NewChatTurn } from "./conversation-store";

it("defines the conversation store contract", () => {
  expectTypeOf<ConversationStore>().toHaveProperty("create");
  expectTypeOf<ConversationStore>().toHaveProperty("get");
  expectTypeOf<ConversationStore>().toHaveProperty("appendTurns");
  expectTypeOf<ConversationStore>().toHaveProperty("startEscalation");
  expectTypeOf<ConversationStore>().toHaveProperty("markAutoReplySent");
  expectTypeOf<ConversationStore>().toHaveProperty("appendOperatorReply");
  expectTypeOf<NewChatTurn>().toHaveProperty("role");
  expectTypeOf<NewChatTurn>().toHaveProperty("content");
});

it("fixes the conversation storage limits", () => {
  expect(CONVERSATION_TTL_MS).toBe(24 * 60 * 60 * 1_000);
  expect(MAX_TURNS_PER_CONVERSATION).toBe(100);
  expect(MAX_TURN_CONTENT_LENGTH).toBe(4_000);
  expect(MAX_TURNS_PER_CONVERSATION).toBeGreaterThan(MAX_HISTORY_TURNS);
});
