import { z } from "zod";

import { collectOperations } from "@/lib/operations";
import { getSeatStore, getShowStore } from "@/services";

const querySchema = z.object({
  showId: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/).optional(),
  date: z.iso.date().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const parsedFilter = querySchema.safeParse({
    showId: searchParams.get("showId") ?? undefined,
    date: searchParams.get("date") ?? undefined,
  });

  if (!parsedFilter.success) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }

  const sessions = await collectOperations(
    { showStore: getShowStore(), seatStore: getSeatStore() },
    parsedFilter.data,
  );

  return Response.json({ sessions });
}
