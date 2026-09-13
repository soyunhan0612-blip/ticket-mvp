import type { ChatHistoryTurn } from "./types";

export const MAX_HISTORY_TURNS = 10;
export const MAX_TURN_LENGTH = 2_000;

export function normalizeHistory(
  turns: ChatHistoryTurn[],
): ChatHistoryTurn[] {
  const recentTurns = turns
    .filter((turn) => turn.content.trim().length > 0)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, MAX_TURN_LENGTH),
    }))
    .slice(-MAX_HISTORY_TURNS);

  return recentTurns[0]?.role === "assistant"
    ? recentTurns.slice(1)
    : recentTurns;
}
