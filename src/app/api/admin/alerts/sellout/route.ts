import { z } from "zod";

import { collectOperations } from "@/lib/operations";
import {
  buildSelloutAlertText,
  SELLOUT_RISK_THRESHOLD,
  selectSelloutRiskRows,
} from "@/lib/sellout-alert";
import { getSeatStore, getShowStore } from "@/services";

const querySchema = z.object({
  threshold: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(SELLOUT_RISK_THRESHOLD),
  showId: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/).optional(),
  date: z.iso.date().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const parsedQuery = querySchema.safeParse({
    threshold: searchParams.get("threshold") ?? undefined,
    showId: searchParams.get("showId") ?? undefined,
    date: searchParams.get("date") ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }

  const { threshold, showId, date } = parsedQuery.data;
  const operations = await collectOperations(
    { showStore: getShowStore(), seatStore: getSeatStore() },
    { showId, date },
  );
  const sessions = selectSelloutRiskRows(operations, threshold);

  return Response.json({
    threshold,
    sessions,
    text: buildSelloutAlertText(sessions),
  });
}
