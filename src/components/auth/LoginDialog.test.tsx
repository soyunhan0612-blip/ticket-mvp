import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginDialog } from "./LoginDialog";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
const nav = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
}));

function mockFetch(response: { ok: boolean; status: number }) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submit(username: string, password: string) {
  await userEvent.type(screen.getByLabelText("사용자명"), username);
  await userEvent.type(screen.getByLabelText("비밀번호"), password);
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));
}

describe("LoginDialog", () => {
  beforeEach(() => {
    router.refresh.mockClear();
    router.replace.mockClear();
    nav.pathname = "/admin";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("자격증명을 JSON으로 보내고 성공하면 현재 경로를 다시 렌더한다", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 });
    render(<LoginDialog />);

    await submit("seller", "secret");

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "seller", password: "secret" }),
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });

  it("401이면 에러를 알리고 화면을 넘기지 않는다", async () => {
    mockFetch({ ok: false, status: 401 });
    render(<LoginDialog />);

    await submit("seller", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "사용자명 또는 비밀번호가 올바르지 않습니다.",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("429면 시도 횟수 초과를 따로 알린다", async () => {
    mockFetch({ ok: false, status: 429 });
    render(<LoginDialog />);

    await submit("seller", "secret");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "시도가 너무 잦습니다",
    );
  });

  /*
   * /login은 보호 경로가 아니라 refresh해도 같은 모달이 다시 그려진다.
   * dismissible={false}라 ESC·백드롭도 막혀 있어 그대로 두면 갇힌다.
   */
  it("/login에 직접 들어와 로그인하면 보호 화면으로 보낸다", async () => {
    nav.pathname = "/login";
    mockFetch({ ok: true, status: 200 });
    render(<LoginDialog />);

    await submit("seller", "secret");

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin"));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  /*
   * 성공 직후 화면은 아직 그대로다. 버튼이 되살아나면 사용자가 다시 눌러
   * 분당 5회 제한을 happy path에서 소진한다.
   */
  it("성공 후에는 화면이 바뀔 때까지 버튼을 잠가 둔다", async () => {
    mockFetch({ ok: true, status: 200 });
    render(<LoginDialog />);

    await submit("seller", "secret");

    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "확인 중..." })).toBeDisabled();
  });

  it("실패 후에는 버튼이 다시 눌린다", async () => {
    mockFetch({ ok: false, status: 401 });
    render(<LoginDialog />);

    await submit("seller", "wrong");

    expect(await screen.findByRole("button", { name: "로그인" })).toBeEnabled();
  });

  it("비밀번호 필드를 평문으로 노출하지 않는다", () => {
    render(<LoginDialog />);

    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("type", "password");
  });

  it("닫을 수 없는 다이얼로그지만 홈으로 나갈 길은 남긴다", () => {
    render(<LoginDialog />);

    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
