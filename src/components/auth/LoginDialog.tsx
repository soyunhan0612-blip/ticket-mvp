"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent, type JSX } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";

const LOGIN_PATH = "/login";
/** /login으로 직접 들어온 사용자를 로그인 후 데려다 놓을 곳. */
const FALLBACK_DESTINATION = "/admin";

const INVALID_MESSAGE = "사용자명 또는 비밀번호가 올바르지 않습니다.";
const RATE_LIMITED_MESSAGE = "시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
const FAILED_MESSAGE = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";

function messageForStatus(status: number): string {
  if (status === 401) return INVALID_MESSAGE;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  return FAILED_MESSAGE;
}

/*
 * 미들웨어가 보호 경로를 이 화면으로 리라이트한다. 주소창은 원래 경로 그대로이므로
 * 로그인 성공 뒤에는 refresh만으로 같은 URL에서 실제 화면이 렌더된다.
 */
export function LoginDialog(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        setSubmitting(false);
        return;
      }

      /*
       * 성공 경로에서는 submitting을 되돌리지 않는다. 화면은 아직 이 모달이고
       * 버튼이 되살아나면 사용자가 다시 눌러 분당 5회 제한을 happy path에서
       * 소진한다. 잠금은 아래 이동이 화면을 갈아끼우면서 사라진다.
       */
      if (pathname === LOGIN_PATH) {
        // 리라이트로 온 게 아니라 /login을 직접 연 경우다. 여기서 refresh하면
        // 보호되지 않은 같은 페이지가 다시 그려져 모달에 갇힌다.
        router.replace(FALLBACK_DESTINATION);
        return;
      }

      router.refresh();
    } catch {
      setError(FAILED_MESSAGE);
      setSubmitting(false);
    }
  };

  return (
    // 닫아도 갈 곳이 없는 인증 벽이라 ESC·백드롭으로 닫지 않는다. 대신 홈 링크를 둔다.
    <Dialog
      dismissible={false}
      onClose={() => undefined}
      open
      title="로그인이 필요합니다"
    >
      <p className="text-body-sm text-body-aa">
        셀러·운영 화면입니다. 심사자용 계정은 README에 있습니다.
      </p>

      <form className="space-y-lg" onSubmit={handleSubmit}>
        <TextInput
          autoComplete="username"
          id="login-username"
          label="사용자명"
          name="username"
          required
        />
        <TextInput
          autoComplete="current-password"
          id="login-password"
          label="비밀번호"
          name="password"
          required
          type="password"
        />

        {/* light 표면이라 red 텍스트로 충분하다 — AA 미달은 ink 위에서만 생긴다 */}
        {error && (
          <p className="text-body-sm text-primary" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-md">
          <Link
            className="rounded-sm text-body-sm text-body-aa transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            href="/"
          >
            홈으로
          </Link>
          <Button disabled={submitting} size="sm" type="submit">
            {submitting ? "확인 중..." : "로그인"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
