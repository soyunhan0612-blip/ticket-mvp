"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { useMemo, useState } from "react";

import { AdminSeatMap } from "@/components/admin/AdminSeatMap";
import { OccupancyStats } from "@/components/admin/OccupancyStats";
import { OpsAgentPanel } from "@/components/admin/OpsAgentPanel";
import { OperationsPanel } from "@/components/admin/OperationsPanel";
import { SelloutAlertPanel } from "@/components/admin/SelloutAlertPanel";
import { Band } from "@/components/ui/Band";
import { generateSeats } from "@/lib/mock-data";
import { SECTIONS } from "@/lib/seat-map";
import { generateSeatsForPreset, getPreset } from "@/lib/seat-preset";
import type { Session, Show } from "@/types";

interface ShowsResponse {
  shows: Show[];
}

interface ShowDetailResponse {
  show: Show;
  sessions: Session[];
}

/* dark 밴드용 select. TextInput의 라이트 필드 스타일과 극성만 다르다 */
const ADMIN_LABEL_CLASS_NAMES = "block text-caption-upper uppercase text-on-dark";
const ADMIN_SELECT_CLASS_NAMES =
  "w-full rounded-card border border-hairline-on-dark bg-ink px-lg py-md text-body-sm text-on-dark transition-colors duration-150 focus-visible:border-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-dark focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:text-mute";

async function fetchJson<T>(url: string, message: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(message);
  return (await response.json()) as T;
}

export default function AdminPage(): JSX.Element {
  const [showId, setShowId] = useState("");
  const [sessionId, setSessionId] = useState("");

  const showsQuery = useQuery<ShowsResponse>({
    queryKey: ["shows"],
    queryFn: () => fetchJson("/api/shows", "공연 목록을 불러오지 못했습니다."),
  });
  const detailQuery = useQuery<ShowDetailResponse>({
    queryKey: ["show", showId],
    queryFn: () =>
      fetchJson(
        `/api/shows/${encodeURIComponent(showId)}`,
        "회차 목록을 불러오지 못했습니다.",
      ),
    enabled: showId !== "",
  });

  const selectedShow = detailQuery.data?.show;
  // Seeded shows carry no presetId, so fall back to the full map exactly as the
  // viewer seat page does — and as /api/admin/stats does for its total.
  const presetId = selectedShow?.presetId;
  const seats = useMemo(
    () => (presetId ? generateSeatsForPreset(presetId) : generateSeats()),
    [presetId],
  );
  const sections = useMemo(
    () => (presetId ? getPreset(presetId).sections : SECTIONS),
    [presetId],
  );
  const canShowDashboard = sessionId !== "" && selectedShow !== undefined;

  return (
    <main className="flex flex-1 flex-col">
      {/* 도구 화면이라 dark 밴드 (docs/UI_GUIDE.md 밴드 정책) */}
      <Band fill tone="dark" width="tool">
        <div className="space-y-2xl">
          <header className="space-y-sm">
            <h1 className="text-display-sm">실시간 점유 현황</h1>
            <p className="text-body-sm text-mute">
              공연과 회차를 선택해 좌석 상태를 확인하세요.
            </p>
          </header>

          <div className="grid gap-lg sm:grid-cols-2">
            <div className="space-y-xs">
              <label className={ADMIN_LABEL_CLASS_NAMES} htmlFor="admin-show">
                공연
              </label>
              <select
                className={ADMIN_SELECT_CLASS_NAMES}
                disabled={showsQuery.isLoading || showsQuery.isError}
                id="admin-show"
                onChange={(event) => {
                  setShowId(event.target.value);
                  setSessionId("");
                }}
                value={showId}
              >
                <option value="">공연 선택</option>
                {showsQuery.data?.shows.map((show) => (
                  <option key={show.id} value={show.id}>
                    {show.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-xs">
              <label
                className={ADMIN_LABEL_CLASS_NAMES}
                htmlFor="admin-session"
              >
                회차
              </label>
              <select
                className={ADMIN_SELECT_CLASS_NAMES}
                disabled={!detailQuery.data || detailQuery.isLoading}
                id="admin-session"
                onChange={(event) => setSessionId(event.target.value)}
                value={sessionId}
              >
                <option value="">회차 선택</option>
                {detailQuery.data?.sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {new Date(session.startsAt).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(showsQuery.isError || detailQuery.isError) && (
            <p
              className="rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
              role="alert"
            >
              공연 또는 회차 목록을 불러오지 못했습니다.
            </p>
          )}

          <OperationsPanel showId={showId} />

          <OpsAgentPanel showId={showId} />

          <SelloutAlertPanel showId={showId} />

          {canShowDashboard && (
            <div className="space-y-2xl">
              <OccupancyStats sessionId={sessionId} />
              <AdminSeatMap
                seats={seats}
                sections={sections}
                sessionId={sessionId}
              />
            </div>
          )}
        </div>
      </Band>
    </main>
  );
}
