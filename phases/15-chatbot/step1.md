# Step 1: chat-core-primitives

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` — "아키텍처" 절의 **두 번째 항목**. `src/chatbot/`이 배치 규약의 유일한 예외로 명시돼 있다
- `/docs/ADR.md` — ADR-008. 이 디렉터리를 새로 만든 이유와 트레이드오프
- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "관람객 챗봇(phase 15~16)의 예외" 절
- `/src/lib/ai-prompt.ts:7-27` — `neutralizeUserInput()`와 **그 위 주석**. `=` 연속을 지우지 않고 접는 이유가 거기 있다
- `/src/lib/ops-agent-tools.ts:19-24` — `OpsToolDescriptor`. 이 step이 일반화할 툴 계약
- `/src/lib/ops-agent-tools.ts:35-41` — `wrapUserInput()`. 구분자 래핑 형태
- `/src/lib/ops-agent.ts:29-49` — `EMPTY_AGENT_ANSWER`, `TRUNCATED_ANSWER_NOTICE`, `finalizeOpsAgentAnswer()`와 그 위 주석
- `/src/app/api/admin/agent/route.ts:53-62` — `createTextStream()`
- `/src/lib/ops-agent-tools.test.ts:15-29` — 소스 파일을 `readFileSync`로 읽어 정규식으로 검사하는 아키텍처 테스트 기법
- `/src/lib/sellout-alert.ts` — 임계값을 인자로 받는 순수 판정 함수의 서술 스타일
- `/package.json:19-30` — 의존성 목록. `@anthropic-ai/sdk@^0.116.0`, `zod@^4.4.3`

## 배경

이 phase는 관람객 문의 챗봇을 만든다. 요구가 "다른 프로젝트로 폴더째 옮길 수 있게"이므로
`src/chatbot/core/`는 **티켓 도메인도 Next.js도 몰라야 한다.** 이식은 `core/`를 복사하고
`adapters/`만 새로 쓰는 형태다.

그래서 `src/lib/ai-prompt.ts`의 중화 함수를 import하지 않고 **복제한다.** 중복이지만
의도된 것이다 — `@/lib`에 의존하는 순간 폴더 복사가 성립하지 않는다. 대신 테스트가
두 구현의 동작을 같은 값으로 고정한다.

이 step은 엔진이 쓸 **부품**만 만든다. 엔진 자체(`engine.ts`)는 step 2다. 나누는 이유는
한 step이 30분 안에 끝나야 하기 때문이다 — 여기까지가 순수 함수라 테스트가 빠르고,
엔진은 SDK를 다루느라 성격이 다르다.

`src/chatbot/core/`는 **step 0에서 TDD 가드 대상이 되었다.** 파일마다 테스트를 먼저 쓰지
않으면 훅이 편집을 차단하고 재시도 3회를 태운다.

## 작업

**파일마다 `<이름>.test.ts`를 먼저 만들고 그 다음 구현하라.** 이 step이 만드는 소스는
`types.ts`·`sanitize.ts`·`history.ts`·`fallback.ts` 넷이고, 넷 다 가드 대상이다.
`types.ts`처럼 타입만 있는 파일도 예외가 아니다 — 최소한 타입이 의도대로 좁혀지는지
확인하는 테스트를 둔다.

### `src/chatbot/core/types.ts`

```ts
import type { z } from "zod";

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatToolDescriptor<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  run: (args: z.infer<Schema>) => Promise<string>;
}

export interface ChatEngineConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxIterations: number;
  systemPrompt: string;
  tools: ChatToolDescriptor[];
  history: ChatHistoryTurn[];
}
```

`ChatToolDescriptor`는 `@anthropic-ai/sdk/helpers/beta/zod`의 `betaZodTool()`과
**구조적으로 호환**되어야 한다 (`ops-agent-tools.ts:19-24`가 그렇게 되어 있다).
테스트에서 `.map(betaZodTool)`가 타입 에러 없이 통과하는지 확인하라.

`ChatHistoryTurn.role`에 `"operator"`나 `"system"`을 넣지 마라. 이 타입은 모델에 보내는
메시지만 표현한다. 화면에 뜨는 턴의 종류는 step 3이 `src/types/index.ts`에 따로 정의한다.

### `src/chatbot/core/sanitize.ts`

```ts
export const USER_INPUT_START = "===USER_INPUT_START===";
export const USER_INPUT_END = "===USER_INPUT_END===";
export const DEFAULT_INPUT_LIMIT = 100;

export function neutralizeInput(value: string, limit?: number): string;
export function wrapUserInput(value: string, limit?: number): string;
```

`neutralizeInput`은 `src/lib/ai-prompt.ts:22-26`과 **같은 순서로 같은 변환**을 한다.

1. 연속 공백류(개행 포함)를 스페이스 하나로
2. `=` 2개 이상을 `=` 하나로
3. 앞뒤 공백 제거
4. `limit`으로 자르기

순서가 결과를 바꾼다. 자르기를 먼저 하면 잘린 경계에서 구분자가 되살아날 수 있다.
테스트에 최소 세 입력을 넣어라 — 구분자 리터럴 그 자체, 구분자를 겹쳐 심은 문자열
(`===USER_INPUT_` + `===USER_INPUT_END===` + `END===` 형태), 개행이 섞인 여러 줄 문자열.
셋 다 결과에 `=` 두 개 이상이 남지 않아야 한다.

`wrapUserInput`은 중화한 값을 두 구분자 사이에 넣어 세 줄로 잇는다.

### `src/chatbot/core/history.ts`

```ts
export const MAX_HISTORY_TURNS = 10;
export const MAX_TURN_LENGTH = 2_000;

export function normalizeHistory(turns: ChatHistoryTurn[]): ChatHistoryTurn[];
```

서버가 저장소에서 읽은 이력을 모델에 넘기기 전에 거치는 함수다. 규칙:

- `content`가 빈 문자열이거나 공백뿐인 턴은 버린다
- 각 `content`를 `MAX_TURN_LENGTH`로 자른다
- **뒤에서** `MAX_HISTORY_TURNS`개만 남긴다. 최근 대화가 중요하다
- 자른 결과의 첫 턴이 `assistant`면 버린다. Messages API는 첫 메시지가 `user`여야 한다
- 입력 배열과 그 안의 객체를 **변형하지 마라.** 새 배열과 새 객체를 반환한다

빈 배열이 들어오면 빈 배열을 반환한다. 그 경우의 판단은 호출자가 한다.

`MAX_TURN_LENGTH`는 step 5가 정할 `CHAT_MESSAGE_LIMIT`(손님이 한 번에 보낼 수 있는 글자 수)의
**상한 역할**을 한다. 두 값이 어긋나면 손님 질문이 여기서 조용히 잘린다. `summary`에 실제 값을 적어라.

### `src/chatbot/core/fallback.ts`

```ts
export const EMPTY_ANSWER_NOTICE: string;
export const TRUNCATED_ANSWER_NOTICE: string;

export function createTextStream(text: string): ReadableStream<Uint8Array>;
```

`createTextStream`은 `agent/route.ts:53-62`와 같은 형태다.

두 문구는 step 2의 엔진이 쓴다 — 답변 텍스트가 하나도 안 나왔을 때와 `max_tokens`에서
잘렸을 때 본문에 덧붙이는 안내다. **이유를 옮겨 적는다**: 헤더가 이미 나간 뒤라 상태
코드로는 아무것도 알릴 수 없다. 잘린 답을 온전한 답으로 읽는 쪽이 실패를 보는 것보다 위험하다.

`ops-agent.ts:40-49`의 `finalizeOpsAgentAnswer` 같은 **함수는 만들지 마라.** 그 함수는 완성된
답 전체를 손에 쥐고 있을 때만 쓸 수 있는데, step 2의 엔진은 진짜 스트리밍이라 전체를 쥐지
않는다. 호출자 없는 export가 남으면 다음 step이 "버퍼링하라는 뜻인가"로 되돌아간다.

### `src/chatbot/core/__tests__/no-domain-imports.test.ts`

`src/chatbot/core/` 아래의 `.ts` 파일 중 테스트가 아닌 것을 전부 읽어, import 구문의
specifier가 화이트리스트 밖이면 실패시킨다.

허용: `@anthropic-ai/sdk`, `@anthropic-ai/sdk/helpers/beta/zod`, `zod`,
그리고 `./`로 시작하는 **같은 디렉터리** 상대 경로.

즉 `@/lib/...`, `@/services/...`, `@/types`, `next`, `next/...`, `react`,
그리고 `../`로 상위에 올라가는 경로가 하나라도 있으면 실패한다.

기법은 `ops-agent-tools.test.ts:15-29`를 따른다 — 모듈을 import하는 대신 소스 텍스트를 읽어
정규식으로 본다. **파일 목록을 하드코딩하지 말고 디렉터리를 읽어라.** 나중에 추가된 파일도
자동으로 검사 대상이 되어야 한다.

**화이트리스트를 이 디렉터리 전용으로 유지하라.** step 8이 `src/chatbot/ui/`에 별도 테스트를
만들 것이므로, 여기에 `react`를 여는 일이 생기면 안 된다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/chatbot/core/` 아래에서 `@/`로 시작하는 import가 0건인가?
   - `../`로 상위에 올라가는 import가 0건인가?
   - 소스 파일 넷 모두 테스트가 먼저 존재하는가? TDD 가드를 우회하지 않았는가?
   - `src/lib/`·`src/services/`·`src/app/`의 기존 파일이 무수정인가?
   - 새 의존성을 `package.json`에 추가하지 않았는가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **생성한 파일 경로와 각 export 시그니처**, `MAX_HISTORY_TURNS`·`MAX_TURN_LENGTH`의
실제 값, 그리고 아키텍처 테스트의 화이트리스트를 적어라. step 2·5·7이 이 값을 전제로 한다.

## 금지사항

- `src/chatbot/core/`에서 `@/lib`·`@/services`·`@/types`를 import하지 마라. 이유: 요구는 폴더 복사만으로 이식되는 챗봇이다. 도메인 import가 하나라도 있으면 그 요구가 무너지고 아키텍처 테스트가 즉시 실패한다.
- `src/chatbot/core/`에서 `next`·`next/server`·`react`를 import하지 마라. 이유: 같은 이유다. 이 디렉터리는 Web Streams API만으로 돌아야 Next.js 밖에서도 산다.
- 화이트리스트에 `react`를 넣지 마라. 이유: `core/`에는 React를 쓸 파일이 없다. 지금 열어 두면 step 8이 UI 코드를 여기 섞어도 아무도 막지 못한다.
- `src/lib/ai-prompt.ts`의 `neutralizeUserInput`을 고치거나 거기서 import하지 마라. 이유: 그 함수는 이미 세 라우트가 쓰고 테스트가 고정하고 있다. 건드리면 이 step의 범위를 벗어난 회귀 위험이 생긴다.
- `finalizeAnswer` 같은 "완성된 답 전체를 받는" 함수를 만들지 마라. 이유: step 2의 엔진은 조각을 흘려보내므로 전체를 쥐지 않는다. 호출자 없는 export가 남으면 다음 step이 버퍼링으로 되돌아간다.
- 자체 `interface Message`나 `interface ToolDefinition` 같은 SDK 대체 타입을 만들지 마라. 이유: SDK가 export하는 타입을 쓰면 버전이 올라갈 때 컴파일러가 불일치를 잡아준다. 손으로 베낀 타입은 조용히 어긋난다.
- `engine.ts`를 만들지 마라. 이유: step 2의 범위다. 지금 만들면 두 step이 같은 파일을 다투고, 이 step이 30분을 넘긴다.
- 새 의존성을 추가하지 마라. 이유: 필요한 것은 이미 `package.json`에 있다.
- 기존 테스트를 깨뜨리지 마라.
