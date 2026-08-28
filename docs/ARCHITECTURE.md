# 아키텍처

## 디렉토리 구조
```
src/
├── app/
│   ├── (viewer)/shows/                # RSC
│   ├── (viewer)/sessions/[id]/seats/  # RSC 셸 + client
│   ├── (viewer)/reservations/
│   ├── seller/new/
│   ├── admin/
│   └── api/{shows,sessions,holds,reservations,ai}/
├── components/seat/                   # SeatMap, Seat, ZoomPanSvg, SelectionBar, HoldTimer
├── atoms/                             # Jotai atomFamily
├── lib/                               # 순수 로직 (TDD 강제 구간)
├── services/                          # Store 인터페이스 + 구현체
└── types/
```

## 렌더링 경계 (Day 1에 긋고 끝까지 유지)

| 화면 | 방식 | 근거 |
|---|---|---|
| 공연 목록 `/shows` | **RSC** | SEO·초기 로딩. 데이터가 정적에 가까움 |
| 공연 상세 `/shows/[id]` | **RSC** | 위와 동일. 회차 목록까지 서버 렌더 |
| 좌석 선택 `/sessions/[id]/seats` | RSC 셸 + **client 좌석맵** | 좌석 상태만 실시간. 초기 스냅샷을 서버에서 prefetch → `HydrationBoundary` |
| 예매 내역 / 셀러 / Admin | client | 인터랙션 위주 |

**주의 — 좌석 페이지는 반드시 `export const dynamic = 'force-dynamic'`**. 없으면 Next.js가 RSC 결과를 캐시해서 심사자가 옛날 좌석 스냅샷을 보게 된다. 실시간을 자랑하는 화면이 정지 화면으로 보이는 최악의 사고.

**userId 발급 지점**: RSC는 `localStorage`를 읽을 수 없으므로, 서버에서 prefetch할 때 "내가 잡은 좌석"과 "남이 잡은 좌석"을 구분하지 못한다. 최초 RSC 요청 전에도 신원이 존재하도록 **요청 진입점인 middleware/proxy에서 익명 UUID 쿠키를 발급**한다. API route에서 뒤늦게 발급하는 방식에 의존하지 않는다.

## 상태 관리

### 서버 상태 (Tanstack Query)
- 공연 목록·상세는 RSC에서 prefetch → `HydrationBoundary`로 client 하이드레이트
- 좌석 스냅샷은 client에서 `refetchInterval: 3000`으로 폴링
- 좌석 hold는 낙관적 업데이트 + 409 시 전체 롤백
- `refetchIntervalInBackground: false` (기본값 유지) — 심사자가 탭을 열어둔 채 잊어버려도 호출이 나가지 않는다

### 클라이언트 상태 (Jotai)
- `atoms/seat.ts`의 `atomFamily(seatId)`로 좌석 단위 구독 → 클릭 하나에 컴포넌트 1~2개만 리렌더
- 선택 좌석 목록은 별도 atom
- `HoldTimer` 상태도 atom

## 데이터 흐름

```
[관람객 브라우저]
   ↓ RSC (초기 로드)
Next.js 서버 → SeatStore.getSnapshot → HydrationBoundary
   ↓ 클라이언트 하이드레이트
Tanstack Query polling 3s → /api/sessions/[id]/snapshot → SeatStore.getSnapshot
   ↓ 좌석 클릭
로컬 선택 atom 갱신 (서버 요청 없음)
   ↓ '선택 완료'
POST /api/holds → SeatStore.hold (Lua atomic) → 낙관적 업데이트
   ↓ 성공 시 HoldTimer 시작 / 409 시 전체 롤백 + 토스트
POST /api/reservations → ReservationStore.create → SeatStore.confirmSeats (원자적) + Reservation 레코드 생성
```

## Store 인터페이스

route handler는 쿠키에서 `userId`를 읽어 넘긴다. 요청 바디·쿼리에서 절대 받지 않는다 (IDOR).

```ts
// ⚠️ userId는 route handler가 **쿠키에서 읽어** 넘긴다.
//    요청 바디·쿼리에서 절대 받지 않는다 (IDOR).
interface SeatStore {
  getSnapshot(sessionId, userId): Promise<SeatSnapshot>     // 폴링 대상. userId는 mine 판정용
  hold(sessionId, seatIds, userId, ttlMs): Promise<HoldResult> // 충돌 시 409 + 충돌 좌석 목록
  release(sessionId, seatIds, userId): Promise<void>        // held 해제. 소유자 불일치 시 403
  confirmSeats(sessionId, seatIds, userId): Promise<void>   // held→sold. 소유자 불일치 403. 예약 생성은 ReservationStore
  releaseSold(sessionId, seatIds, userId): Promise<void>    // sold→available. 소유자 불일치 403. cancel 경로 전용 (방어 심층화)
  revertSold(sessionId, seatIds): Promise<void>             // sold→available. 소유권 검사 없음. ReservationStore.create 실패 롤백 전용
}

interface ShowStore {   // create는 공연 + 회차 + 좌석 프리셋을 함께 생성
  list(): Promise<Show[]>                                    // mock 시드 + 셀러 등록분
  get(id): Promise<{ show: Show; sessions: Session[] } | null>
  create(input): Promise<{ show: Show; sessions: Session[] }>
}

interface ReservationStore {
  create(sessionId, seatIds, userId): Promise<Reservation>  // SeatStore.confirmSeats 호출 후 레코드 생성 (원자적)
  listByUser(userId): Promise<Reservation[]>
  cancel(reservationId, userId): Promise<Reservation>       // 소유자 불일치 403, 중복 취소 409
}
```

구현체:
- `services/*-store-memory.ts` — `globalThis` 싱글톤. Day 1~8
- `services/*-store-redis.ts` — 좌석·공연·회차·예약을 Upstash에 영속화. Day 9에 팩토리 한 줄로 교체
- 이 교체가 성공하는 것 자체가 **"API route만 갈아끼우면 프론트는 그대로"라는 주장의 증거**이므로 별도 커밋으로 남긴다

## Redis 자료구조 — 세션 Hash 하나

세션당 Hash 하나, **점유된 좌석만 필드로 존재**.

```
Key:   session:{sessionId}:seats
Field: seatId → { status: 'held'|'sold', userId, expiresAt }

스냅샷 조회 → HGETALL          1요청
좌석 잡기   → Lua 스크립트      1요청 (선택 좌석 전체 성공 또는 전체 실패)
좌석 놓기   → 소유권을 검사하는 Lua 스크립트
```

**만료는 Redis TTL이 아니라 `expiresAt` 필드로 판정**. 만료된 필드가 Hash에 남은 상태에서 `HSETNX`를 호출하면 좌석을 다시 잡을 수 없으므로 단순한 lazy expiration만 사용하지 않는다. **hold Lua 스크립트 안에서 대상 좌석의 만료 여부를 확인하고 만료 필드를 제거한 뒤, 모든 좌석이 가능한 경우에만 한꺼번에 hold한다.** 하나라도 충돌하면 아무 좌석도 변경하지 않고 충돌 좌석 목록을 반환한다. `lib/hold.ts`의 만료 판정 규칙은 인메모리 구현과 Redis 스크립트 테스트에서 동일하게 검증한다.

`confirm`과 `cancel`도 중간 상태를 남기지 않도록 원자적으로 처리:
- **create(=confirm)**: 좌석 상태 스냅샷 백업 → `SeatStore.confirmSeats`로 held→sold → Reservation 레코드 생성 → 실패 시 `SeatStore.revertSold`로 롤백. Redis는 두 자료구조를 함께 갱신하는 단일 Lua 스크립트로 대체
- **cancel**: 예약 소유권·상태 확인 → `SeatStore.releaseSold`로 sold→available (소유권 재검증) → 예약을 cancelled로 변경. Redis는 단일 Lua 스크립트로 처리
- hold/release/confirmSeats/releaseSold/revertSold/cancel/만료 정리 시 세션 `version` 증가

## 폴링 페이로드 — 점유된 좌석만 보낸다

2000석 전체 상태를 3초마다 보내면 매번 약 40KB. 대신 **비어있지 않은 좌석만** 보낸다. 대부분의 좌석은 available이므로 실제 페이로드는 수백 바이트~수 KB. Redis Hash가 점유 좌석만 필드로 갖는 구조라 자연스럽게 맞물린다.

```jsonc
{ "version": 12, "serverNow": 1760000000000, "seats": { "A5": {"s":"held","mine":true,"expiresAt":1760000120000}, "B1": {"s":"sold"} } }
```

클라이언트는 이 맵에 없는 좌석을 available로 간주한다.

**`mine`은 반드시 불리언**. 여기에 점유자 `userId`를 실으면 인증이 없는 구조에서 곧바로 좌석 탈취 경로가 된다 — 서버가 쿠키와 비교해 불리언으로 환원한 뒤 내려보낸다.

`version`은 hold/release/confirm/cancel/만료 정리 시 증가한다. 이전과 같으면 atom 갱신을 생략하고, 달라진 경우에도 좌석 상태 diff만 반영. `HoldTimer`는 클라이언트 시계만 믿지 않고 응답의 `serverNow`와 `expiresAt` 차이를 기준으로 표시하며, 다음 스냅샷에서 보정한다.

## 좌석 성능 전략 — 이 프로젝트의 정량 증거

2000석 = React 컴포넌트 2000개. 순진하게 짜면 좌석 하나 토글에 2000개가 리렌더된다. 이걸 **의도적으로 먼저 만들고 측정한 뒤** 최적화한다.

- **before (Day 3)**: 선택 좌석을 배열 하나로 들고 `SeatMap`에서 prop으로 내려주기 → 클릭당 2000 리렌더. 캡처 + 커밋으로 남긴다
- **after (Day 4)**: `atomFamily(seatId)`로 좌석 단위 구독 + `React.memo` → 클릭당 리렌더 1~2개. 3초 폴링 결과가 갱신돼도 **실제 변경된 좌석만** 리렌더된다
- 줌/팬은 **SVG `viewBox` 조작**으로만 구현한다. wheel → scale, pointermove → offset. div + CSS transform은 히트 영역 계산이 지옥이 되므로 금지
- **초기 `viewBox`는 전관이 아니라 무대 앞 중앙부에 맞춘다.** 2000석을 한 화면에 다 넣으면 좌석 하나가 몇 px이라 클릭이 불가능하다. 축소하면 전관이 보이고, "전체 보기" 버튼으로 돌아온다

**서사 정직 유지**: `atomFamily`가 개선하는 건 **업데이트 시 리렌더 수**이지 **초기 마운트 비용**이 아니다. 초기 마운트는 2000개 노드를 만드는 이상 구조적으로 남는다. README에는 "클릭당 리렌더 2000 → 1~2"로 한정해 쓰고, 초기 렌더 시간은 별도 수치로 정직하게 병기한다. 과장하면 면접에서 그 자리에서 깨진다.

## 보안 경계

인증이 없는 구조라 **쿠키의 익명 UUID가 곧 신원**. 남의 `userId`를 알면 그 사람 행세를 할 수 있다. 자세한 절대 규칙은 `CLAUDE.md`에 있고, 여기는 구현 지점만 정리.

### 서버 검증
- 좌석 규칙(`lib/seat-rules.ts`의 최대 매수 4석)을 route handler에서도 호출 — UI에서만 쓰면 `curl`로 2000석을 한 번에 잡을 수 있다. 로직을 `lib/`에 둔 이유가 정확히 이것
- `seatIds` / `sessionId`를 zod로 검증. 좌석 ID 유효성은 `lib/seat-map.ts` 재사용 — 검증 없이 Redis 키(`session:{sessionId}:seats`)에 넣으면 키 인젝션이고, 없는 좌석 ID를 대량 전송하면 무료 티어 256MB를 채우는 공격
- 포스터 이미지는 프리셋 중 선택 또는 `next.config`의 `remotePatterns` 화이트리스트. 임의 URL을 허용하면 `next/image`가 아무 외부 리소스나 프록시

### 쿠키
`httpOnly` + `sameSite: 'lax'` + `secure`(프로덕션). 클라이언트 JS가 읽을 일이 없으니 손해가 없고, XSS가 나도 세션을 못 훔친다.

### AI 엔드포인트
공개 URL이므로 최소 방어: `max_tokens` 600 상한, IP당 분당 3회 rate limit, 모델은 **Haiku 4.5**. 입력 길이 상한(공연명 100자 등), 사용자 입력은 구분자로 감싸 프롬프트 인젝션 완화. 설명은 plain text + `whitespace-pre-wrap` 렌더 (`dangerouslySetInnerHTML` 금지 — 저장형 XSS 방어).

### /admin·/seller
middleware 인증. 환경변수 계정 1개, README에 심사자용 계정 명시.

자격증명은 `POST /api/auth/login`이 대조하고 HTTP-only 쿠키(`SameSite=Lax`, 12시간)로 발급한다. 미들웨어는 그 쿠키를 `lib/basic-auth.ts`의 `verifyBasicAuthCookie`로 검증하며, **`WWW-Authenticate` 헤더는 보내지 않는다** — 그 헤더가 브라우저 네이티브 로그인 프롬프트를 띄우는 유일한 원인이라 자체 모달로 바꾸려면 없애야 했다. `Authorization: Basic` 헤더 검증은 남아 있어 심사자용 `curl -u`가 그대로 동작하고, 헤더를 광고하지 않으므로 프롬프트는 뜨지 않는다.

미인증 응답은 두 갈래다. `/api/admin` 이하는 401 JSON, 나머지 보호 경로는 `/login`으로 **리라이트**한다(리다이렉트가 아니다). 주소창이 원래 경로로 남으므로 로그인 후 `router.refresh()` 한 번이면 같은 URL에서 실제 화면이 렌더되고, 되돌아갈 경로를 쿼리로 실어 나르지 않으니 오픈 리다이렉트 경로도 생기지 않는다.

자격증명이 비어 있으면 열리는 방향이 아니라 닫히는 방향으로 실패한다 — 쿠키 경로도 `verifyBasicAuth`에 위임하므로 이 규칙이 한 곳에만 있다.

### 보안 헤더
`next.config`에 `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
