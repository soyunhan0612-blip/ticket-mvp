"use client";

import { useEffect, useId, useRef, type JSX, type ReactNode } from "react";

/*
 * DS에는 모달이 없다. 네이티브 <dialog>의 showModal()을 쓰는 이유는
 * 포커스 트랩·ESC·배경 inert·top-layer를 브라우저가 처리해 주기 때문이다 —
 * 손으로 옮겨 적으면 가장 먼저 틀리는 부분들이다.
 *
 * 표면은 카드와 같은 규칙을 따른다: 6px 라디우스, 1px 헤어라인, 그림자 없음.
 * 백드롭은 globals.css의 dialog::backdrop에서 ink 72%로 칠한다
 * (docs/UI_GUIDE.md "이미지 위 텍스트"의 오버레이 값과 같은 값이다).
 *
 * 여백을 dialog가 아니라 내부 래퍼가 갖는 것은 백드롭 판정 때문이다.
 * 패딩이 dialog에 걸려 있으면 패널 안쪽 여백을 눌러도 이벤트 타깃이
 * dialog가 되어 닫힌다.
 */
const DIALOG_CLASS_NAMES =
  "m-auto w-[calc(100vw-2rem)] max-w-md rounded-card border border-hairline bg-canvas text-ink";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * false면 ESC·백드롭 클릭으로 닫히지 않는다. 닫아도 갈 곳이 없는
   * 인증 벽에만 쓴다 — 일반 확인 다이얼로그에서는 탈출구를 막지 않는다.
   */
  dismissible?: boolean;
  children: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  dismissible = true,
  children,
}: DialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  /*
   * 서버 HTML에만 open을 싣고, 마운트 이후에는 React가 이 속성을 건드리지 않게
   * 첫 렌더 값을 고정한다. 계속 제어하면 닫을 때 React가 속성을 먼저 지우는데,
   * close()는 open 속성이 없으면 즉시 반환하는 규정이라 모달이 top-layer에
   * 남는다. 열고 닫는 책임은 아래 effect가 단독으로 진다.
   */
  const serverOpenRef = useRef(open);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      /*
       * 서버가 그린 open 속성은 비모달 상태다(백드롭도 top-layer도 없다).
       * showModal()은 이미 열린 dialog에서 던지므로 한 번 닫고 승격한다.
       * 두 호출이 같은 태스크 안에서 끝나 중간 페인트는 없다.
       */
      if (dialog.open) dialog.close();
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={titleId}
      className={DIALOG_CLASS_NAMES}
      /*
       * 닫힘 신호는 cancel 한 갈래로만 흐른다. 여기서 기본 동작을 막고
       * onClose만 올려보내면 열림 여부는 항상 부모의 open이 결정한다 —
       * 브라우저가 자체적으로 닫아 close 이벤트가 되돌아오는 경로가 없어
       * 프로그램적 close()와 사용자 ESC를 구분할 필요도 사라진다.
       */
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      // 백드롭 클릭만 dialog 엘리먼트 자신을 타깃으로 삼는다 (여백은 내부 래퍼가 받는다).
      onClick={(event) => {
        if (dismissible && event.target === dialogRef.current) onClose();
      }}
      // 마운트 전에는 showModal()을 부를 수 없다. 서버 HTML에 open이 없으면
      // 하이드레이션 전까지 UA 기본 display:none이라 화면이 비어 보인다.
      open={serverOpenRef.current}
      ref={dialogRef}
    >
      <div className="space-y-lg p-2xl">
        <h2 className="text-display-xs" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
