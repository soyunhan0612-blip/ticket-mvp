# 티켓 예매 MVP

[![CI](https://github.com/soyunhan0612-blip/ticket-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/soyunhan0612-blip/ticket-mvp/actions/workflows/ci.yml)

**▶ 데모: https://ticket-mvp-eight.vercel.app** — [3분 투어](#심사자용-3분-투어) · [성능 before/after](#성능-before--after) · [알고도 제외한 것](#알고도-제외한-것) · [AI 협업 방식](#ai-협업-방식)

채용 지원용으로 만든 티켓링크형 예매 서비스 MVP입니다. 공연 탐색부터 회차·좌석 선택, 예매 확정과 취소, 셀러 공연 등록과 AI 설명 생성, Admin 점유 현황까지 핵심 여정을 구현했습니다.

시각적·기술적 중심은 2,000석 SVG 좌석 선택 화면입니다. 단순한 로컬 좌석 셀렉터가 아니라 서버가 좌석 hold와 소유권을 관리하므로, “동시에 두 명이 같은 좌석을 고르면?”이라는 상황에서 한 요청만 성공하고 다른 요청은 선택 좌석 전체가 롤백됩니다.

## 심사자용 3분 투어

배포본에서 바로 확인할 수 있는 순서입니다. 좌석 경합은 **창 2개**가 있어야 보이므로 5번을 건너뛰지 마세요.

1. **[/](https://ticket-mvp-eight.vercel.app/)** — 랜딩. 히어로 캐러셀과 추천 공연 3개(RSC). 여기서 `공연 둘러보기`로 넘어갑니다.
2. **[/shows](https://ticket-mvp-eight.vercel.app/shows)** — 공연 목록(RSC). 카드를 눌러 상세로 들어가 회차를 고릅니다.
3. **좌석 선택** — 2,000석 SVG. wheel로 줌, 드래그로 팬, `전체 보기`로 복귀합니다.
4. **4석 상한** — 5번째 좌석을 눌러 보세요. 클라이언트뿐 아니라 `POST /api/holds`에서도 거절합니다 (`src/lib/seat-rules.ts`를 route handler가 재사용).
5. **좌석 경합** — 같은 좌석 URL을 **시크릿 창**으로 하나 더 엽니다(익명 쿠키가 분리돼 다른 사용자가 됩니다). 한쪽에서 좌석을 잡으면 반대쪽은 3초 안에 회색으로 바뀌고, 같은 좌석을 동시에 잡으면 한쪽만 성공하고 나머지는 **선택 묶음 전체가** 롤백됩니다.
6. **[/reservations](https://ticket-mvp-eight.vercel.app/reservations)** — 예매 확정 후 내역과 취소. 취소하면 좌석이 다시 예매 가능으로 돌아옵니다.
7. **[/admin](https://ticket-mvp-eight.vercel.app/admin)** — 전체·예매가능·홀드중·판매완료 4개 카드와 읽기 전용 좌석맵. 위에서 잡은 좌석이 여기 반영됩니다. (로그인 필요)
8. **[/seller/new](https://ticket-mvp-eight.vercel.app/seller/new)** — 공연 등록과 AI 설명 스트리밍. (로그인 필요)

> 5번 장면의 데모 GIF는 아직 첨부하지 않았습니다. 추가 예정 경로는 `docs/assets/two-tab-seat-conflict.gif`입니다.

## 심사자용 계정

`/admin`·`/seller` 이하 경로와 `/api/admin` API는 미들웨어의 환경변수 기반 인증 뒤에 있습니다. 미인증 상태로 들어가면 **주소는 그대로 둔 채 로그인 모달**이 뜹니다.

- 사용자명: `<BASIC_AUTH_USER 값>`
- 비밀번호: `<BASIC_AUTH_PASS 값>`

`.env.example`을 복사만 하고 두 값을 채우지 않으면 `/admin`·`/seller`는 닫힙니다. 빈 값은 인증 통과가 아니라 거부로 처리됩니다 — [그렇지 않았던 시절의 결함과 수정](#ai-협업-방식)이 아래에 있습니다.

CLI로 확인할 때는 Basic 헤더가 그대로 통합니다. 브라우저에 네이티브 로그인 프롬프트를 띄우는 `WWW-Authenticate` 응답만 걷어냈고, 헤더 검증 자체는 남아 있습니다.

```bash
# 페이지는 자격증명만으로 열립니다
curl -u '<user>:<pass>' http://localhost:3000/admin

# /api/admin/stats는 익명 userId 쿠키도 함께 봅니다(좌석 스냅샷의 mine 판정에 쓰입니다).
# 브라우저는 미들웨어가 발급한 쿠키를 자동으로 싣지만 curl은 직접 넣어야 합니다.
curl -u '<user>:<pass>' -b 'userId=local-check' \
  'http://localhost:3000/api/admin/stats?sessionId=<회차 id>'
```

## 기술 스택과 아키텍처

- **Next.js 15 App Router · React 19** — 공연 목록과 상세는 RSC로 렌더링하고, 좌석 페이지는 RSC 셸에서 초기 스냅샷을 prefetch한 뒤 클라이언트 좌석맵을 하이드레이트합니다.
- **TypeScript strict · Tailwind CSS** — 도메인 계약을 타입으로 고정하고, 정해진 UI 토큰 안에서 화면을 구성합니다. 색·타입·간격·라디우스는 `globals.css`의 CSS 변수 한 곳에 모으고 Tailwind가 그것을 참조하므로, 브랜드 교체가 토큰 블록 하나로 끝납니다.
- **TanStack Query** — 좌석 스냅샷을 3초마다 폴링하고 hold 요청을 낙관적으로 반영한 뒤, 충돌 시 선택 묶음 전체를 롤백합니다.
- **Jotai** — `atomFamily(seatId)`로 2,000개 좌석의 구독을 분리하고 실제 변경된 좌석만 갱신합니다.
- **Vitest** — 순수 로직, Store 구현, API route를 테스트 우선으로 검증합니다. 45개 파일 · 404개 테스트가 CI에서 lint·build와 함께 돕니다.
- **Upstash Redis** — 공연·회차·좌석·예약을 영속화합니다. 좌석 상태는 회차별 sparse Hash에 저장하고 다중 좌석 전환은 Lua로 처리합니다.
- **Zod** — 셀러 등록·AI 요청 등 외부에서 들어오는 본문을 route handler 입구에서 파싱합니다. 타입 단언으로 넘기지 않습니다.
- **Embla Carousel** — 랜딩 히어로 슬라이드에만 씁니다. 직접 구현 대신 도입한 이유는 [ADR-006](docs/ADR.md#adr-006-랜딩-히어로-캐러셀에-embla-도입-직접-구현-대신)에 있습니다.

TanStack Query와 Jotai는 목록에 스택을 더하기 위해 선택한 것이 아닙니다. 서버 hold를 도입하면서 폴링·낙관적 업데이트·롤백과 좌석 단위 구독 격리가 실제 요구사항이 되었고, 두 도구의 역할도 그 경계에 맞춰 나눴습니다. 상세한 결정과 트레이드오프는 [ADR](docs/ADR.md)에 기록했습니다.

## 디자인 시스템

화면은 **Vodafone Design System**(브랜드 가이드라인 기반의 마케팅 사이트용 시스템)을 이식해 구성했습니다. 두 시스템의 전제가 반대여서 — DS는 라이트 캔버스의 마케팅 언어, 이 프로젝트는 "도구처럼 보인다"는 원칙의 다크 UI — 그대로 덮어씌우지 않고 **DS의 밴드 리듬(dark ↔ light)을 충돌의 해법으로 썼습니다.**

- 진입 화면(`/`, `/shows`)은 light 밴드에 마케팅 언어를, 예매 도구 화면(좌석맵 · Admin)은 dark 밴드에 둡니다. 톤이 바뀌는 지점이 화면에서 눈에 보입니다.
- 좌석 4색은 **하나도 바뀌지 않았습니다.** 좌석 캔버스만 밴드보다 한 단계 어두운 표면(`--color-ink-deep`)에 두어 원래 명도 대비를 보존했습니다.
- DS 값을 두 군데 의도적으로 벗어났습니다: 본문 색(DS 값이 4.06:1로 WCAG AA 미달 → 5.33:1로 교체)과 방금의 좌석 캔버스 토큰. 두 편차 모두 [UI Guide](docs/UI_GUIDE.md)에 사유와 함께 기록했습니다.
- Vodafone 로고·워드마크·서비스명은 쓰지 않습니다. 서체 Inter는 DS 자체가 독점 서체의 대체로 지정한 것이며 `next/font`로 self-host합니다.

## 진행 상황

| Day | 상태 | 주요 산출물 |
|---|---|---|
| 0 Foundation | 완료 | Next.js 15·TS strict·Tailwind·TanStack Query·Jotai·Vitest 기반, 도메인 타입, 좌석 순수 로직, 공연 8개·회차 24개 시드 |
| 1 기반 + 사고 방지 | 완료 (Day 0에 흡수) | `.env*` 차단, 보안 헤더 3종, TDD/Stop 훅 범위 정리 |
| 2 목록·상세 | 완료 | `/shows`, `/shows/[id]` RSC, 조회 API, UI 토큰, Vercel 조기 배포 |
| 3 좌석맵 before | 리렌더 측정 완료·초기 마운트 대기 | 2,000석 SVG와 의도적인 전역 배열/prop drilling 대조군, 자동 계측 픽스처 |
| 4 좌석 최적화 | 리렌더 측정 완료·초기 마운트 대기 | Jotai `atomFamily` + `React.memo`로 좌석별 구독 격리; 초기 마운트 Profiler 실측만 미완료 |
| 5 서버 hold | 완료 | 익명 UUID 쿠키, 5분 hold, 최대 4석·좌석 ID·소유권 서버 검증, 다중 좌석 전체 성공/실패 |
| 6 폴링·롤백 | 완료 | 3초 스냅샷 폴링, 낙관적 hold, 409 전체 롤백, 충돌 토스트, 서버 시각 기반 타이머 |
| 7 예매 | 완료 | 예매 확정·내역·취소, 사용자별 조회와 소유권 검증, 실패 시 보상 롤백 |
| 8 셀러·AI | 완료 | 3종 좌석 프리셋(500·1,000·2,000석) 공연 등록, Haiku 4.5 설명 스트리밍과 키 없는 fallback, IP 단위 요청 제한, Basic Auth |
| 9 Admin·Redis | 완료 | 재사용 좌석맵 기반 Admin, SVG `viewBox` 줌/팬, Redis Store·Lua·팩토리 교체; 로컬·프로덕션 양쪽에서 Redis 연결 확인 |
| 10 릴리스 | 일부 blocked | Basic Auth fail-closed 수정, README 정리. 실측값이 없어 지표 문서화 단계는 [`blocked`](phases/10-release/index.json)로 멈춤 |
| 11 성능 계측 | 완료 (초기 마운트 제외) | 렌더 카운터와 before/after 계측 테스트로 리렌더 수를 실측, 수동 측정 절차를 [Perf Measurement](docs/PERF_MEASUREMENT.md)에 문서화 |

세부 진행 기록과 아직 남은 수동 검증은 [Progress Journal](docs/PROGRESS.md)과 [`phases/`](phases/)에 있습니다. Day 10·11은 Day 0~9 구현 이후의 릴리스·계측 작업입니다.

## 성능 before / after

클릭 업데이트는 테스트에서 자동 계측한 값을 기록하고, 실제 레이아웃·페인트 비용이 필요한 초기 마운트 시간은 브라우저에서 측정하기 전까지 비워 둡니다. 추정값은 기록하지 않습니다.

| 측정 | Day 3 (before) | Day 4 (after) |
|---|---|---|
| 좌석 1회 클릭 시 React 좌석 컴포넌트 리렌더 수 (200석, 폴링 제외) | 200회 | 1회 |
| 파생 atom 재계산 수 (200석, 폴링 제외) | 해당 없음 (파생 atom 미사용) | 200회 |
| 초기 마운트 시간 | [TBD — 수동 측정 대기](docs/PERF_MEASUREMENT.md#3-day-3before-초기-마운트-시간) | [TBD — 수동 측정 대기](docs/PERF_MEASUREMENT.md#2-현재-구현의-초기-마운트-시간) |

자동 계측은 jsdom 부하를 줄이기 위해 200석으로 실행하며 3초 폴링은 제외합니다. 대조군의 React 리렌더와 현재 구현의 파생 atom 재계산은 각각 전체 좌석 수와 같으므로, 프로덕션 2,000석 구조에서는 2,000회로 비례합니다. 현재 구현의 React 리렌더는 클릭한 `Seat` 1회로 유지됩니다. `pnpm test src/components/seat/__tests__`로 재현할 수 있으며, 근거는 [before 계측 테스트](src/components/seat/__tests__/naive-render-count.test.tsx)와 [현재 구현 계측 테스트](src/components/seat/__tests__/seat-render-count.test.tsx)입니다.

`atomFamily` + `React.memo`가 없애는 것은 **React 컴포넌트 리렌더**이지 **파생 atom 재계산**이 아닙니다. `seatVisualStateAtomFamily`가 전역 `selectedSeatIdsAtom`을 구독하므로 클릭 때 모든 좌석의 파생 atom read가 다시 실행되지만, 반환값이 같은 좌석은 Jotai가 React 리렌더를 건너뜁니다.

`atomFamily` + `React.memo`가 개선하는 것은 **업데이트 시 리렌더 수**이지 **초기 마운트 비용**이 아닙니다. 2,000개 SVG 노드 생성 비용은 구조적으로 남습니다. 이 조건은 [ADR-002](docs/ADR.md#adr-002-atomfamily로-좌석-구독-격리--beforeafter-측정)에 명시했으며, 초기 마운트까지 개선된 것처럼 과장하지 않습니다.

## 알고도 제외한 것

- **좌석 키보드 내비게이션 / 스크린리더** — 2,000석 SVG에 공간 이동 규칙과 정확한 라벨링을 적용하려면 별도 접근성 설계가 필요합니다. 불완전한 지원을 추가하는 대신 MVP에서 명시적으로 제외했습니다.
- **E2E (Playwright)** — 10일 범위에서는 순수 로직·Store·API route 테스트와 배포본 수동 시나리오에 우선순위를 뒀습니다.
- **모바일 터치 제스처 정밀 튜닝** — 줌/팬은 데스크톱의 wheel·pointer와 SVG `viewBox` 기준으로 구현했습니다. 모바일 pinch·관성·경계 처리는 별도 튜닝이 필요합니다.
- **실사용자 인증·결제** — 좌석 경합과 예매 상태 전환 검증에 집중하기 위해 관람객은 HTTP-only 익명 UUID 쿠키, `/admin`·`/seller`는 환경변수 계정 1개를 씁니다. 로그인 폼이 자격증명을 대조해 HTTP-only 쿠키로 발급할 뿐 사용자 테이블도 비밀번호 해싱도 없습니다 — 심사자 한 명을 위한 문지기이지 계정 시스템이 아닙니다.
- **CSRF 토큰** — MVP에서는 `sameSite: 'lax'` 쿠키로 대체했습니다. 실서비스라면 별도 CSRF 토큰이 필요합니다.
- **좌석 배치 에디터** — 드래그 기반 에디터는 일정 대부분을 소비하므로 500·1,000·2,000석 프리셋 3개로 제한했습니다.

같은 기준으로 Admin 차트 라이브러리는 넣지 않고 기존 좌석맵과 숫자 카드 4개를 재사용했습니다. SSE/WebSocket도 Vercel 함수 수명과 연결 유지 범위를 키우는 대신 3초 폴링을 선택했습니다. 완전한 실시간성이 필요한 서비스라면 WebSocket 계열을 다시 검토해야 합니다.

## AI 협업 방식

이 저장소는 AI 코딩 에이전트와 함께 작업한 흔적을 지우지 않고 그대로 커밋했습니다. 규칙 파일과 훅 스크립트가 저장소 안에 있습니다.

| 파일 | 역할 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) · [`AGENTS.md`](AGENTS.md) | 아키텍처 CRITICAL 규칙(쿠키 전용 `userId`, 응답에 타인 `userId` 금지, 서버 재검증, `NEXT_PUBLIC_` 금지, plain text 렌더). 에이전트가 매 작업에서 읽습니다 |
| [`.claude/settings.json`](.claude/settings.json) · [`.codex/hooks.json`](.codex/hooks.json) | 두 에이전트가 `scripts/hooks/`의 같은 Node 스크립트를 공유합니다 |
| [`scripts/hooks/`](scripts/hooks/) | 위험 명령 차단 · TDD 가드(`lib/`·`services/`·`route.ts`는 테스트 선행 없이 편집 차단) · Stop 검증 게이트(`lint`·`test`) |
| [`phases/`](phases/) | 단계별 명세와 실행 결과. `status`가 `completed`/`blocked`로 기록됩니다 |

규칙을 문서로 적어두는 것과 그 규칙이 실제로 뭔가를 막는 것은 다릅니다. 실제로 막힌 사례 두 가지:

**1. 빈 문자열 자격증명으로 Basic Auth가 뚫리던 결함**

`verifyBasicAuth`가 기대 자격증명의 `undefined`만 검사하고 있었습니다. 그런데 환경변수에 `BASIC_AUTH_USER=`처럼 이름만 있으면 값은 `undefined`가 아니라 `""`로 로드됩니다. 그러면 가드를 통과하고 `"" === "" && "" === ""`이 `true`가 되어, **브라우저 인증 프롬프트에 아무것도 입력하지 않아도 `/admin`·`/seller`가 전부 열립니다.** 기존 테스트는 `undefined` 케이스만 덮고 있어 이 경로를 잡지 못했습니다.

리뷰에서 발견해 재현 근거를 [`phases/10-release/step0.md`](phases/10-release/step0.md)에 남기고, 테스트를 먼저 추가한 뒤 fail-closed로 고쳤습니다(`c4712ec`). **설정되지 않은 자격증명은 열리는 방향이 아니라 닫히는 방향으로 실패해야 한다**가 그 커밋의 유일한 목적입니다.

**2. 성능 수치를 지어내는 대신 멈춘 것**

이 프로젝트의 정량 증거는 좌석 리렌더 수 하나뿐입니다. 그래서 명세의 금지사항에 "측정값을 추정하거나 그럴듯한 숫자로 채우지 마라. 값이 없으면 `blocked`가 정답이다"를 박아 두었습니다. 실제로 실측값이 없자 해당 단계는 문서를 고치지 않고 [`blocked`로 멈췄습니다](phases/10-release/index.json) — `blocked_reason`에 어떤 값이 없는지 그대로 남아 있습니다.

이후 그 자리는 추정이 아니라 **렌더 수를 직접 세는 테스트**로 채웠습니다([`naive-render-count.test.tsx`](src/components/seat/__tests__/naive-render-count.test.tsx), [`seat-render-count.test.tsx`](src/components/seat/__tests__/seat-render-count.test.tsx)). 위 성능 표의 200회/1회는 이 테스트가 실행 중 수집한 값입니다. 브라우저 Profiler가 필요한 초기 마운트 시간은 여전히 측정 대기 상태로 **비워 두었습니다.**

## 로컬 실행

### 요구사항

- Node.js 22 이상 (jsdom/undici 의존성이 `webidl.util.markAsUncloneable` 요구)
- pnpm 10 (`package.json`의 `packageManager` 필드에 버전이 고정돼 있습니다)

### 설치 & 실행

```bash
corepack enable pnpm         # 또는 npm i -g pnpm
pnpm install --frozen-lockfile
cp .env.example .env.local   # 값은 비워 둬도 됩니다 (아래 참조)
pnpm dev                     # http://localhost:3000
```

**환경변수 없이도 관람객 여정 전체가 동작합니다.** Upstash 토큰이 없으면 인메모리 Store로, `ANTHROPIC_API_KEY`가 없으면 AI 설명이 고정 문구 fallback으로 대체됩니다. 다만 `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`는 **비어 있으면 열리지 않고 닫힙니다** — `/admin`·`/seller`를 로컬에서 보려면 두 값을 채워야 합니다.

`.env.local`은 커밋되지 않습니다 (`.gitignore` 참조). 필요한 변수와 설명은 `.env.example`에서 확인할 수 있습니다.

### 스크립트

| 명령 | 용도 |
|---|---|
| `pnpm dev` | 개발 서버 |
| `pnpm build` | 프로덕션 빌드 (배포 직전 수동) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest 전체 테스트 (45개 파일 · 404개 테스트) |
| `pnpm test:watch` | Vitest 워치 모드 |

## 데이터 영속성

Day 9에 인메모리 저장소를 **Upstash Redis**로 교체했습니다. 좌석·공연·회차·예약이 모두 Redis에 저장되므로 **재배포하거나 서버가 재시작돼도 예매 내역과 셀러가 등록한 공연이 그대로 남습니다.** 인메모리였다면 배포마다 전부 사라집니다.

- `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`이 **둘 다** 설정되면 Redis로, 아니면 인메모리로 동작합니다 (`src/services/index.ts`의 팩토리 한 지점에서 분기).
- 두 토큰은 서버에서만 읽습니다. `NEXT_PUBLIC_` 접두사를 붙이지 않으므로 브라우저 번들에 포함되지 않습니다.
- 좌석 상태 전환(hold/확정/취소)은 Lua 스크립트로 원자 처리해 여러 좌석이 부분만 잡히는 경우가 없습니다.

### 시드 공연 데이터를 바꿨을 때

`src/lib/mock-data.ts`의 `MOCK_SHOWS`를 수정해도 **이미 시드된 Redis에는 반영되지 않습니다.** `show-store-redis.ts`의 `seed()`가 `show-01`의 존재를 마커로 보고 건너뛰기 때문입니다 — 콜드 스타트마다 같은 해시를 다시 쓰지 않으려는 의도적 설계입니다.

반영하려면 Upstash 콘솔에서 `shows` 키를 삭제한 뒤 아무 페이지나 요청하면 됩니다. 셀러가 등록한 공연도 같은 해시에 있으므로 함께 사라집니다.

`.env.local`에 Upstash 토큰이 없으면 로컬은 인메모리로 동작해 수정이 즉시 반영됩니다. 두 경로의 동작이 다르므로, 시드를 바꾼 뒤에는 **실제로 어느 저장소에 붙어 있는지 확인하고 검증**하세요. `curl localhost:3000/api/shows`로 응답을 보면 바로 알 수 있습니다.

## 배포

- 프로덕션: https://ticket-mvp-eight.vercel.app
- Redis 환경변수를 적용해 배포 완료. 프로덕션에서 좌석 hold를 실행하면 Upstash에 `session:<id>:seats`와 `session:<id>:version` 키가 생성되는 것으로 Redis 연결을 확인했습니다.
- 로그인 게이트(`/admin`·`/seller/new`), AI 설명 생성도 프로덕션에서 동작을 확인했습니다.

## 문서

- [PRD](docs/PRD.md) — 요구사항·범위·검증 시나리오
- [Architecture](docs/ARCHITECTURE.md) — 렌더링 경계·데이터 흐름·Store 인터페이스
- [ADR](docs/ADR.md) — 기술 선택과 트레이드오프
- [Progress Journal](docs/PROGRESS.md) — Day별 실제 산출물과 남은 검증
- [Perf Measurement](docs/PERF_MEASUREMENT.md) — 자동/수동 측정 절차와 재현 방법
- [UX Principles](docs/UX_PRINCIPLES.md) / [UI Guide](docs/UI_GUIDE.md) — UX 원칙과 UI 규칙
- [CLAUDE.md](CLAUDE.md) — 개발 규칙과 CRITICAL 경계
