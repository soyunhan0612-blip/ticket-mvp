# Step 0: sellout-alert

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "계층 경계", "Operations API 계약", 그리고 로드맵 아래의 n8n 절
- `/docs/ADR.md` — ADR-007, 특히 "n8n을 Agent와 분리한 이유"
- `/src/lib/operations.ts` — `OperationsRow`(4~14행)와 `OperationsFilter`(16~19행). 이 step이 다루는 입력 타입이다
- `/src/lib/operations.test.ts` — 이 파일의 픽스처 구성과 단언 스타일
- `/src/lib/ai-prompt.ts` — `neutralizeUserInput`(export됨, 두 번째 인자로 길이 상한을 받는다)과 `selectOperationsSummaryRows`. 행을 골라내는 기존 함수의 형태를 보라
- `/src/lib/seat-stats.ts` — `computeSalesRate`. 판매율의 단일 출처다

## 배경

phase 12가 `GET /api/admin/operations`로 회차별 판매율을 노출했고, phase 13이 조회 전용 Agent를 붙였다. 남은 것은 **사람이 묻지 않아도 먼저 알려주는** 자리다.

ADR-007이 그 자리를 Agent에게 주지 않은 이유를 명시한다 — "판매율이 90%를 넘으면 알린다"는 **판단이 필요 없는 조건 분기**이고, 여기에 LLM을 끼우면 비용과 비결정성만 늘고 얻는 것이 없다. 그래서 n8n이 맡는다.

그렇다고 판정 규칙을 n8n 안에 두면 저장소에 테스트가 닿지 않는다. n8n은 **저장소 밖 인프라**라 그 안의 IF 노드나 Function 노드는 이 프로젝트의 어떤 검증도 받지 못한다. 그래서 임계값·정렬·문구는 `src/lib/`의 순수 함수로 두고, n8n은 호출과 전달만 한다.

이 step은 그 **순수 함수만** 만든다. 라우트는 step 1, n8n 워크플로는 step 2다.

## 작업

`src/lib/sellout-alert.ts`를 만든다. I/O가 없고 Store를 모른다 — `OperationsRow[]`를 받아 거르고 문장을 만든다.

### 시그니처

```ts
import type { OperationsRow } from "@/lib/operations";

export const SELLOUT_RISK_THRESHOLD: number;

export function selectSelloutRiskRows(
  rows: OperationsRow[],
  threshold?: number,
): OperationsRow[];

export function buildSelloutAlertText(rows: OperationsRow[]): string;
```

### `SELLOUT_RISK_THRESHOLD`

`90`이다. 상수로 뽑는 이유는 step 1의 라우트가 기본값으로 쓰고 step 2의 워크플로 문서가 이 값을 인용하기 때문이다. 세 곳이 각자 90을 적으면 한 곳만 바뀐다.

### `selectSelloutRiskRows`

- `threshold` 이상인 행만 남긴다. 비교는 **`>=`** 다 — 정확히 90.0%인 회차를 빠뜨리면 "임박"의 의미가 어긋난다
- 판매율 **내림차순**으로 정렬한다. 알림을 읽는 사람은 가장 급한 것을 먼저 봐야 한다
- `threshold`를 생략하면 `SELLOUT_RISK_THRESHOLD`를 쓴다
- 입력 배열을 **변형하지 마라.** 정렬은 복사본에 한다. 호출자가 같은 배열을 다른 용도로 쓴다

`salesRate`를 여기서 다시 계산하지 마라. `OperationsRow.salesRate`는 `collectOperations`가 `computeSalesRate`로 이미 채운 값이다. 두 번 계산하면 반올림 자리가 갈린다.

### `buildSelloutAlertText`

Slack으로 보낼 **plain text**를 만든다. 형식은 재량이되 아래를 지킨다.

- 회차마다 **공연 제목 · 시작 시각 · 판매율 · 남은 좌석 수**가 드러난다. 알림만 읽고 대응할 수 있어야 한다
- 행이 없으면 **빈 문자열**을 돌려준다. "해당 없음" 같은 문장을 만들지 마라 — step 1이 이 값의 길이로 보낼지 말지를 가린다
- 마크다운 문법을 쓰지 마라. 목적지가 Slack이든 이메일이든 그대로 읽히는 문장이어야 한다

### 공연 제목은 셀러 입력이다

`showTitle`은 셀러가 등록한 값이라 개행이나 과도한 길이를 담을 수 있다. 그대로 이으면 알림 한 줄이 화면을 덮거나 줄 구조가 무너진다.

`src/lib/ai-prompt.ts`의 **`neutralizeUserInput`을 재사용한다.** 두 번째 인자로 길이 상한을 받으므로 알림에 맞는 값을 넘긴다. 상한 값은 재량이되 상수로 뽑아라.

같은 중화 로직을 새로 구현하지 마라. 공백 접기와 `=` 연속 접기에는 이유가 있고(`ai-prompt.ts`의 함수 위 주석), 규칙이 두 벌이 되면 한쪽만 고쳐진다.

### TDD 순서

`src/lib/`은 TDD 가드 구간이라 테스트 없이는 편집이 차단된다. `src/lib/sellout-alert.test.ts`를 **반드시 먼저** 작성한다.

테스트 케이스:

1. 임계값 이상인 행만 남는다
2. **정확히 임계값과 같은 행이 남는다** (`>=` 경계)
3. 결과가 판매율 내림차순이다
4. `threshold`를 생략하면 `SELLOUT_RISK_THRESHOLD`가 적용된다
5. 입력 배열이 변형되지 않는다 (호출 전후 순서 비교)
6. 행이 없으면 `buildSelloutAlertText`가 빈 문자열을 돌려준다
7. 알림 문장에 제목·시작 시각·판매율·잔여 좌석이 들어간다
8. 제목에 개행이 들어 있어도 알림이 한 줄 구조를 유지한다

픽스처는 `src/lib/operations.test.ts`가 `OperationsRow`를 만드는 방식을 따른다. Store를 부르지 마라 — 이 함수들은 순수하다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/lib/sellout-alert.ts`가 Store나 `fetch`를 부르지 않는가? (순수 함수여야 한다)
   - `salesRate`를 다시 계산하는 코드가 없는가?
   - `neutralizeUserInput`을 재사용했고 중화 로직을 새로 짜지 않았는가?
   - `package.json`이 무수정인가?
3. 결과에 따라 `phases/14-ops-automation/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **생성한 파일 경로, export한 함수와 상수 이름, 임계값과 제목 길이 상한의 값**을 적어라. step 1의 라우트가 이것들을 그대로 조립한다.

## 금지사항

- Store(`getShowStore`·`getSeatStore`)나 `collectOperations`를 이 파일에서 부르지 마라. 이유: 이 step은 순수 판정 로직이다. I/O를 넣으면 테스트가 스토어에 묶이고, 라우트가 이미 하는 조립을 두 곳에서 하게 된다.
- `salesRate`를 다시 계산하지 마라. 이유: `computeSalesRate`가 단일 출처다. 두 번 계산하면 소수 1자리 반올림이 갈려 Admin 화면과 알림이 다른 숫자를 말한다.
- 임계값을 함수 안에 리터럴로 박지 마라. 이유: 라우트의 기본값과 워크플로 문서가 같은 값을 인용한다. 세 곳이 각자 적으면 한 곳만 바뀐다.
- 입력 배열을 `sort()`로 제자리 정렬하지 마라. 이유: `Array.prototype.sort`는 원본을 바꾼다. 호출자가 같은 배열을 다른 용도로 들고 있다.
- `neutralizeUserInput`과 같은 중화 로직을 새로 구현하지 마라. 이유: 규칙이 두 벌이 되면 한쪽만 고쳐진다. 공백·`=` 접기 방식에는 이유가 있고(`ai-prompt.ts` 함수 위 주석), 새로 짜면 그 이유가 유실된다.
- 알림 문장에 마크다운 문법을 넣지 마라. 이유: 목적지가 Slack만이라는 보장이 없고, 이 저장소는 AI 응답도 plain text로 렌더한다.
- 이 step에서 라우트나 n8n 파일을 만들지 마라. 이유: 라우트는 step 1, 워크플로는 step 2다. 한 step에서 한 레이어만 다룬다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
