"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { useState } from "react";

import {
  ErrorNotice,
  UnauthorizedNotice,
} from "@/components/admin/admin-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  FIELD_CLASS_NAMES,
  FIELD_LABEL_CLASS_NAMES,
} from "@/components/ui/TextInput";
import { UnauthorizedError } from "@/lib/api-error";
import type { OperationsRow } from "@/lib/operations";
import { SELLOUT_RISK_THRESHOLD } from "@/lib/sellout-alert";

interface SelloutAlertPanelProps {
  /** 빈 문자열이면 전체 공연 */
  showId: string;
}

interface SelloutAlertResponse {
  threshold: number;
  sessions: OperationsRow[];
  text: string;
}

const SELLOUT_ALERT_ERROR = "매진 임박 현황을 불러오지 못했습니다.";
const DEFAULT_THRESHOLD_INPUT = String(SELLOUT_RISK_THRESHOLD);

function formatSessionTime(startsAt: string): string {
  return new Date(startsAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
  });
}

export function SelloutAlertPanel({
  showId,
}: SelloutAlertPanelProps): JSX.Element {
  const [thresholdInput, setThresholdInput] = useState(DEFAULT_THRESHOLD_INPUT);
  const [appliedThreshold, setAppliedThreshold] = useState(
    DEFAULT_THRESHOLD_INPUT,
  );

  const selloutQuery = useQuery<SelloutAlertResponse>({
    queryKey: ["admin-sellout-alerts", showId, appliedThreshold],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      /*
       * 범위 검증을 여기서 다시 하지 않는다. 입력을 그대로 보내고 서버의 400을
       * 드러내는 쪽이 "판정은 서버에서 끝난다"는 이 화면의 주장과 맞는다.
       * 비우면 파라미터를 빼 서버의 기본 임계값이 적용되게 둔다.
       */
      const trimmedThreshold = appliedThreshold.trim();
      if (trimmedThreshold !== "") {
        searchParams.set("threshold", trimmedThreshold);
      }
      if (showId !== "") searchParams.set("showId", showId);

      const query = searchParams.toString();
      const response = await fetch(
        `/api/admin/alerts/sellout${query ? `?${query}` : ""}`,
      );
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) {
        throw new Error(SELLOUT_ALERT_ERROR);
      }

      return (await response.json()) as SelloutAlertResponse;
    },
  });

  return (
    <section aria-labelledby="sellout-alert-heading" className="space-y-xl">
      <header className="space-y-xs">
        <h2 className="text-display-xs" id="sellout-alert-heading">
          매진 임박 알림
        </h2>
        <p className="text-body-sm text-mute">
          n8n이 스케줄로 받아가는 것과 같은 응답입니다. 임계값 판정과 문구
          생성은 서버에서 끝나고, n8n은 문장이 비었는지만 봅니다.
        </p>
      </header>

      <Card className="space-y-lg" tone="dark">
        <form
          className="flex flex-wrap items-end gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedThreshold(thresholdInput);
          }}
        >
          <div className="flex-1 space-y-xs">
            <label
              className={`${FIELD_LABEL_CLASS_NAMES} !text-on-dark`}
              htmlFor="sellout-threshold"
            >
              판매율 임계값 (%)
            </label>
            <input
              className={FIELD_CLASS_NAMES}
              id="sellout-threshold"
              max={100}
              min={0}
              onChange={(event) => setThresholdInput(event.target.value)}
              step={0.1}
              type="number"
              value={thresholdInput}
            />
          </div>

          <Button
            disabled={selloutQuery.isFetching}
            size="sm"
            type="submit"
            variant="outline-on-dark"
          >
            {selloutQuery.isFetching ? "조회 중..." : "알림 조회"}
          </Button>
        </form>

        {selloutQuery.isLoading ? (
          <p className="text-body-sm text-mute">조회 중...</p>
        ) : selloutQuery.error instanceof UnauthorizedError ? (
          <UnauthorizedNotice />
        ) : selloutQuery.isError || !selloutQuery.data ? (
          <ErrorNotice>{SELLOUT_ALERT_ERROR}</ErrorNotice>
        ) : (
          <div className="space-y-lg">
            {/* 기준은 입력값이 아니라 서버가 확정해 돌려준 값이다 */}
            <p className="text-body-sm text-mute">
              {`기준 ${selloutQuery.data.threshold}% 이상 · 대상 ${selloutQuery.data.sessions.length}건`}
            </p>

            {selloutQuery.data.sessions.length === 0 ? (
              <div className="space-y-xs">
                <p className="text-body-sm text-on-dark">
                  임계값 이상인 회차가 없습니다. 보낼 문장이 비어 있어 n8n은
                  Slack 호출을 건너뜁니다 — 고장이 아니라 정상 침묵입니다.
                </p>
                <p className="text-body-sm text-mute">
                  시드 공연은 좌석 총계가 2,000석으로 잡혀 판매율이 1%를 넘지
                  않습니다. 기본 임계값에서 비어 있는 것이 정상 동작입니다.
                </p>
              </div>
            ) : (
              <>
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
                          판매율
                        </th>
                        <th className="border-b border-hairline-on-dark px-md py-sm text-right">
                          잔여 좌석
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selloutQuery.data.sessions.map((row) => (
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
                            {row.salesRate.toFixed(1)}%
                          </td>
                          <td className="border-b border-hairline-on-dark px-md py-sm text-right tabular-nums">
                            {row.available.toLocaleString("ko-KR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-xs">
                  <h3 className="text-body-md">Slack으로 보낼 문장</h3>
                  {/* plain text + whitespace-pre-wrap. 제목이 셀러 입력이다 */}
                  <p className="whitespace-pre-wrap text-body-sm text-on-dark">
                    {selloutQuery.data.text}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
