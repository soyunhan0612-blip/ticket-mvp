import type { Metadata } from "next";
import type { JSX } from "react";

import { LoginDialog } from "@/components/auth/LoginDialog";
import { Band } from "@/components/ui/Band";

/*
 * 직접 방문하는 화면이 아니다 — 미들웨어가 /admin·/seller 이하를 여기로 리라이트하고,
 * 그때 주소창은 원래 경로로 남는다. 색인될 이유가 없으므로 noindex를 건다.
 */
export const metadata: Metadata = {
  title: "로그인",
  robots: { index: false, follow: false },
};

export default function LoginPage(): JSX.Element {
  return (
    <main className="flex flex-1 flex-col">
      {/* /admin·/seller와 같은 도구 표면이므로 인증 벽도 dark 밴드다 (UI_GUIDE 밴드 정책) */}
      <Band fill tone="dark" width="tool">
        <div className="space-y-sm">
          <h1 className="text-display-sm">셀러 · 운영</h1>
          <p className="text-body-sm text-mute">
            이 화면은 로그인한 사용자에게만 열립니다.
          </p>
        </div>
      </Band>

      <LoginDialog />
    </main>
  );
}
