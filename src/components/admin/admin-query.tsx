"use client";

import type { JSX } from "react";

import { Button } from "@/components/ui/Button";

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
