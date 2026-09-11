import { neutralizeUserInput } from "@/lib/ai-prompt";
import type { OperationsRow } from "@/lib/operations";

export const SELLOUT_RISK_THRESHOLD = 90;
export const SELLOUT_ALERT_TITLE_MAX_LENGTH = 80;

export function selectSelloutRiskRows(
  rows: OperationsRow[],
  threshold: number = SELLOUT_RISK_THRESHOLD,
): OperationsRow[] {
  return rows
    .filter((row) => row.salesRate >= threshold)
    .sort((left, right) => right.salesRate - left.salesRate);
}

export function buildSelloutAlertText(rows: OperationsRow[]): string {
  return rows
    .map((row) => {
      const showTitle = neutralizeUserInput(
        row.showTitle,
        SELLOUT_ALERT_TITLE_MAX_LENGTH,
      );

      return `매진 임박: ${showTitle} · 시작 ${row.startsAt} · 판매율 ${row.salesRate.toFixed(1)}% · 남은 좌석 ${row.available}석`;
    })
    .join("\n");
}
