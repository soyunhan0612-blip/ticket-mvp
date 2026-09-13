import type { ReservationStore, SeatStore, ShowStore } from "@/services";

export interface TicketChatDeps {
  showStore: Pick<ShowStore, "list" | "get" | "getBySessionId">;
  seatStore: Pick<SeatStore, "getSnapshot">;
  reservationStore: Pick<ReservationStore, "listByUser">;
  userId: string;
}
