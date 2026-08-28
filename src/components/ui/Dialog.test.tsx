import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

/** ESC가 브라우저에서 만드는 이벤트. 닫힘은 cancel 한 갈래로만 흐른다. */
function pressEscape(dialog: HTMLDialogElement): Event {
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  return cancel;
}

describe("Dialog", () => {
  it("open이 false면 보이지 않는다", () => {
    // 닫힌 dialog의 내용은 접근성 트리에서 빠지므로 role 질의로는 찾히지 않는다.
    // 엘리먼트 자체의 가시성으로 확인한다.
    const { container } = render(
      <Dialog onClose={vi.fn()} open={false} title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    expect(container.querySelector("dialog")).not.toBeVisible();
    expect(screen.queryByRole("heading", { name: "예매를 취소할까요?" })).toBeNull();
  });

  it("open이 true면 보인다", () => {
    render(
      <Dialog onClose={vi.fn()} open title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    expect(screen.getByRole("heading", { name: "예매를 취소할까요?" })).toBeVisible();
  });

  it("제목을 aria-labelledby로 연결한다", () => {
    const { container } = render(
      <Dialog onClose={vi.fn()} open title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    const dialog = container.querySelector("dialog");
    const heading = screen.getByRole("heading", { name: "예매를 취소할까요?" });

    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading.id).not.toBe("");
  });

  it("ESC를 누르면 onClose를 부른다", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog onClose={onClose} open title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    /*
     * 닫힘은 항상 부모의 open이 결정한다. cancel을 preventDefault로 막고
     * onClose만 올려보내므로, 브라우저가 자체적으로 닫아 close 이벤트가
     * 되돌아오는 경로가 없다.
     */
    const cancel = pressEscape(container.querySelector("dialog")!);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("백드롭을 누르면 onClose를 부른다", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog onClose={onClose} open title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    // 백드롭 클릭은 dialog 엘리먼트 자신을 타깃으로 삼는다.
    await userEvent.click(container.querySelector("dialog")!);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("패널 안을 눌러도 닫히지 않는다", async () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} open title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    await userEvent.click(screen.getByText("본문"));

    expect(onClose).not.toHaveBeenCalled();
  });

  /*
   * 패딩이 <dialog>에 걸려 있으면 패널 안쪽 여백을 눌러도 타깃이 dialog가 되어
   * 닫힌다. 여백은 내부 래퍼가 갖는다.
   */
  it("패널 여백에는 dialog가 직접 노출되지 않는다", () => {
    const { container } = render(
      <Dialog onClose={vi.fn()} open title="예매를 취소할까요?">
        <p>본문</p>
      </Dialog>,
    );

    const dialog = container.querySelector("dialog")!;
    expect(dialog.className).not.toMatch(/(^|\s)p-/);
    expect(dialog.firstElementChild?.className).toMatch(/(^|\s)p-2xl(\s|$)/);
  });

  it("dismissible이 false면 ESC와 백드롭으로 닫히지 않는다", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog dismissible={false} onClose={onClose} open title="로그인이 필요합니다">
        <p>본문</p>
      </Dialog>,
    );

    const dialog = container.querySelector("dialog")!;
    const cancel = pressEscape(dialog);
    await userEvent.click(dialog);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  /*
   * showModal()은 마운트 후에만 부를 수 있다. 서버 HTML에 open 속성이 없으면
   * 하이드레이션 전까지 UA 기본 display:none이라 로그인 벽이 빈 화면으로 보인다.
   */
  it("서버 렌더 결과에 open 속성이 있다", () => {
    const html = renderToString(
      <Dialog onClose={vi.fn()} open title="로그인이 필요합니다">
        <p>본문</p>
      </Dialog>,
    );

    expect(html).toMatch(/<dialog[^>]*\sopen\b/);
    expect(html).toContain("로그인이 필요합니다");
  });

  it("닫힌 상태의 서버 렌더 결과에는 open 속성이 없다", () => {
    const html = renderToString(
      <Dialog onClose={vi.fn()} open={false} title="로그인이 필요합니다">
        <p>본문</p>
      </Dialog>,
    );

    expect(html).not.toMatch(/<dialog[^>]*\sopen\b/);
  });
});
