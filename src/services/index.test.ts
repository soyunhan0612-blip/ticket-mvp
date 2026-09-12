import { afterEach, describe, expect, it, vi } from "vitest";

const REDIS_ENV = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
};

async function importStores() {
  const stores = await import("./index");
  const memory = await Promise.all([
    import("./show-store-memory"),
    import("./seat-store-memory"),
    import("./reservation-store-memory"),
    import("./conversation-store-memory"),
  ]);

  return { stores, memory };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("store factory backend selection", () => {
  it("returns singleton memory stores when Redis is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.resetModules();

    const { stores, memory } = await importStores();
    const seatStore = stores.getSeatStore();

    expect(stores.getShowStore()).toBe(memory[0].createShowStoreMemory());
    expect(seatStore).toBe(memory[1].createSeatStoreMemory());
    expect(stores.getReservationStore()).toBe(
      memory[2].createReservationStoreMemory(seatStore),
    );
    expect(stores.getConversationStore()).toBe(
      memory[3].createConversationStoreMemory(),
    );
    expect(stores.getShowStore()).toBe(stores.getShowStore());
    expect(stores.getSeatStore()).toBe(stores.getSeatStore());
    expect(stores.getReservationStore()).toBe(stores.getReservationStore());
    expect(stores.getConversationStore()).toBe(stores.getConversationStore());
  });

  it("returns singleton Redis stores when Redis is configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", REDIS_ENV.UPSTASH_REDIS_REST_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", REDIS_ENV.UPSTASH_REDIS_REST_TOKEN);
    vi.resetModules();

    const { stores, memory } = await importStores();
    const showStore = stores.getShowStore();
    const seatStore = stores.getSeatStore();
    const reservationStore = stores.getReservationStore();
    const conversationStore = stores.getConversationStore();

    expect(showStore).not.toBe(memory[0].createShowStoreMemory());
    expect(seatStore).not.toBe(memory[1].createSeatStoreMemory());
    expect(reservationStore).not.toBe(
      memory[2].createReservationStoreMemory(memory[1].createSeatStoreMemory()),
    );
    expect(conversationStore).not.toBe(memory[3].createConversationStoreMemory());
    expect(stores.getShowStore()).toBe(showStore);
    expect(stores.getSeatStore()).toBe(seatStore);
    expect(stores.getReservationStore()).toBe(reservationStore);
    expect(stores.getConversationStore()).toBe(conversationStore);
  });
});
