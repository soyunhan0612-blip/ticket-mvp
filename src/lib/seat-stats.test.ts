import { describe, expect, it } from "vitest";

import { COLS_PER_ROW, ROWS_PER_SECTION, TOTAL_SEATS } from "@/lib/seat-map";
import { computeSeatStats } from "@/lib/seat-stats";
import type { SeatSnapshot } from "@/types";

describe("computeSeatStats", () => {
  it("returns the preset total as available for an empty snapshot", () => {
    expect(computeSeatStats({}, "small")).toEqual({
      total: 500,
      available: 500,
      held: 0,
      sold: 0,
    });
  });

  it("counts held seats and subtracts them from availability", () => {
    const seats: SeatSnapshot["seats"] = {
      "A-1-1": { s: "held", mine: true, expiresAt: 1_000 },
      "A-1-2": { s: "held", expiresAt: 1_000 },
    };

    expect(computeSeatStats(seats, "small")).toEqual({
      total: 500,
      available: 498,
      held: 2,
      sold: 0,
    });
  });

  it("counts sold seats", () => {
    const seats: SeatSnapshot["seats"] = {
      "A-1-1": { s: "sold" },
      "A-1-2": { s: "sold" },
    };

    expect(computeSeatStats(seats, "small")).toEqual({
      total: 500,
      available: 498,
      held: 0,
      sold: 2,
    });
  });

  it("ignores seats in sections outside the preset", () => {
    const seats: SeatSnapshot["seats"] = {
      "A-1-1": { s: "held" },
      "B-1-1": { s: "held" },
      "C-1-1": { s: "sold" },
      "D-1-1": { s: "sold" },
    };

    expect(computeSeatStats(seats, "small")).toEqual({
      total: 500,
      available: 499,
      held: 1,
      sold: 0,
    });
  });

  it("does not make availability negative for out-of-preset held seats", () => {
    const outsideSeats: SeatSnapshot["seats"] = Object.fromEntries(
      ["B", "C"].flatMap((section) =>
        Array.from({ length: ROWS_PER_SECTION }, (_, rowIndex) =>
          Array.from({ length: COLS_PER_ROW }, (_, colIndex) => [
            `${section}-${rowIndex + 1}-${colIndex + 1}`,
            { s: "held" as const },
          ]),
        ).flat(),
      ),
    );

    expect(computeSeatStats(outsideSeats, "small")).toEqual({
      total: 500,
      available: 500,
      held: 0,
      sold: 0,
    });
  });

  it("uses the global total and all sections without a preset", () => {
    const seats: SeatSnapshot["seats"] = {
      "A-1-1": { s: "held" },
      "B-1-1": { s: "sold" },
      "C-1-1": { s: "held" },
      "D-1-1": { s: "sold" },
    };

    expect(computeSeatStats(seats)).toEqual({
      total: TOTAL_SEATS,
      available: TOTAL_SEATS - 4,
      held: 2,
      sold: 2,
    });
  });

  it("ignores seat ids that cannot be parsed", () => {
    const seats: SeatSnapshot["seats"] = {
      "A-1-1": { s: "held" },
      invalid: { s: "held" },
      "A-26-1": { s: "sold" },
    };

    expect(computeSeatStats(seats, "small")).toEqual({
      total: 500,
      available: 499,
      held: 1,
      sold: 0,
    });
  });
});
