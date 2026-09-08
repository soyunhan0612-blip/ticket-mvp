"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";

import {
  ErrorNotice,
  UnauthorizedNotice,
} from "@/components/admin/admin-query";
import { Card } from "@/components/ui/Card";
import { SNAPSHOT_REFETCH_INTERVAL } from "@/hooks/use-seat-snapshot";
import { UnauthorizedError } from "@/lib/api-error";

interface OccupancyStatsProps {
  sessionId: string;
}

interface OccupancyStatsResponse {
  total: number;
  available: number;
  held: number;
  sold: number;
  version: number;
  serverNow: number;
}

const CARDS = [
  ["전체", "total"],
  ["예매가능", "available"],
  ["홀드중", "held"],
  ["판매완료", "sold"],
] as const;

export function OccupancyStats({
  sessionId,
}: OccupancyStatsProps): JSX.Element {
  const { data, error, isLoading, isError } = useQuery<OccupancyStatsResponse>({
    queryKey: ["admin-stats", sessionId],
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/stats?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (response.status === 401) {
        throw new UnauthorizedError();
      }
      if (!response.ok) {
        throw new Error("점유 현황을 불러오지 못했습니다.");
      }
      return (await response.json()) as OccupancyStatsResponse;
    },
    // 인증이 끊긴 뒤로도 3초마다 두드리는 것은 의미가 없다.
    refetchInterval: (query) =>
      query.state.error instanceof UnauthorizedError
        ? false
        : SNAPSHOT_REFETCH_INTERVAL,
  });

  if (isLoading) {
    return <p className="text-center text-body-sm text-mute">집계 중...</p>;
  }

  if (error instanceof UnauthorizedError) {
    return <UnauthorizedNotice />;
  }

  if (isError || !data) {
    return <ErrorNotice>점유 현황을 불러오지 못했습니다.</ErrorNotice>;
  }

  return (
    // 숫자 4개는 대등하다. 하나만 키우면 계층 실패 (UX_PRINCIPLES.md 계층)
    <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map(([label, key]) => (
        <Card key={key} tone="dark">
          <p className="text-caption-upper uppercase text-mute">{label}</p>
          <p className="mt-sm text-display-xs">
            {data[key].toLocaleString("ko-KR")}
          </p>
        </Card>
      ))}
    </div>
  );
}
