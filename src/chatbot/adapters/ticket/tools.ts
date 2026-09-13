import { z } from "zod";

import { computeSeatStats } from "@/lib/seat-stats";

import { wrapUserInput } from "../../core/sanitize";
import type { ChatToolDescriptor } from "../../core/types";
import type { TicketChatDeps } from "./deps";
import { REFUND_POLICY_TEXT } from "./refund-policy";

const emptyInputSchema = z.object({});
const getShowInputSchema = z.object({
  showId: z.string().min(1),
});
const getSessionAvailabilityInputSchema = z.object({
  sessionId: z.string().min(1),
});

export function createTicketChatTools(
  deps: TicketChatDeps,
): ChatToolDescriptor[] {
  return [
    {
      name: "list_shows",
      description:
        "전체 공연을 찾거나 공연 ID와 제목을 확인할 때 사용한다. 입력 없이 공연 목록을 반환한다.",
      inputSchema: emptyInputSchema,
      async run() {
        const shows = await deps.showStore.list();

        return JSON.stringify({
          shows: shows.map((show) => ({
            id: show.id,
            title: wrapUserInput(show.title),
          })),
        });
      },
    },
    {
      name: "get_show",
      description:
        "공연 ID로 공연의 제목, 설명, 회차 목록을 조회할 때 사용한다.",
      inputSchema: getShowInputSchema,
      async run(args) {
        const { showId } = getShowInputSchema.parse(args);
        const result = await deps.showStore.get(showId);

        if (!result) return JSON.stringify({ found: false });

        return JSON.stringify({
          found: true,
          show: {
            id: result.show.id,
            title: wrapUserInput(result.show.title),
            description: wrapUserInput(result.show.description, 600),
          },
          sessions: result.sessions.map((session) => ({
            id: session.id,
            startsAt: session.startsAt,
          })),
        });
      },
    },
    {
      name: "get_session_availability",
      description:
        "회차 ID로 공연 제목, 회차 시각, 전체·잔여·점유·판매 좌석 수를 조회할 때 사용한다.",
      inputSchema: getSessionAvailabilityInputSchema,
      async run(args) {
        const { sessionId } = getSessionAvailabilityInputSchema.parse(args);
        const result = await deps.showStore.getBySessionId(sessionId);

        if (!result) return JSON.stringify({ found: false });

        const snapshot = await deps.seatStore.getSnapshot(sessionId, "");
        const stats = computeSeatStats(
          snapshot.seats,
          result.show.presetId,
        );

        return JSON.stringify({
          found: true,
          showTitle: wrapUserInput(result.show.title),
          startsAt: result.session.startsAt,
          ...stats,
        });
      },
    },
    {
      name: "list_my_reservations",
      description:
        "현재 관람객 본인의 예매 목록과 각 예매의 공연·회차 정보를 조회할 때 사용한다.",
      inputSchema: emptyInputSchema,
      async run() {
        const reservations = await deps.reservationStore.listByUser(
          deps.userId,
        );
        const enrichedReservations = await Promise.all(
          reservations.map(async (reservation) => {
            const related = await deps.showStore.getBySessionId(
              reservation.sessionId,
            );

            return {
              id: reservation.id,
              status: reservation.status,
              createdAt: reservation.createdAt,
              seatIds: reservation.seatIds,
              showTitle: related
                ? wrapUserInput(related.show.title)
                : null,
              startsAt: related?.session.startsAt ?? null,
            };
          }),
        );

        return JSON.stringify({ reservations: enrichedReservations });
      },
    },
    {
      name: "get_refund_policy",
      description:
        "예매 취소 가능 범위와 이 서비스에 구현된 환불 정책을 안내할 때 사용한다.",
      inputSchema: emptyInputSchema,
      async run() {
        return JSON.stringify({ policy: REFUND_POLICY_TEXT });
      },
    },
  ];
}
