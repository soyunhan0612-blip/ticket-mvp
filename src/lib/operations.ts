import { computeSalesRate, computeSeatStats } from "@/lib/seat-stats";
import type { OpsReadStores } from "@/lib/ops-agent-tools";

export interface OperationsRow {
  showId: string;
  showTitle: string;
  sessionId: string;
  startsAt: string;
  total: number;
  available: number;
  held: number;
  sold: number;
  salesRate: number;
}

export interface OperationsFilter {
  showId?: string;
  date?: string;
}

export async function collectOperations(
  stores: OpsReadStores,
  filter: OperationsFilter,
): Promise<OperationsRow[]> {
  const shows = (await stores.showStore.list()).filter(
    (show) => filter.showId === undefined || show.id === filter.showId,
  );

  const rowsByShow = await Promise.all(
    shows.map(async (listedShow) => {
      const showWithSessions = await stores.showStore.get(listedShow.id);
      if (!showWithSessions) return [];

      const { show, sessions } = showWithSessions;
      const filteredSessions = sessions.filter(
        (session) =>
          filter.date === undefined || session.startsAt.slice(0, 10) === filter.date,
      );

      return Promise.all(
        filteredSessions.map(async (session): Promise<OperationsRow> => {
          const snapshot = await stores.seatStore.getSnapshot(session.id, "");
          const stats = computeSeatStats(snapshot.seats, show.presetId);

          return {
            showId: show.id,
            showTitle: show.title,
            sessionId: session.id,
            startsAt: session.startsAt,
            ...stats,
            salesRate: computeSalesRate(stats.sold, stats.total),
          };
        }),
      );
    }),
  );

  return rowsByShow
    .flat()
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}
