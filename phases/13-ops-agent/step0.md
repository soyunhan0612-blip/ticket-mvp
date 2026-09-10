# Step 0: agent-tools

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "계층 경계", "Agent 권한 경계", "보안 규약"의 프롬프트 인젝션 절
- `/docs/ADR.md` — ADR-007 (조회 전용 Agent와 기존 admin 게이트 재사용)
- `/docs/ARCHITECTURE.md` — "데이터 흐름"의 Admin 조회 경로와 "Store 인터페이스"
- `/src/lib/operations.ts` — `OperationsRow`(4~14행)와 `collectOperations`(21~61행). 이 step에서 첫 인자 타입을 좁힌다. 실제로 쓰는 Store 메서드는 25행·31행·42행 셋뿐이다
- `/src/lib/operations.test.ts` — 이 파일의 픽스처 구성과 단언 스타일
- `/src/lib/ai-prompt.ts` — `neutralizeUserInput`(18~24행, **현재 non-export**)과 구분자 래핑(39~41행, 98~100행), `OPERATIONS_SUMMARY_ROW_LIMIT`(5행), `selectOperationsSummaryRows`(58~77행)
- `/src/lib/seat-stats.ts` — `computeSeatStats`, `computeSalesRate`. 집계의 단일 출처
- `/src/services/index.ts` — `getShowStore`/`getSeatStore` 팩토리
- `/src/services/show-store.ts`, `/src/services/seat-store.ts` — 각 인터페이스에서 읽기 메서드와 쓰기 메서드의 구분
- `/src/app/api/admin/ai-summary/route.test.ts` — 실제 메모리 스토어로 픽스처를 만드는 방식

## 배경

phase 12가 `GET /api/admin/operations`와 `POST /api/admin/ai-summary`를 만들었다.
둘 다 **사람이 필터를 먼저 고른다.** "이번 주에 가장 많이 팔린 공연이 뭐야"처럼
무엇을 조회할지 스스로 골라야 하는 질문에는 답하지 못한다. 그 자리가 Agent의 자리다
(ADR-007: "Agent는 무엇을 조회할지 골라야 하는 자리에만 쓴다").

이 step은 Agent가 부를 **Tool만** 만든다. Agent 조립과 라우트는 step 1, 화면은 step 2다.

`docs/AI_OPERATIONS_EXPANSION_PLAN.md`의 "Agent 권한 경계"가 이 step의 설계를 지배한다.
Agent는 조회 전용이고, 그 금지를 **문서가 아니라 구조로 강제한다** — 그 문서의 표현으로
"목록만 적어둔 규칙은 지켜지지 않는다".

## 작업

`src/lib/ops-agent-tools.ts`를 만든다. Agent가 호출할 조회 Tool의 **기술자만** 정의하며,
Anthropic SDK를 import하지 않는다.

### SDK를 import하지 않는 이유

`betaZodTool`로 감싸는 일은 step 1의 라우트가 한다. `src/lib/`은 순수 로직 자리이고 조립은
route handler 몫이다(`docs/ARCHITECTURE.md`의 디렉토리 구조, `AI_OPERATIONS_EXPANSION_PLAN.md`의
"계층 경계").

부수적으로 이 분리가 Tool 로직에 테스트를 닿게 한다. 이 저장소에는 `@anthropic-ai/sdk`를
목킹하는 테스트가 **하나도 없다** — AI 라우트 테스트는 `ANTHROPIC_API_KEY`를 지워 폴백
경로만 검증한다. Tool의 조회 로직이 SDK 호출 안에 묻히면 자동 검증이 전혀 닿지 않는다.

### 시그니처

```ts
import { z } from "zod";
import type { SeatStore, ShowStore } from "@/services";

export interface OpsReadStores {
  showStore: Pick<ShowStore, "list" | "get">;
  seatStore: Pick<SeatStore, "getSnapshot">;
}

export interface OpsToolDescriptor<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  run: (args: z.infer<Schema>) => Promise<string>;
}

export function createOpsTools(stores: OpsReadStores): OpsToolDescriptor[];
```

필드 이름과 `run`의 형태는 `betaZodTool`이 받는 옵션 객체와 **같게** 맞춘다. step 1이
`betaZodTool(descriptor)`로 그대로 감쌀 수 있어야 한다.

### Tool 2개

**`list_shows`** — 입력 없음(`z.object({})`). 공연 `id`와 `title` 목록을 돌려준다.
Agent가 "OO 공연 판매율은?"이라는 질문을 `showId`로 옮기려면 이 매핑이 필요하다.

**`list_operations`** — `{ showId?: string, date?: string }`. `collectOperations`를 호출해
회차별 `total`/`available`/`held`/`sold`/`salesRate`를 돌려준다.

`description`은 모델이 읽는 유일한 사용 설명서다. 언제 쓰는 Tool인지, 필터를 생략하면
무엇이 오는지, `date`의 형식이 무엇인지를 한국어로 적는다.

`run`이 돌려주는 문자열의 형식(JSON이냐 줄 단위 텍스트냐)은 재량이다.

### 조회 전용을 타입으로 강제한다

`OpsReadStores`가 `Pick`으로 읽기 메서드만 노출하므로, Tool 구현이 `hold`·`confirmSeats`·
`releaseSold`를 부르려 하는 순간 **컴파일이 깨진다.**

같은 이유로 `src/lib/operations.ts`의 `collectOperations` 첫 인자 타입도 같은 폭으로 좁힌다.
실제로 쓰는 것은 `showStore.list`(25행), `showStore.get`(31행), `seatStore.getSnapshot`(42행)
셋뿐이다. 기존 호출자 두 곳 — `/src/app/api/admin/operations/route.ts`의 22~25행과
`/src/app/api/admin/ai-summary/route.ts`의 138~141행 — 은 전체 Store를 넘기므로 구조적
타이핑상 그대로 통과한다. **호출부를 고치지 마라.**

타입 정의를 두 파일 중 어디에 둘지는 재량이되 **한 벌만** 둔다. 두 벌이 되면 한쪽만
좁혀지는 일이 생긴다.

### Tool 결과도 사용자 입력이다

공연 제목은 셀러가 입력한 값이다. Tool 결과에 그대로 실으면 제목에 심은 지시문이 Agent의
다음 판단에 그대로 들어간다 — 요약 프롬프트에서 막아둔 구멍이 Tool 결과로 다시 열린다.
`AI_OPERATIONS_EXPANSION_PLAN.md`가 "**Tool 결과로 돌아온 텍스트도 사용자 입력으로
취급한다**"고 못 박은 지점이다.

- `showTitle`은 `neutralizeUserInput`으로 중화하고 `===USER_INPUT_START===` /
  `===USER_INPUT_END===`로 감싼다
- `src/lib/ai-prompt.ts:18`의 `neutralizeUserInput`을 **export로 바꿔 재사용한다.**
  같은 규칙을 다시 구현하지 마라
- 결과 행 수에 상한을 둔다. 시드만으로 회차가 24개이고, 필터 없는 호출이 매번 전 회차를
  실으면 Tool 결과 하나가 컨텍스트를 채운다. 상한 값은 재량이되 **상수로 뽑고**, 잘렸으면
  몇 개가 빠졌는지 결과 텍스트에 밝힌다 — 밝히지 않으면 모델이 주어진 것을 전부로 알고 답한다

`ai-prompt.ts`의 `OPERATIONS_SUMMARY_ROW_LIMIT`와 `selectOperationsSummaryRows`를 재사용할지
Tool 전용 상한을 새로 둘지는 재량이다. 재사용한다면 요약과 Tool이 같은 상한을 공유하는 것이
의도임을 주석에 남겨라.

### 예약 집계 Tool은 만들지 않는다

`ReservationStore`의 읽기 메서드는 `listByUser(userId)` 하나뿐이라 운영 집계로 쓸 수 없다.

### 쓰기 API 미참조를 테스트로 고정한다

`docs/AI_OPERATIONS_EXPANSION_PLAN.md`의 "Agent 권한 경계"가 요구하는 검증이다.
타입 강제는 컴파일 시점의 방어이고, 이 테스트는 그 경계가 나중에 조용히 넓어지는 것을 막는다.

Agent 모듈 파일 경로 목록을 **배열 상수**로 두고, 각 파일의 소스를 읽어 아래 식별자가
나오지 않음을 검증한다:

`hold`, `release`, `confirmSeats`, `releaseSold`, `revertSold`, `getReservationStore`, `ReservationStore`

이 step에서 배열에 들어가는 것은 `src/lib/ops-agent-tools.ts` 하나다. step 1이 라우트를
추가한다. **배열 상수를 테스트 파일 상단에 두고, 다음 step이 여기에 파일을 추가한다는
주석을 남겨라.**

소스를 읽는 방법은 재량이다(`node:fs`의 `readFileSync` 등). vitest는 저장소 루트에서
돌므로 경로 기준은 `process.cwd()`다.

### TDD 순서

`src/lib/`은 TDD 가드 구간이라 테스트 없이는 편집이 차단된다.
`src/lib/ops-agent-tools.test.ts`를 **반드시 먼저** 작성한다. `neutralizeUserInput`의
export 전환도 `src/lib/ai-prompt.test.ts`에 테스트를 더한 뒤 손댄다.

테스트 케이스:

1. `list_shows`가 공연 `id`와 `title`을 돌려준다
2. `list_operations`가 필터 없이 호출되면 전 회차를, `showId`를 주면 그 공연 회차만 돌려준다
3. `list_operations` 결과가 `total`/`available`/`held`/`sold`/`salesRate`를 담는다
4. 공연 제목이 구분자 안에 들어가고, 제목에 `===USER_INPUT_END===`를 심어도 구분자 쌍이 하나만 남는다
5. 회차가 상한을 넘으면 잘라내고 몇 개가 빠졌는지 결과에 밝힌다
6. 읽기 메서드만 가진 객체를 `createOpsTools`에 넘겨도 동작한다 (읽기 전용 계약)
7. Agent 모듈 소스에 쓰기 API 식별자가 없다

Store는 목킹하지 않고 `getShowStore()`/`getSeatStore()`로 실제 메모리 스토어를 쓴다 —
`vitest.setup.ts`가 Upstash 환경변수를 지워 항상 메모리 구현이 돈다. 픽스처는
`src/app/api/admin/ai-summary/route.test.ts`가 `getShowStore().create(...)`로 공연을 만들고
`getSeatStore().hold(...)`/`confirmSeats(...)`로 좌석 상태를 만드는 방식을 따른다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/lib/ops-agent-tools.ts`가 `@anthropic-ai/sdk`를 import하지 않는가?
   - `OpsReadStores`가 `Pick`으로 좁혀져 있고, Tool의 `run`이 쓰기 메서드를 부르지 않는가?
   - `collectOperations` 호출부 두 곳(`operations/route.ts`, `ai-summary/route.ts`)이 무수정인가?
   - 공연 제목이 구분자 없이 Tool 결과에 들어가는 경로가 없는가?
   - `package.json`이 무수정인가?
3. 결과에 따라 `phases/13-ops-agent/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **생성한 파일 경로, Tool 이름과 각 입력 스키마, 행 수 상한 상수 이름**을 적어라.
step 1의 라우트가 이 Tool들을 그대로 조립하므로 다음 세션이 이 정보를 필요로 한다.

## 금지사항

- `src/lib/ops-agent-tools.ts`에서 `@anthropic-ai/sdk`를 import하지 마라. 이유: `src/lib/`은 순수 로직 자리이고 SDK 조립은 route handler 몫이다. 또 이 저장소는 SDK를 목킹하는 테스트가 없어서, Tool 로직이 SDK 안에 묻히면 자동 검증이 닿지 않는다.
- Tool에서 Store의 쓰기 메서드(`hold`/`release`/`confirmSeats`/`releaseSold`/`revertSold`)를 부르지 마라. 이유: Agent는 조회 전용이다(ADR-007). 좌석 hold와 예약 확정은 원자성과 소유권 검증이 가장 조밀한 지점이라, 자연어 판단이 개입하면 "왜 이 좌석이 풀렸는가"를 사후에 설명할 수 없다.
- `OpsReadStores`를 전체 `ShowStore`/`SeatStore`로 넓히지 마라. 이유: 타입이 이 규칙의 유일한 구조적 강제 수단이다. 넓히면 금지가 주석으로만 남고, 주석은 지켜지지 않는다.
- Tool 안에서 `getShowStore()`/`getSeatStore()`를 직접 부르지 마라. 이유: `collectOperations`가 주입을 받는 이유와 같다. 직접 부르면 테스트가 스토어를 갈아끼울 수 없고, 읽기 전용 타입 강제도 우회된다.
- `ReservationStore`에 전체 예약을 조회하는 메서드를 추가하지 마라. 이유: 남의 예약 레코드를 Agent 답변에 실을 경로가 생긴다. 운영 응답은 집계 수치만 내보낸다.
- 공연 제목을 구분자 없이 Tool 결과에 넣지 마라. 이유: 셀러가 입력한 값이라 제목에 지시문을 심어 Agent의 다음 Tool 선택과 답변을 조종할 수 있다.
- `neutralizeUserInput`과 같은 중화 로직을 새로 구현하지 마라. 이유: 규칙이 두 벌이 되면 한쪽만 고쳐진다. `=` 연속을 접는 방식에는 이유가 있고(`ai-prompt.ts` 9~17행 주석), 새로 짜면 그 이유가 유실된다.
- `collectOperations`의 호출부를 고치지 마라. 이유: 타입을 좁히는 방향이라 넓은 타입을 넘기는 기존 호출은 그대로 통과한다. 고치면 이 step의 범위를 벗어난 변경이 된다.
- 이 step에서 라우트나 Admin 화면을 만들지 마라. 이유: Agent 조립은 step 1, UI는 step 2다. 한 step에서 한 레이어만 다룬다.
- 새 의존성을 추가하지 마라. `zod`는 이미 있다.
- 기존 테스트를 깨뜨리지 마라.
