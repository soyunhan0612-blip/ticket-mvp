"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { OperationsRow } from "@/lib/operations";

interface OperationsPanelProps {
  /** 빈 문자열이면 전체 공연 */
  showId: string;
}

interface OperationsResponse {
  sessions: OperationsRow[];
}

class UnauthorizedError extends Error {
  constructor() {
    super("로그인이 만료되었습니다.");
    this.name = "UnauthorizedError";
  }
}

function formatSessionTime(startsAt: string): string {
  return new Date(startsAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
  });
}

function UnauthorizedNotice(): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-md rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
      role="alert"
    >
      <p>로그인이 만료되었습니다. 다시 로그인해 주세요.</p>
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

function ErrorNotice({ children }: { children: string }): JSX.Element {
  return (
    <p
      className="rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
      role="alert"
    >
      {children}
    </p>
  );
}

export function OperationsPanel({
  showId,
}: OperationsPanelProps): JSX.Element {
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState<Error | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const operationsQuery = useQuery<OperationsResponse>({
    queryKey: ["admin-operations", showId],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (showId !== "") searchParams.set("showId", showId);

      const query = searchParams.toString();
      const response = await fetch(
        `/api/admin/operations${query ? `?${query}` : ""}`,
      );
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) {
        throw new Error("운영 현황을 불러오지 못했습니다.");
      }

      return (await response.json()) as OperationsResponse;
    },
  });

  useEffect(() => {
    setSummary("");
    setSummaryError(null);
  }, [showId]);

  const generateSummary = useCallback(async () => {
    setIsSummarizing(true);
    setSummary("");
    setSummaryError(null);

    try {
      const response = await fetch("/api/admin/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(showId === "" ? {} : { showId }),
      });

      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) {
        throw new Error("운영 요약을 생성하지 못했습니다.");
      }
      if (!response.body) {
        throw new Error("운영 요약을 생성하지 못했습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        received += chunk;
        setSummary((current) => current + chunk);
      }

      const finalChunk = decoder.decode();
      received += finalChunk;
      setSummary((current) => current + finalChunk);

      if (received.length === 0) {
        throw new Error("운영 요약을 생성하지 못했습니다.");
      }
    } catch (error) {
      setSummary("");
      setSummaryError(
        error instanceof Error
          ? error
          : new Error("운영 요약을 생성하지 못했습니다."),
      );
    } finally {
      setIsSummarizing(false);
    }
  }, [showId]);

  return (
    <section aria-labelledby="operations-heading" className="space-y-xl">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div className="space-y-xs">
          <h2 className="text-display-xs" id="operations-heading">
            회차별 운영 현황
          </h2>
          <p className="text-body-sm text-mute">
            {showId === ""
              ? "전체 공연의 회차를 비교합니다."
              : "선택한 공연의 회차를 비교합니다."}
          </p>
        </div>
        <Button
          disabled={operationsQuery.isFetching}
          onClick={() => void operationsQuery.refetch()}
          size="sm"
          variant="outline-on-dark"
        >
          {operationsQuery.isFetching ? "갱신 중..." : "현황 새로고침"}
        </Button>
      </header>

      <Card className="space-y-md" tone="dark">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <div className="space-y-xs">
            <h3 className="text-body-md">AI 운영 요약</h3>
            <p className="text-body-sm text-mute">
              현재 필터의 서버 집계를 요청할 때만 요약합니다.
            </p>
          </div>
          <Button
            disabled={isSummarizing}
            onClick={() => void generateSummary()}
            size="sm"
            variant="outline-on-dark"
          >
            {isSummarizing ? "요약 중..." : "운영 현황 요약"}
          </Button>
        </div>

        {summaryError instanceof UnauthorizedError ? (
          <UnauthorizedNotice />
        ) : summaryError ? (
          <ErrorNotice>{summaryError.message}</ErrorNotice>
        ) : null}

        {summary && (
          <p className="whitespace-pre-wrap text-body-sm text-on-dark">
            {summary}
          </p>
        )}
      </Card>

      {operationsQuery.isLoading ? (
        <p className="text-center text-body-sm text-mute">집계 중...</p>
      ) : operationsQuery.error instanceof UnauthorizedError ? (
        <UnauthorizedNotice />
      ) : operationsQuery.isError || !operationsQuery.data ? (
        <ErrorNotice>운영 현황을 불러오지 못했습니다.</ErrorNotice>
      ) : operationsQuery.data.sessions.length === 0 ? (
        <Card tone="dark">
          <p className="text-center text-body-sm text-mute">
            조회 조건에 해당하는 회차가 없습니다.
          </p>
        </Card>
      ) : (
        <Card tone="dark">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-body-sm">
              <thead>
                <tr className="text-caption-upper uppercase text-mute">
                  <th className="border-b border-hairline-on-dark px-md py-sm text-left">
                    공연명
                  </th>
                  <th className="border-b border-hairline-on-dark px-md py-sm text-left">
                    회차 시각
                  </th>
                  <th className="border-b border-hairline-on-dark px-md py-sm text-right">
                    전체
                  </th>
                  <th className="border-b border-hairline-on-dark px-md py-sm text-right">
                    예매가능
                  </th>
                  <th className="border-b border-hairline-on-dark px-md py-sm text-right">
                    홀드
                  </th>
                  <th className="border-b border-hairline-on-dark px-md py-sm text-right">
                    판매완료
                  </th>
                  <th className="border-b border-hairline-on-dark px-md py-sm text-right">
                    판매율
                  </th>
                </tr>
              </thead>
              <tbody>
                {operationsQuery.data.sessions.map((row) => (
                  <tr key={row.sessionId}>
                    <td className="border-b border-hairline-on-dark px-md py-sm">
                      {row.showTitle}
                    </td>
                    <td className="border-b border-hairline-on-dark px-md py-sm text-mute">
                      <time dateTime={row.startsAt}>
                        {formatSessionTime(row.startsAt)}
                      </time>
                    </td>
                    <td className="border-b border-hairline-on-dark px-md py-sm text-right tabular-nums">
                      {row.total.toLocaleString("ko-KR")}
                    </td>
                    <td className="border-b border-hairline-on-dark px-md py-sm text-right tabular-nums">
                      {row.available.toLocaleString("ko-KR")}
                    </td>
                    <td className="border-b border-hairline-on-dark px-md py-sm text-right tabular-nums">
                      {row.held.toLocaleString("ko-KR")}
                    </td>
                    <td className="border-b border-hairline-on-dark px-md py-sm text-right tabular-nums">
                      {row.sold.toLocaleString("ko-KR")}
                    </td>
                    <td className="border-b border-hairline-on-dark px-md py-sm text-right tabular-nums">
                      {row.salesRate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}
