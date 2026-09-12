import type {
  ChatTurn,
  Conversation,
  ConversationEscalation,
} from "@/types";

import {
  CONVERSATION_TTL_MS,
  MAX_TURN_CONTENT_LENGTH,
  MAX_TURNS_PER_CONVERSATION,
} from "./conversation-store";
import type {
  ConversationStore,
  NewChatTurn,
} from "./conversation-store";
import { getRedisClient } from "./redis-client";

const CONVERSATION_TTL_SECONDS = CONVERSATION_TTL_MS / 1_000;

const CREATE_CONVERSATION_SCRIPT = `-- operation: create-conversation
local metaKey = KEYS[1]
local turnsKey = KEYS[2]

redis.call("DEL", metaKey, turnsKey)
redis.call(
  "HSET",
  metaKey,
  "userId", ARGV[1],
  "escalation", ARGV[2],
  "updatedAt", ARGV[3]
)
redis.call("EXPIRE", metaKey, ARGV[4])

return {2, ARGV[2], ARGV[3]}
`;

const GET_CONVERSATION_SCRIPT = `-- operation: get-conversation
local metaKey = KEYS[1]
local turnsKey = KEYS[2]

if redis.call("EXISTS", metaKey) == 0 then
  return {0}
end

if redis.call("HGET", metaKey, "userId") ~= ARGV[1] then
  return {1}
end

local result = {
  2,
  redis.call("HGET", metaKey, "escalation"),
  redis.call("HGET", metaKey, "updatedAt")
}
local turns = redis.call("LRANGE", turnsKey, 0, -1)
for index = 1, #turns do
  result[#result + 1] = turns[index]
end

return result
`;

const APPEND_CONVERSATION_SCRIPT = `-- operation: append-conversation
local metaKey = KEYS[1]
local turnsKey = KEYS[2]

if redis.call("EXISTS", metaKey) == 0 then
  return {0}
end

if redis.call("HGET", metaKey, "userId") ~= ARGV[1] then
  return {1}
end

if #ARGV >= 5 then
  redis.call("RPUSH", turnsKey, unpack(ARGV, 5))
end
redis.call("LTRIM", turnsKey, -tonumber(ARGV[4]), -1)
redis.call("HSET", metaKey, "updatedAt", ARGV[2])
redis.call("EXPIRE", metaKey, ARGV[3])
redis.call("EXPIRE", turnsKey, ARGV[3])

local result = {
  2,
  redis.call("HGET", metaKey, "escalation"),
  ARGV[2]
}
local turns = redis.call("LRANGE", turnsKey, 0, -1)
for index = 1, #turns do
  result[#result + 1] = turns[index]
end

return result
`;

function conversationKeys(conversationId: string): [string, string] {
  return [
    `conversation:${conversationId}:meta`,
    `conversation:${conversationId}:turns`,
  ];
}

function notFound(conversationId: string): Error {
  return new Error(`NOT_FOUND: conversation ${conversationId} does not exist`);
}

function forbidden(conversationId: string): Error {
  return new Error(
    `FORBIDDEN: conversation ${conversationId} is owned by another user`,
  );
}

function parseJsonValue(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function parseEscalation(value: unknown): ConversationEscalation | null {
  const parsed = parseJsonValue(value);
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid Redis conversation escalation");
  }
  return parsed as ConversationEscalation;
}

function parseTurn(value: unknown): ChatTurn {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid Redis conversation turn");
  }
  return parsed as ChatTurn;
}

function parseConversationResult(
  conversationId: string,
  userId: string,
  value: unknown,
): Conversation {
  if (!Array.isArray(value)) {
    throw new Error("invalid Redis conversation result");
  }

  const status = Number(value[0]);
  if (status === 0) throw notFound(conversationId);
  if (status === 1) throw forbidden(conversationId);
  if (status !== 2 || value.length < 3) {
    throw new Error("invalid Redis conversation result");
  }

  const updatedAt = Number(value[2]);
  if (!Number.isFinite(updatedAt)) {
    throw new Error("invalid Redis conversation updatedAt");
  }

  return {
    id: conversationId,
    userId,
    escalation: parseEscalation(value[1]),
    updatedAt,
    turns: value.slice(3).map(parseTurn),
  };
}

function createStoredTurn(turn: NewChatTurn, createdAt: number): ChatTurn {
  return {
    id: crypto.randomUUID(),
    role: turn.role,
    content: turn.content.slice(0, MAX_TURN_CONTENT_LENGTH),
    createdAt,
  };
}

export function createConversationStoreRedis(): ConversationStore {
  const redis = getRedisClient();

  return {
    async create(userId) {
      const conversationId = crypto.randomUUID();
      const now = Date.now();
      const result = await redis.eval<unknown[]>(
        CREATE_CONVERSATION_SCRIPT,
        conversationKeys(conversationId),
        [userId, JSON.stringify(null), now, CONVERSATION_TTL_SECONDS],
      );
      return parseConversationResult(conversationId, userId, result);
    },

    async get(conversationId, userId) {
      const result = await redis.eval<unknown[]>(
        GET_CONVERSATION_SCRIPT,
        conversationKeys(conversationId),
        [userId],
      );
      return parseConversationResult(conversationId, userId, result);
    },

    async appendTurns(conversationId, userId, turns) {
      const now = Date.now();
      const storedTurns = turns.map((turn) => createStoredTurn(turn, now));
      const result = await redis.eval<unknown[]>(
        APPEND_CONVERSATION_SCRIPT,
        conversationKeys(conversationId),
        [
          userId,
          now,
          CONVERSATION_TTL_SECONDS,
          MAX_TURNS_PER_CONVERSATION,
          ...storedTurns.map((turn) => JSON.stringify(turn)),
        ],
      );
      return parseConversationResult(conversationId, userId, result);
    },
  };
}
