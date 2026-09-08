"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { useState, type JSX, type ReactNode } from "react";

import { retryUnlessUnauthorized } from "@/lib/api-error";

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  /*
   * 재시도 정책은 여기 한 곳에만 둔다. 쿼리마다 `retry`를 박으면 그 값이
   * QueryClient 기본값을 덮어써, 테스트가 만든 클라이언트의 설정까지 무시한다.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: retryUnlessUnauthorized } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>{children}</JotaiProvider>
    </QueryClientProvider>
  );
}
