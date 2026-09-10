import { parseSeatId, SECTIONS, TOTAL_SEATS } from "@/lib/seat-map";
import { getPreset, type SeatPresetId } from "@/lib/seat-preset";
import type { SeatSnapshot } from "@/types";

export interface SeatStats {
  total: number;
  available: number;
  held: number;
  sold: number;
}

export function computeSalesRate(sold: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((sold / total) * 1_000) / 10;
}

export function computeSeatStats(
  seats: SeatSnapshot["seats"],
  presetId?: SeatPresetId,
): SeatStats {
  const preset = presetId ? getPreset(presetId) : undefined;
  const total = preset ? preset.totalSeats : TOTAL_SEATS;
  const sections: ReadonlySet<string> = new Set(
    preset ? preset.sections : SECTIONS,
  );

  let held = 0;
  let sold = 0;

  for (const [seatId, seat] of Object.entries(seats)) {
    const parsed = parseSeatId(seatId);
    if (!parsed || !sections.has(parsed.section)) continue;

    if (seat.s === "held") held += 1;
    else if (seat.s === "sold") sold += 1;
  }

  return {
    total,
    available: total - held - sold,
    held,
    sold,
  };
}
