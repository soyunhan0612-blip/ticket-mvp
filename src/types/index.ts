import type { SeatPresetId } from "@/lib/seat-preset";

export interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl?: string;
  presetId?: SeatPresetId;
}

export interface Session {
  id: string;
  showId: string;
  startsAt: string;
}

export interface Seat {
  id: string;
  section: string;
  row: number;
  col: number;
}

export type SeatStatus = "available" | "held" | "sold";

export type SeatVisualState =
  | "available"
  | "selected"
  | "held-other"
  | "sold";

export interface Hold {
  id: string;
  sessionId: string;
  seatIds: string[];
  userId: string;
  expiresAt: number;
}

export interface Reservation {
  id: string;
  sessionId: string;
  seatIds: string[];
  userId: string;
  status: "confirmed" | "cancelled";
  createdAt: number;
}

export interface SeatSnapshotEntry {
  s: "held" | "sold";
  mine?: boolean;
  expiresAt?: number;
}

export interface SeatSnapshot {
  version: number;
  serverNow: number;
  seats: Record<string, SeatSnapshotEntry>;
}

export type ChatTurnRole = "user" | "assistant" | "operator" | "notice";

export interface ChatTurn {
  id: string;
  role: ChatTurnRole;
  content: string;
  createdAt: number;
}

export interface ConversationEscalation {
  askedAt: number;
  slackThreadTs: string | null;
  autoReplySentAt: number | null;
  answeredAt: number | null;
}

export interface Conversation {
  id: string;
  userId: string;
  turns: ChatTurn[];
  escalation: ConversationEscalation | null;
  updatedAt: number;
}
