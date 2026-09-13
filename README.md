# 티켓 예매 MVP

[![CI](https://github.com/soyunhan0612-blip/ticket-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/soyunhan0612-blip/ticket-mvp/actions/workflows/ci.yml)

**▶ 라이브 데모: https://ticket-mvp-eight.vercel.app** · [3분 투어](docs/REVIEWER_TOUR.md) · [데모 GIF 6개](docs/DEMO.md) · [성능 실측](docs/PERF_MEASUREMENT.md#2-실측-결과-2026-09-13)

![사용자 A와 B가 같은 회차의 겹치는 좌석을 고르는 장면](docs/assets/two-tab-seat-conflict.gif)

<sub>쿠키가 분리된 두 브라우저가 같은 좌석을 노리는 장면. 먼저 잡은 A만 성공하고, 늦게 요청한 B는 409와 함께 선택 묶음 전체가 롤백됩니다.</sub>

- **2,000석 좌석을 서버가 관리합니다.** 5분 hold·최대 4석·좌석 ID·소유권을 route handler에서 재검증하고, 여러 좌석 전환은 Redis Lua로 전부 성공하거나 전부 실패합니다.
- **클릭 반응을 27.1 ms → 0.7 ms로 줄였고, 그 대가로 늘어난 마운트 비용도 같이 쟀습니다.** 추정값 없이 before/after 두 빌드를 실측했습니다.
- **AI 에이전트와 만든 과정을 지우지 않았습니다.** 규칙 파일·훅·단계별 명세가 저장소에 그대로 있습니다 — [AI 협업 방식](docs/AI_COLLABORATION.md).

## 성능 before / after

2,000석 좌석 페이지를 Day 3 순진한 구현(`cad06ec`)과 현재 구현으로 각각 `next build --profile` 빌드해 5회 측정한 중앙값입니다.

| 측정 | Day 3 (before) | 현재 (after) |
|---|---|---|
| 좌석 1회 클릭 시 커밋 시간 | 27.1 ms | **0.7 ms** |
| 클릭 시 리렌더되는 좌석 컴포넌트 (200석 자동 계측) | 200개 | **1개** |
| 초기 마운트 — 좌석 컴포넌트 2,000개 렌더 합계 | 43.4 ms | **142.5 ms** (3.3배 악화) |

`atomFamily` + `React.memo`로 좌석마다 구독을 나눠 클릭 비용을 없앴지만, 좌석마다 파생 atom과 구독을 만드는 비용 때문에 **초기 마운트는 오히려 느려졌습니다.** 한 번 열고 여러 번 클릭하는 화면이라 이 교환을 택했습니다. 클릭마다 2,000개 파생 atom이 다시 계산되는 점과 `selectAtom`으로 줄이지 않은 이유는 [ADR-002](docs/ADR.md#adr-002-atomfamily로-좌석-구독-격리--beforeafter-측정)에, 측정 조건·원본 데이터·재현 스크립트는 [Perf Measurement](docs/PERF_MEASUREMENT.md)에 있습니다.

## 기술 스택

| 영역 | 선택 | 이 프로젝트에서 맡은 일 |
|---|---|---|
| 프레임워크 | Next.js 15 App Router · React 19 · TypeScript strict | 목록·상세는 RSC, 좌석 페이지는 RSC 셸이 스냅샷을 prefetch한 뒤 클라이언트 좌석맵을 하이드레이트 |
| 서버 상태 | TanStack Query | 3초 스냅샷 폴링, 낙관적 hold, 409 시 선택 묶음 전체 롤백 |
| 클라이언트 상태 | Jotai `atomFamily` | 2,000개 좌석의 구독 격리 |
| 저장소 | Upstash Redis · Lua | 회차별 sparse Hash, 다중 좌석 원자 전환. 토큰이 없으면 인메모리 Store로 교체 |
| 검증 | Vitest · Zod | 93개 파일 · 847개 테스트를 CI에서 lint·build와 함께 실행, 외부 입력은 route 입구에서 파싱 |
| AI | Claude API | 셀러 공연 설명 스트리밍, Admin 운영 요약·조회 전용 Agent, 문의 챗봇 (키가 없으면 고정 문구로 폴백) |

화면은 Vodafone Design System을 이식하되, 좌석맵·Admin 같은 도구 화면은 dark 밴드에 두어 "도구처럼 보인다"는 원칙과 충돌을 풀었습니다. 결정 근거는 [ADR](docs/ADR.md)과 [UI Guide](docs/UI_GUIDE.md)에 있습니다.

## 심사자용

- **순서대로 보기**: [3분 투어](docs/REVIEWER_TOUR.md) — 좌석 경합은 창 2개가 필요합니다. 어렵다면 위 GIF가 같은 장면입니다.
- **로그인**: `/admin`·`/seller`에 들어가면 로그인 모달이 뜨고, 입력란에 심사자용 계정 값이 힌트로 보입니다. 인증 범위와 curl 확인 방법은 [투어 문서](docs/REVIEWER_TOUR.md#심사자용-계정)에 있습니다.
- **알고 뺀 것**: 좌석 키보드 내비게이션, E2E, 실사용자 인증·결제, CSRF 토큰 등 — [Scope](docs/SCOPE.md).

## 로컬 실행

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev    # http://localhost:3000 — 환경변수 없이도 관람객 여정 전체가 인메모리로 동작
```

`/admin`·`/seller`를 로컬에서 보려면 `.env.local`에 `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`를 채워야 합니다(비어 있으면 닫힙니다). 요구사항·스크립트·Redis 영속성·배포는 [Development](docs/DEVELOPMENT.md)에 있습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [PRD](docs/PRD.md) | 요구사항·범위·검증 시나리오 |
| [Architecture](docs/ARCHITECTURE.md) · [ADR](docs/ADR.md) | 렌더링 경계·데이터 흐름·Store 인터페이스, 기술 선택과 트레이드오프 |
| [Perf Measurement](docs/PERF_MEASUREMENT.md) | 성능 실측 결과·재현 절차·남은 측정 |
| [Progress Journal](docs/PROGRESS.md) | Day 0~16 단계 요약과 Day별 결정 근거 |
| [AI 협업 방식](docs/AI_COLLABORATION.md) | 규칙·훅·명세와 그것이 실제로 막은 사례 |
| [Test Scenarios](docs/TEST_SCENARIOS.md) | 배포본 수동 검증 시나리오와 PRD 대비 알려진 차이 |
| [Domain Reference](docs/reference/DOMAIN.md) | 좌석 상태 전이·홀드 개념·보안 규칙의 배경 |
| [UX Principles](docs/UX_PRINCIPLES.md) · [UI Guide](docs/UI_GUIDE.md) | UX 원칙과 UI 규칙 |
| [AI Operations Expansion](docs/AI_OPERATIONS_EXPANSION_PLAN.md) | 조회 전용 AI Agent·n8n 확장의 경계와 단계 |
