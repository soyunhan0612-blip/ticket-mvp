import Link from "next/link";
import type { JSX } from "react";

const NAV_LINK_CLASS_NAMES =
  "whitespace-nowrap rounded-sm text-body-sm text-mute transition-colors duration-150 hover:text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-dark focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

const NAV_ITEMS = [
  { href: "/shows", label: "공연" },
  { href: "/seller/new", label: "공연 등록" },
  { href: "/reservations", label: "내 예매" },
] as const;

/*
 * 운영 화면은 관람객 여정이 아니라 도구라 기본 메뉴에 두지 않는다. 로그인한
 * 운영자에게만 붙이는 이유는 발견성 때문이지 접근 제어가 아니다 — 차단은
 * 미들웨어가 하고, 이 항목이 없다고 /admin이 막히지는 않는다.
 */
const OPERATIONS_NAV_ITEM = { href: "/admin", label: "운영" } as const;

interface NavBarProps {
  /** 운영자 인증 쿠키가 확인된 경우에만 true. 판정은 서버가 한다. */
  showOperations?: boolean;
}

export function NavBar({ showOperations = false }: NavBarProps): JSX.Element {
  const navItems = showOperations
    ? [...NAV_ITEMS, OPERATIONS_NAV_ITEM]
    : NAV_ITEMS;

  return (
    <nav aria-label="주요 메뉴" className="bg-ink text-on-dark">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-lg px-lg py-lg sm:flex-row sm:items-center sm:justify-between sm:gap-2xl sm:px-2xl lg:px-3xl">
        <Link
          className="whitespace-nowrap rounded-sm text-body-md font-extrabold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-dark focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          href="/"
        >
          티켓 MVP
        </Link>

        <ul className="flex w-full items-center justify-between gap-lg sm:w-auto sm:justify-start sm:gap-2xl">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link className={NAV_LINK_CLASS_NAMES} href={item.href}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
