import { describe, expect, it } from "vitest";

import {
  MAX_HISTORY_TURNS,
  MAX_TURN_LENGTH,
  normalizeHistory,
} from "./history";
import type { ChatHistoryTurn } from "./types";

describe("normalizeHistory", () => {
  it("returns an empty array for empty or whitespace-only history", () => {
    expect(normalizeHistory([])).toEqual([]);
    expect(
      normalizeHistory([
        { role: "user", content: "" },
        { role: "assistant", content: " \n\t " },
      ]),
    ).toEqual([]);
  });

  it("truncates each turn and keeps only the most recent turns", () => {
    const turns: ChatHistoryTurn[] = Array.from(
      { length: MAX_HISTORY_TURNS + 2 },
      (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: index === MAX_HISTORY_TURNS + 1
          ? "x".repeat(MAX_TURN_LENGTH + 1)
          : `turn-${index}`,
      }),
    );

    const result = normalizeHistory(turns);

    expect(result).toHaveLength(MAX_HISTORY_TURNS);
    expect(result[0]?.content).toBe("turn-2");
    expect(result.at(-1)?.content).toHaveLength(MAX_TURN_LENGTH);
  });

  it("drops an assistant turn exposed at the front after taking the tail", () => {
    const turns: ChatHistoryTurn[] = [
      { role: "user", content: "old user" },
      ...Array.from({ length: MAX_HISTORY_TURNS }, (_, index) => ({
        role: index % 2 === 0 ? "assistant" as const : "user" as const,
        content: `recent-${index}`,
      })),
    ];

    const result = normalizeHistory(turns);

    expect(result).toHaveLength(MAX_HISTORY_TURNS - 1);
    expect(result[0]).toEqual({ role: "user", content: "recent-1" });
  });

  it("returns a new array and new turn objects without mutating input", () => {
    const originalTurn: ChatHistoryTurn = {
      role: "user",
      content: "  내용은 유지한다  ",
    };
    const input = [originalTurn];
    const snapshot = structuredClone(input);

    const result = normalizeHistory(input);

    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(originalTurn);
    expect(result[0]?.content).toBe("  내용은 유지한다  ");
  });
});
