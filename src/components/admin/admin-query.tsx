"use client";

import type { JSX } from "react";

import { Button } from "@/components/ui/Button";

/*
 * 실패 문구는 여기 한 벌만 둔다. 두 패널이 /admin 같은 밴드에 세로로 붙어
 * 있고 레이트리밋 인스턴스가 별개라 동시에 429가 날 수 있는데, 문구가
 * 같으면 어느 쪽이 실패했는지 위치 말고는 구분할 단서가 없다.
 */
export const OPERATIONS_SUMMARY_ERROR = "운영 요약을 생성하지 못했습니다.";
export const OPS_AGENT_ERROR = "운영 질문에 답하지 못했습니다.";

/** dark 밴드에서 red는 텍스트가 아니라 채움으로 쓴다 (docs/UI_GUIDE.md). */
export function UnauthorizedNotice(): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-md rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
      role="alert"
    >
      <p>로그인이 만료되었습니다. 다시 로그인해 주세요.</p>
      {/* 리라이트 게이트가 이 URL에서 로그인 모달을 다시 띄운다 */}
      <Button
        className="!border-on-primary !text-on-primary hover:!bg-on-primary hover:!text-primary"
        onClick={() => window.location.reload()}
        size="sm"
        variant="outline-on-dark"
      >
        다시 로그인
      </Button>
    </div>
  );
}

export function ErrorNotice({ children }: { children: string }): JSX.Element {
  return (
    <p
      className="rounded-card bg-primary px-lg py-md text-body-sm text-on-primary"
      role="alert"
    >
      {children}
    </p>
  );
}
