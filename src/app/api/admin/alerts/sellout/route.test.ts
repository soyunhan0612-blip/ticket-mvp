import { describe, expect, it } from "vitest";

import { SELLOUT_RISK_THRESHOLD } from "@/lib/sellout-alert";
import type { OperationsRow } from "@/lib/operations";
import { getSeatStore, getShowStore } from "@/services";

import { GET } from "./route";

interface SelloutAlertResponse {
  threshold: number;
  sessions: OperationsRow[];
  text: string;
}

function makeRequest(
  filter: { threshold?: number | string; showId?: string; date?: string } = {},
): Request {
  const url = new URL("http://localhost/api/admin/alerts/sellout");
  if (filter.threshold !== undefined) {
    url.searchParams.set("threshold", String(filter.threshold));
  }
  if (filter.showId !== undefined) {
    url.searchParams.set("showId", filter.showId);
  }
  if (filter.date !== undefined) url.searchParams.set("date", filter.date);

  return new Request(url);
}

async function createAlertShow(
  sessions: string[] = ["2026-12-20T10:00:00.000Z"],
) {
  return getShowStore().create({
    title: `Sellout alert ${crypto.randomUUID()}`,
    description: "Sellout alert route test",
    posterUrl: "/posters/concert.svg",
    presetId: "small",
    sessions,
  });
}

async function sellSeats(
  sessionId: string,
  seatIds: string[],
  owner: string = `sellout-owner-${crypto.randomUUID()}`,
): Promise<void> {
  await getSeatStore().hold(sessionId, seatIds, owner);
  await getSeatStore().confirmSeats(sessionId, seatIds, owner);
}

describe("GET /api/admin/alerts/sellout", () => {
  it("uses the configured default threshold when threshold is omitted", async () => {
    const { show } = await createAlertShow();

    const response = await GET(makeRequest({ showId: show.id }));
    const body = (await response.json()) as SelloutAlertResponse;

    expect(response.status).toBe(200);
    expect(body.threshold).toBe(SELLOUT_RISK_THRESHOLD);
  });

  it("returns only sessions at or above the threshold in descending sales-rate order", async () => {
    const { show, sessions } = await createAlertShow([
      "2026-12-21T10:00:00.000Z",
      "2026-12-22T10:00:00.000Z",
      "2026-12-23T10:00:00.000Z",
    ]);
    await sellSeats(sessions[0].id, ["A-1-1"]);
    await sellSeats(sessions[1].id, ["A-1-1", "A-1-2"]);

    const response = await GET(makeRequest({
      threshold: 0.2,
      showId: show.id,
    }));
    const body = (await response.json()) as SelloutAlertResponse;

    expect(response.status).toBe(200);
    expect(body.sessions.map(({ sessionId, salesRate }) => ({
      sessionId,
      salesRate,
    }))).toEqual([
      { sessionId: sessions[1].id, salesRate: 0.4 },
      { sessionId: sessions[0].id, salesRate: 0.2 },
    ]);
    expect(body.text).not.toBe("");
  });

  it("returns an empty sessions array and text when no session reaches the threshold", async () => {
    const { show } = await createAlertShow();

    const response = await GET(makeRequest({
      threshold: 100,
      showId: show.id,
    }));

    await expect(response.json()).resolves.toEqual({
      threshold: 100,
      sessions: [],
      text: "",
    });
  });

  it.each(["not-a-number", -0.1, 100.1])(
    "returns 400 for invalid threshold %s",
    async (threshold) => {
      const response = await GET(makeRequest({ threshold }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid query" });
    },
  );

  it("applies the showId filter", async () => {
    const included = await createAlertShow();
    const excluded = await createAlertShow();

    const response = await GET(makeRequest({
      threshold: 0,
      showId: included.show.id,
    }));
    const body = (await response.json()) as SelloutAlertResponse;

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].showId).toBe(included.show.id);
    expect(body.sessions[0].showId).not.toBe(excluded.show.id);
  });

  it("does not serialize userId or ownership fields", async () => {
    const { show, sessions } = await createAlertShow();
    const owner = `secret-alert-owner-${crypto.randomUUID()}`;
    await getSeatStore().hold(sessions[0].id, ["A-1-1"], owner);

    const response = await GET(makeRequest({
      threshold: 0,
      showId: show.id,
    }));
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("mine");
  });

  it("does not return 401 when the request has no cookie", async () => {
    const { show } = await createAlertShow();
    const request = makeRequest({ threshold: 0, showId: show.id });

    expect(request.headers.get("cookie")).toBeNull();

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.status).not.toBe(401);
  });
});
