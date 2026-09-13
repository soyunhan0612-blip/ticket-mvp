import type { JSX } from "react";

/*
 * DS는 아이콘 세트를 주지 않는다(docs/UI_GUIDE.md). 인라인 SVG를 쓰되 둥근
 * 배경으로 감싸지 않고, 라벨을 대신하는 자리에서는 호출자가 sr-only 텍스트를
 * 남긴다. 모양은 전부 24 그리드에 stroke 1.5로 맞춘다.
 */
function Icon({
  children,
  className = "h-5 w-5",
}: {
  children: JSX.Element | JSX.Element[];
  className?: string;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

/** 런처와 문의 도우미 턴. */
export function ChatBubbleIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M20 4.75H4a1.25 1.25 0 0 0-1.25 1.25v9.5A1.25 1.25 0 0 0 4 16.75h3.25v3.5l4.2-3.5H20a1.25 1.25 0 0 0 1.25-1.25V6A1.25 1.25 0 0 0 20 4.75Z" />
    </Icon>
  );
}

/** 상담원 턴과 상담원 연결 버튼. */
export function HeadsetIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4.75 14.25V12a7.25 7.25 0 0 1 14.5 0v2.25" />
      <path d="M2.75 15.25a1.5 1.5 0 0 1 1.5-1.5h.75v4.5h-.75a1.5 1.5 0 0 1-1.5-1.5v-1.5Z" />
      <path d="M21.25 15.25a1.5 1.5 0 0 0-1.5-1.5H19v4.5h.75a1.5 1.5 0 0 0 1.5-1.5v-1.5Z" />
      <path d="M19 18.25v.5a2.5 2.5 0 0 1-2.5 2.5H13" />
    </Icon>
  );
}

/** 안내 턴과 상담 상태 배너. */
export function InfoIcon(): JSX.Element {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 11.5v4.75" />
      <path d="M12 7.75h.01" />
    </Icon>
  );
}

/** 패널 닫기. 좁은 컨트롤이라 아이콘만 두고 sr-only 라벨을 붙인다. */
export function CloseIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M6.75 6.75 17.25 17.25" />
      <path d="M17.25 6.75 6.75 17.25" />
    </Icon>
  );
}
