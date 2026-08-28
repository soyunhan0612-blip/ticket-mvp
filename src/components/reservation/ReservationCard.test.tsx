import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationCard } from "./ReservationCard";

const cancelMutation = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/use-cancel-reservation", () => ({
  useCancelReservation: () => cancelMutation,
}));

function renderCard() {
  return render(
    <ReservationCard
      createdAt={Date.UTC(2026, 7, 10, 10, 30)}
      id="reservation-1234"
      seatIds={["A-1-1", "A-1-2"]}
      sessionId="session-1"
      status="confirmed"
    />,
  );
}

describe("ReservationCard", () => {
  beforeEach(() => {
    cancelMutation.mutate.mockClear();
  });

  it("작은 화면에서는 내용과 액션을 세로로 쌓는다", () => {
    const { container } = renderCard();

    const card = container.firstElementChild;
    const layout = card?.firstElementChild;
    const actions = layout?.lastElementChild;

    expect(layout).toHaveClass("flex-col", "sm:flex-row");
    expect(actions).toHaveClass(
      "w-full",
      "flex-row",
      "items-center",
      "sm:w-auto",
      "sm:flex-col",
      "sm:items-end",
    );
    expect(screen.getByRole("link", { name: "좌석 보기" })).toHaveAttribute(
      "href",
      "/sessions/session-1/seats",
    );
  });

  it("취소 버튼만 눌러서는 취소되지 않고 확인 모달이 뜬다", async () => {
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "예매 취소" }));

    expect(
      screen.getByRole("heading", { name: "예매를 취소할까요?" }),
    ).toBeVisible();
    expect(cancelMutation.mutate).not.toHaveBeenCalled();
  });

  it("모달에 무엇을 취소하는지 좌석을 적는다", async () => {
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "예매 취소" }));

    expect(screen.getByText(/A-1-1, A-1-2/)).toBeVisible();
  });

  it("모달의 확정 버튼을 눌러야 취소가 실행된다", async () => {
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "예매 취소" }));
    await userEvent.click(screen.getByRole("button", { name: "취소하기" }));

    expect(cancelMutation.mutate).toHaveBeenCalledWith("reservation-1234");
  });

  it("모달을 닫으면 취소되지 않는다", async () => {
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "예매 취소" }));
    await userEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(cancelMutation.mutate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "예매를 취소할까요?" }),
    ).toBeNull();
  });
});
