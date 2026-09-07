# Step 1: operations-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — 특히 "보안 규약"과 "Operations API 계약"
- `/docs/ADR.md` — ADR-007 (조회 전용 Agent와 기존 admin 게이트 재사용)
- `/docs/ARCHITECTURE.md` — 데이터 흐름의 조회 경로, 보안 경계의 쿠키 절
- `/src/lib/seat-stats.ts` — Step 0에서 만든 `computeSeatStats`
- `/src/app/api/admin/stats/route.ts` — 같은 게이트 아래의 기존 라우트 패턴
- `/src/services/show-store.ts`, `/src/services/seat-store.ts` — Store 인터페이스
- `/src/middleware.ts` — `/api/admin` 게이트와 `withUserIdCookie`
- `/src/types/index.ts` — `Show`, `Session`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/app/api/admin/operations/route.ts`에 운영 현황 조회 API를 만든다. Admin 화면·AI 요약·n8n이 공유하는 **공용** 조회 엔드포인트이며, 특정 소비자 전용 API가 아니다.

### 요청

```
GET /api/admin/operations?showId=<선택>&date=<선택>
```

- `showId` — 있으면 그 공연의 회차만
- `date` — `YYYY-MM-DD`. `Session.startsAt`이 UTC ISO 문자열(`2026-09-04T10:30:00.000Z`)이므로 **UTC 기준 날짜**로 비교한다. 표시용 시간대 변환은 UI의 몫이다
- 둘 다 zod로 검증한다. 형식이 틀리면 400

### 응답

```ts
interface OperationsRow {
  showId: string;
  showTitle: string;
  sessionId: string;
  startsAt: string;   // ISO
  total: number;
  available: number;
  held: number;
  sold: number;
  salesRate: number;  // 소수 1자리
}

// 200 응답 본문
{ sessions: OperationsRow[] }   // startsAt 오름차순
```

### 판매율

`src/lib/seat-stats.ts`에 다음을 추가한다.

```ts
export function computeSalesRate(sold: number, total: number): number;
```

- `sold / total * 100`을 소수 **1자리**로 반올림한다
- 분모는 총좌석이다. hold는 판매가 아니므로 분자에 넣지 않는다
- `total`이 0이면 0을 반환한다 (0으로 나누지 않는다)

### 조립은 재사용 가능한 함수로 뺀다

Step 2의 AI 요약도 같은 데이터를 서버에서 만들어야 한다. 라우트 안에 조립을 두면 그때 그대로 복제된다. `src/lib/operations.ts`에 아래를 만들고 라우트는 얇은 래퍼로 둔다.

```ts
import type { SeatStore, ShowStore } from "@/services";

export interface OperationsFilter {
  showId?: string;
  date?: string;
}

export async function collectOperations(
  stores: { showStore: ShowStore; seatStore: SeatStore },
  filter: OperationsFilter,
): Promise<OperationsRow[]>;
```

Store를 **인자로 주입받는다**. 모듈 최상단에서 `get*Store()`를 부르지 않는다 — 그래야 `lib/`에 있을 자격이 있고, 테스트가 모듈 목킹 없이 가짜 Store 객체만으로 돈다. `createReservationStoreMemory(seatStore)`가 이미 쓰는 방식이다.

내부 흐름: `showStore.list()` → `showId` 필터 → 각 공연의 회차는 `showStore.get(showId)` → `date` 필터 → 회차마다 `seatStore.getSnapshot(sessionId, "")` → `computeSeatStats(snapshot.seats, show.presetId)` → `computeSalesRate`.

`getSnapshot`의 두 번째 인자는 `mine` 판정에만 쓰이고 집계 수치에 영향이 없다. 빈 문자열을 넘기고 결과에 `mine`을 담지 않는다.

라우트는 쿼리를 zod로 검증하고 `collectOperations({ showStore: getShowStore(), seatStore: getSeatStore() }, filter)`를 호출해 `{ sessions }`로 감싸 돌려주는 것까지만 한다.

**인증은 미들웨어가 담당한다.** `/api/admin` 이하는 미인증 시 미들웨어가 401 JSON을 돌려주므로, 라우트 안에 별도 인증 코드를 두지 않는다.

**알려진 전제**: 시드 공연 8건(`src/lib/mock-data.ts`)에는 `presetId`가 없어 `total`이 항상 `TOTAL_SEATS`(2000)로 잡힌다. 이 step에서 시드를 고치지 않는다. 전제를 그대로 두고 집계만 정확히 한다.

### TDD 순서

`src/lib/operations.ts`와 `src/app/api/admin/operations/route.ts` 둘 다 TDD 가드 구간이다. 각각의 테스트 파일을 **반드시 먼저** 작성한다.

`src/lib/operations.test.ts` — 가짜 `ShowStore`/`SeatStore` 객체를 만들어 `collectOperations`를 직접 검증한다.
`src/app/api/admin/operations/route.test.ts` — 기존 `src/app/api/admin/stats/route.test.ts`의 `new Request(...)` 패턴을 따른다.

테스트 케이스(두 파일에 적절히 나눠 배치한다):

1. 필터 없이 호출하면 모든 회차를 `startsAt` 오름차순으로 돌려준다
2. `showId`로 필터링한다
3. `date`로 필터링한다 (UTC 기준)
4. 잘못된 `date` 형식이면 400
5. held/sold가 집계에 반영되고 `salesRate`가 sold 기준으로 계산된다
6. `userId` 쿠키가 없어도 200을 돌려준다
7. 응답 어디에도 `userId`나 `mine`이 없다
8. 존재하지 않는 `showId`면 빈 배열

`computeSalesRate`의 단위 테스트(반올림, `total = 0`)는 `src/lib/seat-stats.test.ts`에 더한다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `collectOperations`가 `computeSeatStats`·`computeSalesRate`를 호출하는가? 집계를 다시 구현하지 않았는가?
   - `src/lib/operations.ts`가 모듈 최상단에서 `get*Store()`를 호출하지 않는가?
   - `getUserIdFromRequest`를 호출하지 않는가?
   - 응답 직렬화 결과에 `userId`·`mine`이 없는가?
   - `/api/admin/stats`가 그대로인가?
3. 결과에 따라 `phases/12-ai-operations/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `getUserIdFromRequest`로 401을 내지 마라. 이유: 미들웨어의 `withUserIdCookie`는 익명 UUID를 **응답에만** 싣는다. 쿠키를 보관하지 않고 `Authorization: Basic`만 보내는 호출자(n8n 스케줄 실행, `curl`)는 매 요청 401을 맞는다. 신원 확인은 미들웨어 게이트가 한다.
- 응답에 `userId`, `mine`, 개별 예약 레코드를 싣지 마라. 이유: CLAUDE.md의 "남의 userId를 응답에 싣지 않는다"에 걸린다. 운영 응답은 집계 수치만 낸다.
- 집계나 조립을 라우트 안에 인라인으로 두지 마라. `collectOperations`와 `computeSeatStats`를 호출한다. 이유: Admin 화면과 이후 AI 답변이 같은 회차에 대해 다른 숫자를 말하게 된다.
- `/api/admin/stats`를 수정하거나 대체하지 마라. 이유: Admin 화면이 쓰고 있고 이 step의 범위가 아니다.
- 캐시 계층을 추가하지 마라. 이유: 필터 없이 호출하면 회차 수만큼 스냅샷을 조회하지만(시드 기준 24회), 이 저장소는 측정 없는 최적화를 기록하지 않는다. 병목이 실제로 확인되면 그때 별도 step으로 다룬다.
- 새 의존성을 추가하지 마라. `zod`는 이미 있다.
- 기존 테스트를 깨뜨리지 마라.
