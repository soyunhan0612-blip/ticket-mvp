import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOTAL_SEATS } from "@/lib/seat-map";

import AdminPage from "./page";

vi.mock("@/components/admin/OccupancyStats", () => ({
  OccupancyStats: () => <div data-testid="occupancy-stats" />,
}));

vi.mock("@/components/admin/AdminSeatMap", () => ({
  AdminSeatMap: (props: {
    seats: readonly unknown[];
    sections: readonly string[];
  }) => (
    <div
      data-seat-count={props.seats.length}
      data-sections={props.sections.join(",")}
      data-testid="admin-seat-map"
    />
  ),
}));

// A seeded show: MOCK_SHOWS entries carry no presetId.
const SHOW_WITHOUT_PRESET = {
  id: "show-01",
  title: "여름밤 시티 팝 콘서트",
  description: "시드 공연",
};

function mockShowEndpoints(show: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);

    if (url === "/api/shows") {
      return Promise.resolve(Response.json({ shows: [show] }));
    }

    if (url.startsWith("/api/admin/operations")) {
      return Promise.resolve(Response.json({ sessions: [] }));
    }

    if (url.startsWith("/api/admin/alerts/sellout")) {
      return Promise.resolve(
        Response.json({ threshold: 90, sessions: [], text: "" }),
      );
    }

    return Promise.resolve(
      Response.json({
        show,
        sessions: [{ id: "session-01", startsAt: "2026-12-01T10:00:00.000Z" }],
      }),
    );
  });
}

function renderAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

describe("AdminPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the dashboard for a show without a seat preset", async () => {
    mockShowEndpoints(SHOW_WITHOUT_PRESET);
    const user = userEvent.setup();
    renderAdminPage();

    await screen.findByRole("option", { name: "여름밤 시티 팝 콘서트" });
    await user.selectOptions(screen.getByLabelText("공연"), "show-01");
    await screen.findByRole("option", { name: /2026/ });
    await user.selectOptions(screen.getByLabelText("회차"), "session-01");

    expect(await screen.findByTestId("occupancy-stats")).toBeInTheDocument();

    // Falls back to the full four-section map, matching the viewer seat page
    // and the stats route's TOTAL_SEATS fallback.
    const seatMap = screen.getByTestId("admin-seat-map");
    expect(seatMap).toHaveAttribute("data-sections", "A,B,C,D");
    expect(seatMap).toHaveAttribute("data-seat-count", String(TOTAL_SEATS));
  });

  it("uses the show's preset when one is set", async () => {
    mockShowEndpoints({ ...SHOW_WITHOUT_PRESET, presetId: "small" });
    const user = userEvent.setup();
    renderAdminPage();

    await screen.findByRole("option", { name: "여름밤 시티 팝 콘서트" });
    await user.selectOptions(screen.getByLabelText("공연"), "show-01");
    await screen.findByRole("option", { name: /2026/ });
    await user.selectOptions(screen.getByLabelText("회차"), "session-01");

    const seatMap = await screen.findByTestId("admin-seat-map");
    expect(seatMap).toHaveAttribute("data-sections", "A");
    expect(seatMap).toHaveAttribute("data-seat-count", "500");
  });
});
