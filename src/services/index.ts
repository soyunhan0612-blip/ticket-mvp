import { createConversationStoreMemory } from "./conversation-store-memory";
import { createConversationStoreRedis } from "./conversation-store-redis";
import { createReservationStoreMemory } from "./reservation-store-memory";
import { createReservationStoreRedis } from "./reservation-store-redis";
import { hasRedisConfig } from "./redis-client";
import { createSeatStoreMemory } from "./seat-store-memory";
import { createSeatStoreRedis } from "./seat-store-redis";
import { createShowStoreMemory } from "./show-store-memory";
import { createShowStoreRedis } from "./show-store-redis";
import type { ConversationStore } from "./conversation-store";
import type { ReservationStore } from "./reservation-store";
import type { SeatStore } from "./seat-store";
import type { ShowStore } from "./show-store";

export type { ConversationStore } from "./conversation-store";
export type { ReservationStore } from "./reservation-store";
export type { SeatStore } from "./seat-store";
export type { ShowStore } from "./show-store";

let instance: ShowStore | null = null;
let seatInstance: SeatStore | null = null;
let reservationInstance: ReservationStore | null = null;
let conversationInstance: ConversationStore | null = null;
const useRedis = hasRedisConfig();

export function getShowStore(): ShowStore {
  if (!instance) {
    instance = useRedis ? createShowStoreRedis() : createShowStoreMemory();
  }
  return instance;
}

export function getSeatStore(): SeatStore {
  if (!seatInstance) {
    seatInstance = useRedis ? createSeatStoreRedis() : createSeatStoreMemory();
  }
  return seatInstance;
}

export function getReservationStore(): ReservationStore {
  if (!reservationInstance) {
    const seatStore = getSeatStore();
    reservationInstance = useRedis
      ? createReservationStoreRedis(seatStore)
      : createReservationStoreMemory(seatStore);
  }
  return reservationInstance;
}

export function getConversationStore(): ConversationStore {
  if (!conversationInstance) {
    conversationInstance = useRedis
      ? createConversationStoreRedis()
      : createConversationStoreMemory();
  }
  return conversationInstance;
}
