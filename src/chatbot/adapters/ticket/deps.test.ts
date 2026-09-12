import { expectTypeOf, it } from "vitest";

import type { TicketChatDeps } from "./deps";

it("exposes only the ticket read dependencies and the injected user id", () => {
  expectTypeOf<TicketChatDeps>().toHaveProperty("showStore");
  expectTypeOf<TicketChatDeps>().toHaveProperty("seatStore");
  expectTypeOf<TicketChatDeps>().toHaveProperty("reservationStore");
  expectTypeOf<TicketChatDeps>().toHaveProperty("userId");

  expectTypeOf<TicketChatDeps["showStore"]>().toHaveProperty("list");
  expectTypeOf<TicketChatDeps["showStore"]>().toHaveProperty("get");
  expectTypeOf<TicketChatDeps["showStore"]>().toHaveProperty("getBySessionId");
  expectTypeOf<TicketChatDeps["seatStore"]>().toHaveProperty("getSnapshot");
  expectTypeOf<TicketChatDeps["reservationStore"]>().toHaveProperty(
    "listByUser",
  );
});

it("removes every write method from the dependency types", () => {
  type ShowStoreCanCreate = "create" extends keyof TicketChatDeps["showStore"]
    ? true
    : false;
  type SeatStoreCanHold = "hold" extends keyof TicketChatDeps["seatStore"]
    ? true
    : false;
  type SeatStoreCanRelease = "release" extends keyof TicketChatDeps["seatStore"]
    ? true
    : false;
  type SeatStoreCanConfirm =
    "confirmSeats" extends keyof TicketChatDeps["seatStore"] ? true : false;
  type ReservationStoreCanCreate =
    "create" extends keyof TicketChatDeps["reservationStore"] ? true : false;
  type ReservationStoreCanCancel =
    "cancel" extends keyof TicketChatDeps["reservationStore"] ? true : false;

  expectTypeOf<ShowStoreCanCreate>().toEqualTypeOf<false>();
  expectTypeOf<SeatStoreCanHold>().toEqualTypeOf<false>();
  expectTypeOf<SeatStoreCanRelease>().toEqualTypeOf<false>();
  expectTypeOf<SeatStoreCanConfirm>().toEqualTypeOf<false>();
  expectTypeOf<ReservationStoreCanCreate>().toEqualTypeOf<false>();
  expectTypeOf<ReservationStoreCanCancel>().toEqualTypeOf<false>();
});
