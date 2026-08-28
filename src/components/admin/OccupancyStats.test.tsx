import {
  QueryClient,
  QueryClientProvider,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SNAPSHOT_REFETCH_INTERVAL } from "@/hooks/use-seat-snapshot";

import { OccupancyStats } from "./OccupancyStats";

/** refetchInterval은 401 여부에 따라 값이 달라지므로 쿼리 상태를 넣어 평가한다. */
function resolveRefetchInterval(
  query: unknown,
  options: QueryObserverOptions | undefined,
): unknown {
  const interval = options?.refetchInterval;
  return typeof interval === "function"
    ? (interval as unknown as (q: unknown) => unknown)(query)
    : interval;
}

describe("OccupancyStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all four occupancy totals from the admin stats endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        total: 2_000,
        available: 1_995,
        held: 3,
        sold: 2,
        version: 4,
        serverNow: 1_000,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OccupancyStats sessionId="session-01" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("2,000")).toBeInTheDocument();
    expect(screen.getByText("1,995")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/stats?sessionId=session-01",
    );

    const query = queryClient.getQueryCache().find({
      queryKey: ["admin-stats", "session-01"],
    });
    const options = query?.options as QueryObserverOptions | undefined;
    expect(resolveRefetchInterval(query, options)).toBe(SNAPSHOT_REFETCH_INTERVAL);
  });

  /*
   * 12시간 세션이 만료되면 미들웨어가 401을 준다. 데이터 오류와 같은 문구로
   * 뭉뚱그리면 3초마다 같은 에러만 반복되고 다시 로그인할 길이 없다.
   */
  it("401이면 인증 만료로 알리고 폴링을 멈춘다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OccupancyStats sessionId="session-01" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "로그인이 만료되었습니다",
    );
    expect(
      screen.getByRole("button", { name: "다시 로그인" }),
    ).toBeInTheDocument();

    const query = queryClient.getQueryCache().find({
      queryKey: ["admin-stats", "session-01"],
    });
    const options = query?.options as QueryObserverOptions | undefined;
    expect(resolveRefetchInterval(query, options)).toBe(false);
  });

  it("일반 오류는 기존 문구를 유지하고 폴링을 계속한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "session not found" }, { status: 404 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OccupancyStats sessionId="session-01" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "점유 현황을 불러오지 못했습니다.",
    );
    expect(screen.queryByRole("button", { name: "다시 로그인" })).toBeNull();
  });
});
