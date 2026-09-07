import { describe, expect, it } from "vitest";

import { getSeatStore, getShowStore } from "@/services";

import { GET } from "./route";

interface OperationsResponse {
  sessions: Array<{
    showId: string;
    showTitle: string;
    sessionId: string;
    startsAt: string;
    total: number;
    available: number;
    held: number;
    sold: number;
    salesRate: number;
  }>;
}

function makeRequest(filter: { showId?: string; date?: string } = {}): Request {
  const url = new URL("http://localhost/api/admin/operations");
  if (filter.showId !== undefined) {
    url.searchParams.set("showId", filter.showId);
  }
  if (filter.date !== undefined) url.searchParams.set("date", filter.date);

  return new Request(url);
}

async function createOperationsSession() {
  const result = await getShowStore().create({
    title: `Operations ${crypto.randomUUID()}`,
    description: "Operations route test",
    posterUrl: "/posters/concert.svg",
    presetId: "small",
    sessions: ["2026-12-15T23:30:00.000Z"],
  });

  return { show: result.show, session: result.sessions[0] };
}

describe("GET /api/admin/operations", () => {
  it("returns aggregate rows without requiring a userId cookie", async () => {
    const { show, session } = await createOperationsSession();
    const owner = `operations-owner-${crypto.randomUUID()}`;
    await getSeatStore().hold(
      session.id,
      ["A-1-1", "A-1-2"],
      owner,
    );
    await getSeatStore().confirmSeats(session.id, ["A-1-2"], owner);

    const response = await GET(makeRequest({ showId: show.id }));
    const body = (await response.json()) as OperationsResponse;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      sessions: [
        {
          showId: show.id,
          showTitle: show.title,
          sessionId: session.id,
          startsAt: session.startsAt,
          total: 500,
          available: 498,
          held: 1,
          sold: 1,
          salesRate: 0.2,
        },
      ],
    });
  });

  it("returns 400 for an invalid date", async () => {
    const response = await GET(makeRequest({ date: "2026-02-30" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid query" });
  });

  it("returns 400 for an invalid showId", async () => {
    const response = await GET(makeRequest({ showId: "invalid show id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid query" });
  });

  it("does not serialize userId or mine fields", async () => {
    const { show, session } = await createOperationsSession();
    const owner = `secret-operations-owner-${crypto.randomUUID()}`;
    await getSeatStore().hold(session.id, ["A-2-1"], owner);

    const response = await GET(makeRequest({ showId: show.id }));
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("mine");
  });
});
