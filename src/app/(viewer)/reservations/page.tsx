"use client";

import type { JSX } from "react";

import { ReservationList } from "@/components/reservation/ReservationList";
import { Toast } from "@/components/toast/Toast";
import { Band } from "@/components/ui/Band";
import { useMyReservations } from "@/hooks/use-my-reservations";

export default function ReservationsPage(): JSX.Element {
  const { data, isLoading, isError, error } = useMyReservations();

  return (
    <main className="flex flex-1 flex-col">
      <Band fill tone="light" width="tool">
        <div className="space-y-2xl">
          <header>
            <h1 className="text-display-sm">내 예매</h1>
          </header>

          {isLoading && (
            <p className="text-center text-body-sm text-body-aa">
              불러오는 중...
            </p>
          )}

          {isError && (
            <p className="text-body-sm text-primary" role="alert">
              {error?.message ?? "예매 목록을 불러오지 못했습니다."}
            </p>
          )}

          {data && <ReservationList reservations={data} />}
        </div>
      </Band>

      {/* use-cancel-reservation이 세팅하는 취소 성공·실패 메시지의 출구 */}
      <Toast />
    </main>
  );
}
