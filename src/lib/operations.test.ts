import { describe, expect, it, vi } from "vitest";

import { collectOperations } from "@/lib/operations";
import type { SeatStore, ShowStore } from "@/services";
import type { SeatSnapshot, Session, Show } from "@/types";

const shows: Show[] = [
  {
    id: "show-alpha",
    title: "Alpha",
    description: "Alpha show",
    presetId: "small",
  },
  {
    id: "show-beta",
    title: "Beta",
    description: "Beta show",
    presetId: "medium",
  },
];

const sessionsByShowId: Record<string, Session[]> = {
  "show-alpha": [
    {
      id: "alpha-next-day",
      showId: "show-alpha",
      startsAt: "2026-09-05T00:15:00.000Z",
    },
    {
      id: "alpha-late",
      showId: "show-alpha",
      startsAt: "2026-09-04T23:30:00.000Z",
    },
  ],
  "show-beta": [
    {
      id: "beta-first",
      showId: "show-beta",
      startsAt: "2026-09-04T01:00:00.000Z",
    },
  ],
};

const seatsBySessionId: Record<string, SeatSnapshot["seats"]> = {
  "alpha-late": {
    "A-1-1": { s: "sold", mine: true },
  },
  "beta-first": {
    "A-1-1": { s: "held", mine: true, expiresAt: 1_000 },
    "A-1-2": { s: "sold", mine: true },
    "A-1-3": { s: "sold" },
  },
};

function createStores(): { showStore: ShowStore; seatStore: SeatStore } {
  const showStore: ShowStore = {
    list: vi.fn(async () => shows),
    get: vi.fn(async (showId) => {
      const show = shows.find((candidate) => candidate.id === showId);
      return show
        ? { show, sessions: sessionsByShowId[showId] ?? [] }
        : null;
    }),
    getBySessionId: vi.fn(async () => null),
    create: vi.fn(async () => {
      throw new Error("not implemented in this fake");
    }),
  };

  const seatStore: SeatStore = {
    getSnapshot: vi.fn(async (sessionId) => ({
      version: 1,
      serverNow: 1_000,
      seats: seatsBySessionId[sessionId] ?? {},
    })),
    hold: vi.fn(async () => {
      throw new Error("not implemented in this fake");
    }),
    release: vi.fn(async () => {
      throw new Error("not implemented in this fake");
    }),
    confirmSeats: vi.fn(async () => {
      throw new Error("not implemented in this fake");
    }),
    releaseSold: vi.fn(async () => {
      throw new Error("not implemented in this fake");
    }),
    revertSold: vi.fn(async () => {
      throw new Error("not implemented in this fake");
    }),
  };

  return { showStore, seatStore };
}

describe("collectOperations", () => {
  it("returns every session ordered by startsAt", async () => {
    const stores = createStores();

    const rows = await collectOperations(stores, {});

    expect(rows.map((row) => row.sessionId)).toEqual([
      "beta-first",
      "alpha-late",
      "alpha-next-day",
    ]);
  });

  it("filters sessions by showId", async () => {
    const stores = createStores();

    const rows = await collectOperations(stores, { showId: "show-alpha" });

    expect(rows.map((row) => row.sessionId)).toEqual([
      "alpha-late",
      "alpha-next-day",
    ]);
  });

  it("filters sessions by their UTC date", async () => {
    const stores = createStores();

    const rows = await collectOperations(stores, { date: "2026-09-04" });

    expect(rows.map((row) => row.sessionId)).toEqual([
      "beta-first",
      "alpha-late",
    ]);
  });

  it("uses shared seat stats and sold-only sales rate calculations", async () => {
    const stores = createStores();

    const rows = await collectOperations(stores, { showId: "show-beta" });

    expect(rows).toEqual([
      {
        showId: "show-beta",
        showTitle: "Beta",
        sessionId: "beta-first",
        startsAt: "2026-09-04T01:00:00.000Z",
        total: 1_000,
        available: 997,
        held: 1,
        sold: 2,
        salesRate: 0.2,
      },
    ]);
    expect(stores.seatStore.getSnapshot).toHaveBeenCalledWith(
      "beta-first",
      "",
    );
  });

  it("does not expose snapshot ownership fields", async () => {
    const stores = createStores();

    const serialized = JSON.stringify(
      await collectOperations(stores, { showId: "show-beta" }),
    );

    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("mine");
  });

  it("returns an empty array for an unknown showId", async () => {
    const stores = createStores();

    await expect(
      collectOperations(stores, { showId: "missing-show" }),
    ).resolves.toEqual([]);
    expect(stores.showStore.get).not.toHaveBeenCalled();
    expect(stores.seatStore.getSnapshot).not.toHaveBeenCalled();
  });
});
