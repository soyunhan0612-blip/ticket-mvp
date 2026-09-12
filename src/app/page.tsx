import Link from "next/link";

import { ShowcaseHero } from "@/components/home/ShowcaseHero";
import { ShowCard } from "@/components/show/ShowCard";
import { Band } from "@/components/ui/Band";
import { buttonClassName } from "@/components/ui/Button";
import { isOperatorSession } from "@/lib/auth-session";
import { toHeroSlides } from "@/lib/poster-image";
import { getShowStore } from "@/services";

/*
 * 유일한 마케팅 표면. DS HeroBandDark → ContentBandLight 리듬을 그대로 쓴다.
 * 예매 도구 화면(좌석맵·예매내역·Admin)에는 이 톤을 쓰지 않는다 —
 * docs/UX_PRINCIPLES.md 원칙 1의 적용 범위 참조.
 */
export default async function Home() {
  const shows = await getShowStore().list();
  const featured = shows.slice(0, 3);
  const heroSlides = toHeroSlides(shows);
  // 로그인하면 상단 네비게이션에 운영 메뉴가 생긴다. 같은 문을 두 번 두지 않는다.
  const showOperationsBand = !(await isOperatorSession());

  return (
    <main>
      {/* 카피는 서버에서 조립해 넘긴다 — 클라이언트 번들에 들어가지 않는다. */}
      <ShowcaseHero slides={heroSlides}>
        <p className="text-eyebrow tracking-wide">공연 예매</p>
        <h1 className="max-w-4xl text-display-xl">
          보고 싶은 자리,
          <br />
          지금 고르세요.
        </h1>
        <p className="max-w-2xl text-display-lg text-mute">
          2,000석을 한 화면에서. 남이 잡은 좌석은 3초마다 그대로 반영됩니다.
        </p>
        <div className="flex flex-wrap gap-lg">
          <Link className={buttonClassName({ variant: "primary" })} href="/shows">
            공연 둘러보기
          </Link>
          <Link
            className={buttonClassName({ variant: "outline-on-dark" })}
            href="/seller/new"
          >
            공연 등록하기
          </Link>
        </div>
      </ShowcaseHero>

      <Band tone="light" width="wide">
        <div className="space-y-2xl">
          <div className="space-y-sm">
            <p className="text-caption-upper uppercase text-primary">지금 예매</p>
            <h2 className="text-display-sm">공연 목록</h2>
          </div>

          {featured.length === 0 ? (
            <p className="text-body-sm text-body-aa">
              아직 등록된 공연이 없습니다.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-lg md:grid-cols-3">
              {featured.map((show) => (
                <li key={show.id}>
                  <ShowCard
                    headingLevel={3}
                    show={show}
                    sizes="(min-width: 768px) 33vw, 100vw"
                  />
                </li>
              ))}
            </ul>
          )}

          <Link
            className={buttonClassName({ variant: "outline-dark" })}
            href="/shows"
          >
            전체 공연 보기
          </Link>
        </div>
      </Band>

      {/*
       * 아직 로그인하지 않은 방문자에게만 보이는 진입점이다. dark는 도구 표면의
       * 색이므로(UI_GUIDE 밴드 정책) 색이 먼저 "여기부터는 관람객용이 아니다"를 말한다.
       * red eyebrow를 쓰지 않는 것도 같은 규칙 — dark에서 red는 채움으로만 쓴다.
       */}
      {showOperationsBand && (
        <Band tone="dark" width="wide">
          <div className="space-y-lg">
            <div className="space-y-sm">
              <p className="text-caption-upper uppercase text-mute">
                포트폴리오
              </p>
              <h2 className="text-display-sm">운영 화면</h2>
            </div>

            <p className="max-w-2xl text-body-sm text-mute">
              실시간 좌석 점유, 회차별 판매율, AI 운영 질문, 매진 임박 알림을 한
              화면에서 봅니다. Basic 인증이 필요합니다.
            </p>

            <Link
              className={buttonClassName({ variant: "outline-on-dark" })}
              href="/admin"
            >
              운영 화면 열기
            </Link>
          </div>
        </Band>
      )}
    </main>
  );
}
