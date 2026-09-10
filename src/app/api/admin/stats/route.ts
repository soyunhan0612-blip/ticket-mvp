import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/cookie";
import { computeSeatStats } from "@/lib/seat-stats";
import { getSeatStore, getShowStore } from "@/services";

const sessionIdSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/);

export async function GET(request: Request): Promise<Response> {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedSessionId = sessionIdSchema.safeParse(
    new URL(request.url).searchParams.get("sessionId"),
  );
  if (!parsedSessionId.success) {
    return Response.json({ error: "invalid session id" }, { status: 400 });
  }

  const sessionId = parsedSessionId.data;
  const showSession = await getShowStore().getBySessionId(sessionId);
  if (!showSession) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }

  const snapshot = await getSeatStore().getSnapshot(sessionId, userId);
  const stats = computeSeatStats(snapshot.seats, showSession.show.presetId);

  return Response.json({
    ...stats,
    version: snapshot.version,
    serverNow: snapshot.serverNow,
  });
}
