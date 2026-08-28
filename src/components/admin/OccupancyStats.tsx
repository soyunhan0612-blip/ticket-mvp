"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SNAPSHOT_REFETCH_INTERVAL } from "@/hooks/use-seat-snapshot";

/*
 * 세션이 만료되면 미들웨어가 401을 준다. 데이터 오류와 뭉뚱그리면 3초마다
 * 같은 문구만 반복되고 다시 로그인할 길이 없다 — 인증 실패는 따로 알린다.
 */
class UnauthorizedError extends Error {
  constructor() {
    super("로그인이 만료되었습니다.");
    this.name = "UnauthorizedError";
  }
}

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
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-md rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
        role="alert"
      >
        <p>로그인이 만료되었습니다. 다시 로그인해 주세요.</p>
        {/* 리라이트 게이트가 이 URL에서 로그인 모달을 다시 띄운다 */}
        <Button
          className="!border-on-primary !text-on-primary hover:!bg-on-primary hover:!text-primary"
          onClick={() => window.location.reload()}
          size="sm"
          variant="outline-on-dark"
        >
          다시 로그인
        </Button>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p
        className="rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
        role="alert"
      >
        점유 현황을 불러오지 못했습니다.
      </p>
    );
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
