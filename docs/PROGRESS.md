# Progress Journal

Day별 진행 결과와 결정 근거. 서사 문서.
기계 요약은 `phases/*/index.json`에, 커밋 히스토리는 `git log`에.

## 단계 요약

| Day | 주요 산출물 |
|---|---|
| 0 Foundation | Next.js 15·TS strict·Tailwind·TanStack Query·Jotai·Vitest 기반, 도메인 타입, 좌석 순수 로직, 공연 8개·회차 24개 시드 |
| 1 기반 + 사고 방지 | `.env*` 차단, 보안 헤더 3종, TDD/Stop 훅 범위 정리 (Day 0에 흡수) |
| 2 목록·상세 | `/shows`, `/shows/[id]` RSC, 조회 API, UI 토큰, Vercel 조기 배포 |
| 3 좌석맵 before | 2,000석 SVG와 의도적인 전역 배열/prop drilling 대조군, 자동 계측 픽스처 |
| 4 좌석 최적화 | Jotai `atomFamily` + `React.memo`로 좌석별 구독 격리 |
| 5 서버 hold | 익명 UUID 쿠키, 5분 hold, 최대 4석·좌석 ID·소유권 서버 검증, 다중 좌석 전체 성공/실패 |
| 6 폴링·롤백 | 3초 스냅샷 폴링, 낙관적 hold, 409 전체 롤백, 충돌 토스트, 서버 시각 기반 타이머 |
| 7 예매 | 예매 확정·내역·취소, 사용자별 조회와 소유권 검증, 실패 시 보상 롤백 |
| 8 셀러·AI | 3종 좌석 프리셋(500·1,000·2,000석) 공연 등록, Haiku 4.5 설명 스트리밍과 키 없는 fallback, IP 단위 요청 제한, Basic Auth |
| 9 Admin·Redis | 재사용 좌석맵 기반 Admin, SVG `viewBox` 줌/팬, Redis Store·Lua·팩토리 교체; 로컬·프로덕션 양쪽에서 Redis 연결 확인 |
| 10 릴리스 | Basic Auth fail-closed 수정, README 정리. 당시 실측값이 없어 지표 문서화 단계는 [`blocked`](../phases/10-release/index.json)로 멈췄고, 2026-09-13 실측으로 채웠다 |
| 11 성능 계측 | 렌더 카운터와 before/after 계측 테스트로 리렌더 수를 실측, 측정 절차를 [Perf Measurement](PERF_MEASUREMENT.md)에 문서화 |
| 12 AI 운영 조회 | 좌석 집계를 `src/lib/`의 순수 함수로 추출해 두 라우트가 공유, 회차 목록을 돌려주는 `GET /api/admin/operations`, 스트리밍 `POST /api/admin/ai-summary`(키 없으면 폴백), `/admin`의 운영 표와 요청형 AI 요약 |
| 13 운영 Agent | 조회 전용 Tool 2개(`list_shows`·`list_operations`)를 읽기 메서드만 노출하는 타입으로 강제, `toolRunner`(Opus 5)로 조립한 `POST /api/admin/agent`, `/admin`의 질문형 패널. 쓰기 API 미참조를 테스트로 고정 |
| 14 운영 자동화 | 판매율 임계값(기본 90%) 판정을 `src/lib/sellout-alert.ts` 순수 함수로 분리, 기존 Basic 게이트 아래의 `GET /api/admin/alerts/sellout`이 대상 회차와 알림 문구까지 만들어 응답, n8n 4노드 워크플로 export와 재현 절차를 [`ops/n8n/`](../ops/n8n/)에 커밋 |
| 15 챗봇 | 도메인 의존성이 0인 `src/chatbot/core/`와 티켓 어댑터·위젯으로 가른 이식 단위(경계를 import 테스트로 고정), 조회 전용 Tool 5개, 게이트 밖 공개 스트리밍 `POST /api/chat`과 복원용 `GET /api/chat/[conversationId]`, 대화는 24시간 TTL로 Redis에 영속화 |
| 16 상담원 연결 | 조회로 답할 수 없는 문의를 Slack으로 넘기고 서명 검증된 스레드 답장을 대화에 저장, 대기 중에만 3초 폴링해 상담원 답장과 1분 자동 안내를 표시, 재현 절차를 [`ops/slack/`](../ops/slack/)에 문서화 |
| 16+ 상담원 직접 문의 | 손님이 직접 누르는 `POST /api/chat/handoff`, 연결된 뒤의 메시지는 `POST /api/chat`이 모델 대신 Slack 스레드로 릴레이, 두 진입점이 시간당 3회 버킷을 공유 |

Day 10~16은 Day 0~9 구현 이후의 릴리스·계측·확장 작업이다. 남은 수동 검증은 [Test Scenarios](TEST_SCENARIOS.md)에 있다.

---

## Day 0 — Foundation (완료 2026-08-06)

### 기능적 관점
- 좌석 도메인 모델 확정: 4구역(A~D) × 25행 × 20열 = **2000석**, 좌석 ID `A-1-1` 형식
- 좌석 선택 규칙: 1인 최대 **4석 hold**, 중복 · 유효성 · 초과 검증
- 시드 데이터: 공연 8개 · 회차 24개 · 좌석 2000개 결정적 생성
- 도메인 타입 7종 정의, `SeatSnapshot.mine: boolean`으로 userId 노출 차단

### 기술적 관점
- Next.js 15 (App Router) + React 19 + TS strict + Tailwind
- Tanstack Query v5 + Jotai, `Providers` 클라이언트 컴포넌트로 부팅
- vitest + jsdom, TDD로 순수 로직 3종 **47 tests 통과**
- 보안 헤더 3종(X-Frame-Options / X-Content-Type-Options / Referrer-Policy)
- `.env*` gitignore, `.env.example`에 5개 키 이름만 커밋 (AI · Upstash · BasicAuth placeholder)

### 아키텍처 관점
- 순수 로직을 `src/lib/`에 분리 → Day 2+ route handler에서 서버 재검증에 그대로 재사용
- 타입을 `src/types/`에 중앙화 → CRITICAL 룰(mine 필드 등)을 타입 수준에서 강제
- `services/` (Store 인터페이스), `atoms/`, `app/api/`, middleware는 Day 1+ 예정

### 결정 근거
- **스캐폴딩 첫날 좌석 도메인부터 잡은 이유**: 좌석 규칙(4석)이 UI뿐 아니라 서버 재검증 대상. 순수 함수로 미리 확보해야 Day 2 route handler가 그대로 재사용
- ADR-005 참조: userId를 요청 바디·쿼리에서 절대 받지 않는 원칙이 타입에도 반영됨 (`SeatSnapshotEntry`에 userId 필드 없음, 오직 `mine: boolean`)
- vitest 설정을 `import.meta.dirname`으로 통일해 미래 Vite 버전 경고 사전 해소

### 참조
- PR [#1](../../pull/1) — `feat(0-foundation): Day 0 스캐폴딩 + 순수 로직 3종`
- 브랜치 리뷰 결과: CRITICAL 위반 없음, 빌드/린트/테스트 모두 통과

---

## Day 1 — Day 0에 흡수

> PRD의 Day 1 항목(types · lib · 보안 헤더 · tdd-guard 조정)은 phase 0-foundation에서 Day 0과 함께 처리되어 위 Day 0 섹션에 포함됨. 별도 서사 없음.

## Day 2 — 목록/상세 (RSC) + 조기 배포 (완료 2026-08-07)

### 기능적 관점
- `/shows` 카드 그리드 · `/shows/[id]` 상세 페이지 (회차 목록 KST 포맷, 없는 id는 `notFound`)
- `/api/shows` GET · `/api/shows/[id]` GET REST endpoint 2종
- Vercel 프로덕션 배포 완료

### 기술적 관점
- 두 페이지 모두 RSC (`"use client"` 없음), `params`는 Next.js 15 규약대로 `await`
- `services/show-store.ts` 인터페이스 + memory 구현체 + 팩토리 (Day 9 Redis 교체 대비)
- Route handler에서 store를 통해 조회 — 인터페이스 계약이 있어 memory ↔ redis 교체 시 route는 손대지 않음
- Tanstack Query · Jotai는 이번 phase에서 미사용 — 데이터가 정적이고 클라이언트 상태가 아직 없음. 좌석 phase에서 도입
- `docs/UI_GUIDE.md`에 색·간격·컴포넌트 클래스 토큰 확정 (Tailwind 기본 팔레트 유지, 임의값 금지)

### 아키텍처 관점
- Store 인터페이스 팩토리 패턴(`services/show-store.ts`) — Day 9 Redis 전환의 진입점. Route handler는 인터페이스만 참조
- UI 토큰을 UI_GUIDE에 중앙화하여 Day 3의 seat 컴포넌트가 카드·버튼 클래스를 그대로 재사용 가능
- 서버 hold·서버 재검증은 이 phase 밖 — 이 phase는 읽기 전용, 소유권 개념 없음

### 결정 근거
- **왜 서버 hold 없이 shows부터**: PRD 원칙대로 배포 리스크를 조기에 해소. RSC + 정적 데이터 페이지를 먼저 올려 Day 3부터는 좌석 시그니처에만 집중 가능
- **왜 UI 토큰을 이 단계에서 확정**: Day 3의 seat 컴포넌트(카드·버튼 스타일)가 새 값을 만들지 않고 재사용하도록 하기 위해. 뒤로 미루면 seat 구현 도중 토큰이 흔들림
- **왜 memory 구현체부터 인터페이스로 감쌌나**: Day 9의 Redis 교체가 인터페이스 계약만 지키면 되도록. Store 계약이 없으면 route handler에 Redis 지식이 새어들어 교체 비용이 폭발

### 참조
- phase 1-shows-rsc 커밋: `feat(1-shows-rsc): step 0~5` (6개 step)
- Vercel 프로덕션: https://ticket-mvp-eight.vercel.app

## Day 3 — 좌석 최적화 before (측정 완료)

### 기능적 관점
- `/sessions/[id]/seats` RSC 셸 + 클라이언트 `<SeatMap>` 하이드레이션
- 2000석(4구역 × 25행 × 20열) SVG 렌더, 클릭 토글 선택, **최대 4석 상한** 서버 재검증과 동일 규칙 재사용(`lib/seat-rules.ts`)
- `SelectionBar`에서 선택 좌석 배열 표시 + `선택 완료` alert (Day 5에 `POST /api/holds`로 대체될 자리)

### 기술적 관점
- SeatMap은 `useState<string[]>` 하나로 선택 전체 관리, 2000 Seat에 `selected`·`onClick` **prop drilling**
- `selected.includes(seat.id)`로 좌석별 상태 판정 — 좌석 1회 클릭마다 부모 리렌더 → 2000 자식 리렌더 (의도된 안티패턴)
- **최적화 없음**: `memo` / `useMemo` / `useCallback` / `atomFamily` 전부 미사용 — Day 4에서 도입할 대조군
- `export const dynamic = 'force-dynamic'` 삽입 (CLAUDE.md CRITICAL, 이번엔 스냅샷 없어도 미래 대비)

### 아키텍처 관점
- 순수 로직은 이미 `src/lib/`에 있어 재사용만 함 (`seat-rules.canSelect`, `validateSelection`, `MAX_SEATS_PER_HOLD`)
- 좌석 컴포넌트는 `src/components/seat/`에 3종(Seat/SeatMap/SelectionBar) — Day 4 리팩토링·Day 5~6 서버 상태 통합의 진입점
- 서버 hold·폴링·낙관적 업데이트는 이 phase 범위 밖 (Day 5~6)

### 결정 근거
- **왜 일부러 순진하게 만들었나**: Day 4에 `atomFamily` + `memo`로 리팩토링해 "클릭당 리렌더 2000 → 1~2"의 before/after 서사를 만들기 위한 대조군. CLAUDE.md가 이 커밋의 존재를 명시적으로 요구
- **왜 4색을 monochrome 밝기 대비로만 정했나**: UI_GUIDE AI 슬롭 안티패턴(보라·글로우·그라데이션) 회피. 도구처럼 읽히는 좌석맵이 시그니처가 되도록
- **왜 SelectionBar의 확정 버튼을 alert로 stub했나**: 서버 hold API가 아직 없음. Day 5에 이 자리를 `POST /api/holds` 낙관적 업데이트로 교체 — 이번 phase에 넣으면 서사가 두 곳으로 흩어짐

### before 측정 (자동 계측 + 브라우저 실측)

자동 계측(리렌더 수)과 브라우저 실측(시간) 모두 완료했다.

- 좌석 1회 클릭 시 React 좌석 컴포넌트 리렌더 수: **200회 (200석 기준, 폴링 제외)** — [`naive-render-count.test.tsx`](../src/components/seat/__tests__/naive-render-count.test.tsx)
- 좌석 1회 클릭 시 커밋 시간: **27.1 ms** (2,000석)
- 초기 마운트 — 좌석 컴포넌트 2,000개 렌더 합계: **43.4 ms** / 페이지 하이드레이션 커밋 전체: **96.6 ms**
- 자동 계측 근거: 커밋 `91713d0`의 Day 3 구현을 재현한 [`naive-seat-map.tsx`](../src/components/seat/__fixtures__/naive-seat-map.tsx) 픽스처. 리렌더 수가 전체 좌석 수와 같음을 검증하므로 2,000석 구조에서는 2,000회로 비례한다.
- 브라우저 실측 근거: 좌석 페이지가 처음 붙은 커밋 `cad06ec`을 별도 worktree에 받아 `next build --profile`로 빌드하고 [`measure-initial-mount.mjs`](../scripts/perf/measure-initial-mount.mjs)로 5회 측정한 중앙값. 원본 JSON은 [`assets/perf/initial-mount-before.json`](assets/perf/initial-mount-before.json), 절차는 [Perf Measurement](PERF_MEASUREMENT.md#2-실측-결과-2026-09-13).

### 참조
- 이 phase 커밋(2단계): `feat(2-seat-v0): …` / `chore(2-seat-v0): …`
- 다음: Day 4에서 `atoms/seat.ts` (atomFamily) + `React.memo(Seat)` → after 측정 캡처

## Day 4 — 좌석 최적화 after (측정 완료)

### 기능적 관점
- 좌석 클릭 시 React 리렌더 범위를 해당 좌석 1개로 한정하는 구조로 전환 (200석·폴링 제외 자동 계측 기준, 이전: 200개)
- 선택·해제·4석 상한·`SelectionBar` 표시 등 기능적 동작은 Day 3과 동일하게 유지

### 기술적 관점
- `atoms/seat.ts`: `seatStatusAtomFamily`, `selectedSeatIdsAtom`, `toggleSeatAtom`, `seatVisualStateAtomFamily` 4종으로 좌석 상태·선택·토글·시각 상태 구성
- `Seat.tsx`: `React.memo` + `useAtomValue` + `useSetAtom` 적용, props에서 상태와 `onClick` 제거
- `SeatMap.tsx`: `useState` 제거, `Seat`에는 좌석과 좌표 등 기하학 props만 전달
- `SelectionBar.tsx`: props 제거, `selectedSeatIdsAtom`을 직접 구독해 선택 목록과 가시성 관리

### 아키텍처 관점
- `seatStatusAtomFamily`를 Day 5 폴링 스냅샷 반영의 진입점으로 마련. 이번 phase에서는 기본값 `null`만 사용
- 서버 좌석 상태(`seatStatusAtomFamily`)와 클라이언트 선택(`selectedSeatIdsAtom`)을 분리해 각 상태의 변경 경로를 독립적으로 유지
- `SeatVisualState` 타입을 `types/index.ts`로 이동해 atom과 컴포넌트 사이의 순환 의존 해소

### 결정 근거
- **왜 Seat 내부에서 `toggleSeatAtom`을 직접 호출하나**: 부모가 만든 `onClick` 클로저를 prop으로 전달하면 참조가 바뀌어 `React.memo`의 좌석별 렌더 격리를 무력화하기 때문
- **왜 SelectionBar가 가시성을 내부에서 판단하나**: `SeatMap`이 선택 atom을 구독하면 클릭마다 부모와 2000개 좌석의 렌더 경로가 다시 열리기 때문
- **왜 `held-mine`을 `selected`와 동일 처리하나**: UI_GUIDE의 4색 체계를 늘리지 않으면서 사용자에게 모두 "내 좌석"이라는 동일한 시각 신호를 주기 위해서
- `atomFamily`가 개선하는 범위는 **클릭 같은 업데이트 시 리렌더**다. 2000개 SVG 노드를 생성하는 초기 마운트 비용은 구조적으로 남으므로 개선되었다고 간주하지 않고 별도 측정

### after 측정 (자동 계측 + 브라우저 실측)

- 좌석 1회 클릭 시 커밋 시간: **0.7 ms** (Day 3: **27.1 ms**) — 2,000석 기준 39배
- 초기 마운트 — 좌석 컴포넌트 2,000개 렌더 합계: **142.5 ms** (Day 3: **43.4 ms**). 개선이 아니라 **3.3배 악화**다. 좌석마다 파생 atom 하나와 `useAtomValue` 구독 두 개를 만드는 비용이 마운트 시점에 2,000번 발생한다. 업데이트 비용과 맞바꾼 결과이며 [ADR-002](ADR.md#adr-002-atomfamily로-좌석-구독-격리--beforeafter-측정)에 그대로 기록했다.
- 페이지 하이드레이션 커밋 전체: **218.1 ms** (Day 3: 96.6 ms). 현재 페이지에는 Day 3에 없던 `ZoomPanSvg`·3초 폴링·`ConfirmBar`·문의 위젯이 함께 마운트되므로 이 행은 동일 조건 비교가 아니다.
- 좌석 1회 클릭 시 React 좌석 컴포넌트 리렌더 수: **1회 (200석 기준, 폴링 제외)** (Day 3: **200회**) — [`seat-render-count.test.tsx`](../src/components/seat/__tests__/seat-render-count.test.tsx)
- 파생 atom 재계산 횟수: **200회 (200석 기준, 전체 좌석 수와 동일)** — `seatVisualStateAtomFamily`가 `selectedSeatIdsAtom` 전체를 구독하므로 선택 변경 시 모든 좌석의 read가 재실행된다. 반환값이 같은 199석은 Jotai가 React 리렌더를 건너뛴다. 2,000석 구조에서는 재계산도 2,000회로 비례한다.
- 그 2,000회 재계산이 실제로 얼마인지도 실측했다. **클릭 커밋 전체가 0.7 ms이고 재계산은 그 안에 들어 있다.** `selectAtom`으로 바꿔도 재계산 횟수는 줄지 않는 이유와, 줄이려면 무엇을 포기해야 하는지는 [ADR-002](ADR.md#adr-002-atomfamily로-좌석-구독-격리--beforeafter-측정)에 적었다.
- 자동 계측 조건: 현재 `ZoomPanSvg` 포함 구조에서 `SeatMap`을 직접 렌더해 3초 폴링을 제외했다. `npm test -- src/components/seat/__tests__`로 재현할 수 있다.
- 브라우저 실측 근거: 현재 커밋을 별도 worktree에 받아 `next build --profile`로 빌드하고 [`measure-initial-mount.mjs`](../scripts/perf/measure-initial-mount.mjs)로 5회 측정한 중앙값. 원본 JSON은 [`assets/perf/initial-mount-after.json`](assets/perf/initial-mount-after.json).

### 참조
- 이 phase 커밋: `feat(3-seat-perf): ...`
- ADR-002: "클릭당 리렌더 2000 → 1~2"로 한정. 초기 마운트 비용은 별도 수치로 정직 병기

## Day 5 — 서버 hold (인메모리)

### 기능적 관점
- `POST /api/holds`로 최대 4석을 한 번에 5분간 hold하고, `DELETE /api/holds`로 내가 잡은 좌석만 해제
- `GET /api/sessions/[id]/snapshot`에서 점유 좌석만 반환하며, 요청 쿠키 기준으로 내 좌석을 `mine: true`로 표시
- 최초 요청에 익명 UUID 쿠키를 발급해 별도 로그인 없이 브라우저 단위 좌석 소유권을 유지

### 기술적 관점
- `lib/hold.ts`: 5분 TTL 상수와 `expiresAt <= now` 경계의 만료 판정·만료 시각 생성 순수 함수
- `lib/cookie.ts`: Request의 Cookie 헤더에서 `userId`를 추출하는 서버 헬퍼
- `services/seat-store-memory.ts`: `globalThis` 싱글톤으로 세션별 점유 좌석과 `version`을 관리하고, 대상 전체를 먼저 검증한 뒤 다중 좌석을 일괄 hold
- zod로 요청 형태를 검증하고 `seat-rules.ts`·`seat-map.ts`를 route에서도 재사용해 최대 매수·중복·좌석 ID를 서버에서 재검증
- middleware가 `httpOnly`·`sameSite: "lax"`·프로덕션 `secure` 속성의 UUID 쿠키를 발급

### 아키텍처 관점
- Route handler는 쿠키에서 읽은 `userId`만 Store에 전달하며 요청 본문·쿼리에는 사용자 식별자를 두지 않음
- 스냅샷은 점유 좌석만 담고 소유자 ID 대신 `mine` 불리언으로 환원해 신원 노출과 페이로드 크기를 함께 제한
- hold 충돌 시 변경 전에 전체 좌석을 검사해 일부 좌석만 잡히는 중간 상태를 만들지 않음
- 만료 좌석 정리와 hold/release마다 세션 `version`을 증가시켜 이후 폴링 diff의 기준을 마련

### 결정 근거
- **왜 최초 요청에서 쿠키를 발급하나**: API 호출 뒤에 발급하면 RSC prefetch 시점에는 내 좌석을 판정할 신원이 없으므로 요청 진입점에서 먼저 보장해야 함
- **왜 다중 좌석을 먼저 전부 검사하나**: 한 좌석이라도 충돌할 때 전체 요청을 실패시켜야 사용자가 선택한 묶음과 서버 점유 상태가 어긋나지 않음
- **왜 스냅샷에 점유 좌석만 싣나**: 3초마다 2,000석의 available 상태를 반복 전송하지 않고, 클라이언트가 누락된 좌석을 available로 해석하도록 하기 위해

### 참조
- phase `4-server-hold` step 0~6 완료
- 핵심 회귀: TTL 경계, 만료 후 재hold, 다중 좌석 충돌 전체 실패, 타인 release 403, 스냅샷 userId 비노출

## Day 6 — 폴링 + 낙관적 업데이트 + 롤백

### 기능적 관점
- 좌석 화면이 3초마다 서버 스냅샷을 갱신해 다른 탭의 hold·판매 상태를 반영
- `선택 완료` 시 선택 좌석 전체를 즉시 내 hold처럼 표시하고, 409 충돌 또는 네트워크 실패 시 전체 상태를 이전 값으로 복원
- 충돌 좌석은 하단 토스트로 5초간 알리고, 내 hold 남은 시간은 서버 시각을 기준으로 카운트다운

### 기술적 관점
- `syncSnapshotAtom`이 같은 `version`이면 atom 갱신을 생략하고, 버전이 바뀐 경우 점유 좌석 집합의 추가·변경·제거만 반영
- `useSeatSnapshot`은 TanStack Query `refetchInterval: 3000`으로 폴링하고 Jotai 동기화 진입점을 호출
- `useHoldMutation`은 mutation 전 좌석 상태·선택 목록·만료 시각을 백업한 뒤 낙관적으로 일괄 변경하고 409·오류 시 모두 롤백
- 좌석 RSC가 초기 스냅샷을 prefetch해 `HydrationBoundary`로 전달하며 `dynamic = "force-dynamic"`을 유지
- `HoldTimer`는 `Date.now() - serverNow` 오프셋으로 클라이언트 시계를 보정해 `expiresAt`까지의 남은 시간을 계산

### 아키텍처 관점
- TanStack Query는 서버 스냅샷의 수명주기·폴링·mutation을, Jotai는 좌석별 구독과 로컬 선택·타이머를 담당
- 쿼리 데이터 전체를 2,000개 좌석 prop으로 전파하지 않고 스냅샷 diff를 `seatStatusAtomFamily`에 반영해 좌석 단위 렌더 격리를 유지
- RSC 초기 데이터와 클라이언트 폴링이 같은 query key를 사용해 첫 화면과 이후 갱신 경로를 하나로 연결

### 결정 근거
- **왜 같은 version이면 `serverNow`까지 갱신하지 않나**: 점유 상태가 그대로인 폴링마다 atom 구독자를 깨우지 않고, 상태 변경이 있을 때 받은 서버 시각으로 타이머를 다시 보정하기 위해
- **왜 409도 예외 대신 결과로 처리하나**: 예상 가능한 좌석 경합을 네트워크 장애와 구분하면서 동일한 전체 롤백 뒤 충돌 좌석 정보를 UI에 전달하기 위해
- **왜 RSC에서 먼저 prefetch하나**: 빈 좌석맵을 보여준 뒤 첫 client fetch를 기다리지 않고도 서버가 판정한 최신 점유 상태로 시작하기 위해

### 참조
- phase `5-polling-optimistic` step 0~6 완료
- 브라우저 두 탭의 실제 3~4초 반영과 동시 충돌 육안 검증은 배포 통합 시나리오에서 별도 확인 대상

## Day 7 — 예매 확정 / 내역 / 취소

### 기능적 관점
- 내가 hold한 좌석을 예매로 확정하고 `/reservations`에서 익명 쿠키 사용자 본인의 예매만 조회
- 예매 취소 시 판매 좌석을 다시 available로 반환하며 중복 취소는 409, 타인 취소는 403으로 거절
- 좌석 화면의 `ConfirmBar`, 예매 생성·목록·취소 hooks, 범용 Toast와 예매 내역 카드 UI를 연결

### 기술적 관점
- `SeatStore`에 held→sold `confirmSeats`, 소유권을 재검증하는 `releaseSold`, 예약 레코드 생성 실패 전용 `revertSold` 추가
- `ReservationStore` 메모리 구현이 좌석 확정 후 예약 레코드를 생성하고, 레코드 저장 실패 시 sold 좌석을 롤백
- `POST/GET /api/reservations`, `DELETE /api/reservations/[id]`에서 쿠키 신원만 사용하고 응답 전에 `userId`를 제거
- API가 타인 소유권 403, 중복 취소 409, 만료 hold 확정 410을 구분해 클라이언트가 실패 원인을 처리할 수 있게 함

### 아키텍처 관점
- 예약 Store가 좌석 상태 전환을 SeatStore 인터페이스에 위임해 Route와 UI에 점유 구현 세부사항이 새지 않음
- 확정·취소 모두 검증을 먼저 끝낸 뒤 좌석 묶음을 한꺼번에 바꾸고 세션 `version`을 증가
- 사용자별 조회는 Store 내부에서 쿠키 `userId`로 필터링하고 외부 응답은 소유자 식별자를 제거해 IDOR 경계를 유지

### 결정 근거
- **왜 `revertSold`를 별도 메서드로 두나**: 일반 취소의 소유권 검사와 예약 생성 실패 복구라는 내부 보상 작업의 권한을 섞지 않기 위해
- **왜 예약 생성이 SeatStore 확정을 호출하나**: 예약 레코드만 생기거나 sold 좌석만 남는 불일치를 한 작업 경계에서 보상할 수 있도록 하기 위해
- **왜 403·409·410을 나누나**: 소유권 위반, 이미 끝난 취소, 만료된 hold는 복구 방법이 서로 달라 UI가 같은 일반 오류로 취급하면 안 되기 때문

### 참조
- phase `6-reservation` step 0~4 완료
- 메모리 Store 원자성·소유권·만료·롤백 테스트와 예약 API 통합테스트 통과

## Day 8 — 셀러 등록 + AI 설명

### 기능적 관점
- `/seller/new`에서 공연 정보, 로컬 포스터, 500·1,000·2,000석 프리셋과 회차를 선택해 공연을 등록
- 생성된 공연과 회차가 메모리 ShowStore에 저장되어 기존 목록·상세·좌석 흐름에서 조회 가능
- AI 설명을 스트리밍으로 미리 보고 편집 가능한 plain text로 폼에 적용하며 API 키가 없어도 fallback 문구로 전체 흐름을 완료
- `/seller`·`/admin` 경로를 환경변수 기반 Basic Auth로 보호

### 기술적 관점
- `SEAT_PRESETS` 3종이 사용할 구역과 총 좌석 수를 정의하고 공연 생성 시 프리셋별 좌석·회차 데이터를 결정
- `ShowStore.create`가 zod 입력 검증 후 공연과 회차를 함께 생성해 기존 Store 조회 경로에 추가
- 임의 외부 URL 대신 검증된 로컬 자산만 사용 — 셀러 등록은 포스터 프리셋 SVG,
  시드 공연은 저장소에 커밋한 Unsplash 사진. `next.config.ts`에 `remotePatterns`가 없다
- `POST /api/shows`는 쿠키와 프리셋 입력을 검증하고, AI API는 IP별 분당 3회·`max_tokens` 600·공연명 100자 상한을 적용
- AI 프롬프트는 사용자 입력을 명시적 구분자로 감싸고 내부 지시를 따르지 않도록 하며, 응답은 `text/plain` 스트림과 `whitespace-pre-wrap`으로 렌더

### 아키텍처 관점
- 공연 등록은 ShowStore 인터페이스의 `create` 계약을 통해 목록·상세 Route와 동일한 데이터 원천을 사용
- Basic Auth 판정은 순수 헬퍼, 접근 제어는 middleware, AI 공급자 호출은 서버 Route로 분리해 자격 증명이 클라이언트 번들에 들어가지 않음
- 좌석 배치는 편집기가 아니라 세 프리셋 ID로 제한해 Store·좌석맵·서버 검증이 공유할 수 있는 닫힌 입력 집합을 유지

### 결정 근거
- **왜 좌석 배치를 세 프리셋으로 제한하나**: MVP 밖의 배치 에디터 복잡도를 피하면서도 공연 규모별 좌석 수와 구역 차이를 실제 흐름에서 검증하기 위해
- **왜 API 키 없는 fallback도 스트리밍하나**: 외부 자격 증명 없이 심사자가 셀러 여정을 끝까지 검증하면서 키 유무에 따른 UI 경로를 동일하게 유지하기 위해
- **왜 AI 결과를 plain text로만 다루나**: 셀러 입력이 저장되는 경로에서 HTML·마크다운 렌더를 허용하면 저장형 XSS 표면이 생기기 때문

### 참조
- phase `7-seller-ai` step 0~6 완료
- AI 모델 ID의 실제 Haiku 4.5 버전 교정은 다음 Admin phase에서 별도 회귀 테스트와 함께 반영

## Day 9 — Admin 실시간 점유 현황 (Redis 교체 전)

### 기능적 관점
- `/admin`에서 공연·회차를 선택하면 전체·예매가능·홀드중·판매완료 숫자 카드 4개와 읽기 전용 좌석맵을 표시
- 관람객 좌석맵의 3초 스냅샷 폴링과 동일한 `SeatMap`을 재사용해 점유 변경을 Admin 화면에 반영
- 좌석맵에 마우스 wheel 줌, pointer drag 팬, 무대 앞 중앙 초기 화면과 `전체 보기` 동작 추가

### 기술적 관점
- `lib/seat-layout.ts`로 프리셋 구역 수에 따른 좌석 좌표·레이아웃 박스·무대 앞 초기 viewBox 계산을 추출
- `ZoomPanSvg`가 CSS transform 없이 SVG `viewBox`만 변경하고, 4px 임계값으로 드래그 뒤 좌석 클릭을 차단
- `AI_MODEL`을 `claude-haiku-4-5-20251001`로 교정하고 상수 회귀 테스트 추가
- `GET /api/admin/stats`가 SeatStore 스냅샷에서 held·sold를 세고 프리셋 총 좌석 수로 available을 파생하며 `/api/admin`도 Basic Auth 보호 경로에 포함
- `AdminSeatMap`은 `seatMapReadOnlyAtom`으로 선택 변경을 막고 기존 `useSeatSnapshot`·`SeatMap`을 그대로 사용

### 아키텍처 관점
- 좌석 배치 계산을 순수 `lib/` 함수로 분리해 관람객·Admin이 프리셋별 동일 좌표계와 테스트된 viewBox 규칙을 공유
- Admin 집계는 별도 점유 상태를 만들지 않고 기존 SeatStore 스냅샷에서 파생해 좌석맵과 숫자의 데이터 원천을 일치
- Admin 전용 UI도 기존 polling hook과 좌석 컴포넌트를 재사용하며 차트 라이브러리나 별도 실시간 채널을 추가하지 않음
- Redis Store 교체와 배포 영속성 검증은 아직 완료되지 않았으며 phase 9의 남은 작업

### 결정 근거
- **왜 줌/팬을 `viewBox`로 구현하나**: 화면 좌표와 SVG 좌석 히트 영역을 같은 좌표계에 유지해 CSS transform에서 생기는 클릭 계산 불일치를 피하기 위해
- **왜 드래그 뒤 클릭을 별도로 차단하나**: 좌석 위에서 팬을 시작한 동작이 pointer up 뒤 좌석 선택으로 오인되지 않도록 하기 위해
- **왜 Admin 통계를 스냅샷에서 파생하나**: 별도 카운터가 좌석 상태 전환과 불일치하는 이중 기록을 피하고 동일한 만료 정리·version 규칙을 따르기 위해
- **왜 글로벌 nav에 Admin 링크를 넣지 않았나**: 일반 관람객 탐색 중 Basic Auth 프롬프트가 노출되는 흐름을 만들지 않기 위해

### 성능 측정 후속
- `ZoomPanSvg`를 포함한 현재 구조의 클릭당 수치는 자동 계측 완료: 200석·폴링 제외 기준 React `Seat` 리렌더 1회, 파생 atom 재계산 200회
- 브라우저가 필요한 초기 마운트 시간과 클릭 커밋 시간도 2026-09-13에 실측 완료: 클릭 커밋 27.1 ms → 0.7 ms, 좌석 2,000개 마운트 합계 43.4 ms → 142.5 ms ([Perf Measurement](PERF_MEASUREMENT.md#2-실측-결과-2026-09-13))

### 참조
- phase `8-admin` step 0~5 완료
- 자동 AC와 개발 서버 렌더는 통과했으며 pointer 동작 및 관람객/Admin 두 탭 반영은 배포 통합 시나리오에서 육안 확인 필요
