import { describe, expect, it } from "vitest";

import {
  buildSelloutAlertText,
  SELLOUT_ALERT_TITLE_MAX_LENGTH,
  SELLOUT_RISK_THRESHOLD,
  selectSelloutRiskRows,
} from "@/lib/sellout-alert";
import type { OperationsRow } from "@/lib/operations";

function createRow(
  overrides: Partial<OperationsRow> = {},
): OperationsRow {
  return {
    showId: "show-alpha",
    showTitle: "Alpha",
    sessionId: "session-alpha",
    startsAt: "2026-09-12T10:00:00.000Z",
    total: 1_000,
    available: 80,
    held: 10,
    sold: 910,
    salesRate: 91,
    ...overrides,
  };
}

describe("selectSelloutRiskRows", () => {
  it("keeps only rows at or above the threshold", () => {
    const rows = [
      createRow({ sessionId: "below", salesRate: 89.9 }),
      createRow({ sessionId: "above", salesRate: 90.1 }),
    ];

    expect(selectSelloutRiskRows(rows, 90).map((row) => row.sessionId))
      .toEqual(["above"]);
  });

  it("keeps a row exactly equal to the threshold", () => {
    const row = createRow({ salesRate: 90 });

    expect(selectSelloutRiskRows([row], 90)).toEqual([row]);
  });

  it("orders the result by sales rate descending", () => {
    const rows = [
      createRow({ sessionId: "middle", salesRate: 94.5 }),
      createRow({ sessionId: "highest", salesRate: 99 }),
      createRow({ sessionId: "lowest", salesRate: 90 }),
    ];

    expect(selectSelloutRiskRows(rows).map((row) => row.sessionId)).toEqual([
      "highest",
      "middle",
      "lowest",
    ]);
  });

  it("uses SELLOUT_RISK_THRESHOLD when the threshold is omitted", () => {
    const below = createRow({ salesRate: SELLOUT_RISK_THRESHOLD - 0.1 });
    const boundary = createRow({ salesRate: SELLOUT_RISK_THRESHOLD });

    expect(selectSelloutRiskRows([below, boundary])).toEqual([boundary]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      createRow({ sessionId: "lower", salesRate: 91 }),
      createRow({ sessionId: "higher", salesRate: 99 }),
    ];
    const originalOrder = [...rows];

    selectSelloutRiskRows(rows);

    expect(rows).toEqual(originalOrder);
  });
});

describe("buildSelloutAlertText", () => {
  it("returns an empty string when there are no rows", () => {
    expect(buildSelloutAlertText([])).toBe("");
  });

  it("includes the title, start time, sales rate, and available seats", () => {
    const row = createRow({
      showTitle: "Alpha Concert",
      startsAt: "2026-09-12T10:00:00.000Z",
      salesRate: 91.2,
      available: 78,
    });

    const text = buildSelloutAlertText([row]);

    expect(text).toContain("Alpha Concert");
    expect(text).toContain("2026-09-12T10:00:00.000Z");
    expect(text).toContain("91.2%");
    expect(text).toContain("78석");
  });

  it("keeps each alert row on one line when a title contains newlines", () => {
    const row = createRow({ showTitle: "Alpha\nConcert" });

    expect(buildSelloutAlertText([row]).split("\n")).toEqual([
      expect.stringContaining("Alpha Concert"),
    ]);
  });

  it("limits a seller-provided title to the alert title maximum", () => {
    const row = createRow({
      showTitle: "A".repeat(SELLOUT_ALERT_TITLE_MAX_LENGTH + 1),
    });

    const text = buildSelloutAlertText([row]);

    expect(text).toContain("A".repeat(SELLOUT_ALERT_TITLE_MAX_LENGTH));
    expect(text).not.toContain(
      "A".repeat(SELLOUT_ALERT_TITLE_MAX_LENGTH + 1),
    );
  });
});
