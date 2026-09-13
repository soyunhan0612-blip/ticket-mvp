# Step 2: chat-engine

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/src/chatbot/core/types.ts` — **step 1에서 생성됨.** `ChatEngineConfig`, `ChatToolDescriptor`
- `/src/chatbot/core/history.ts` — **step 1에서 생성됨.** `normalizeHistory()`
- `/src/chatbot/core/fallback.ts` — **step 1에서 생성됨.** `EMPTY_ANSWER_NOTICE`, `TRUNCATED_ANSWER_NOTICE`
- `/src/chatbot/core/__tests__/no-domain-imports.test.ts` — **step 1에서 생성됨.** 디렉터리를 읽으므로 이 step의 새 파일도 자동으로 검사 대상이 된다
- `/src/app/api/admin/agent/route.ts:64-102` — `createAgentStream()`. **`await runner`로 끝까지 기다렸다가 한 번에 enqueue한다** — 이 step이 고치는 지점
- `/src/app/api/admin/agent/route.ts:1-2` — `Anthropic`과 `betaZodTool` import 형태
- `/src/lib/ops-agent.ts:14-16` — `AGENT_MAX_TOKENS`·`AGENT_MAX_ITERATIONS`와 그 위 주석(왜 그 값인지)
- `/docs/ARCHITECTURE.md` — "AI 엔드포인트" 절
- `/node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` — `toolRunner` 오버로드 선언. `stream: true`일 때의 반환 타입을 눈으로 확인하라
- `/node_modules/@anthropic-ai/sdk/lib/tools/BetaToolRunner.d.ts` — `[Symbol.asyncIterator]`의 조건부 반환 타입
- `/node_modules/@anthropic-ai/sdk/lib/BetaMessageStream.d.ts` — `finalMessage()` 시그니처

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 1이 부품을 만들었다. 이 step이 대화 루프를 만든다.

기존 `/api/admin/agent`도 `toolRunner`로 도구를 골라 쓰지만 **스트리밍이 가짜다.**
`agent/route.ts:87-95`가 툴 루프가 끝날 때까지 기다린 뒤 텍스트를 한 번에 enqueue한다:

```ts
const message = await runner;
const answer = message.content.filter(...).map(...).join("");
controller.enqueue(encoder.encode(finalizeOpsAgentAnswer(answer, message.stop_reason)));
```

버튼 한 번에 답 하나인 운영 패널에서는 견딜 만했지만, 대화형 UI에서는 첫 글자까지의 지연이
그대로 드러난다. 이 step은 **진짜 스트리밍**으로 만든다.

SDK 사용법에서 한 가지가 직관과 다르다. `stream: true`를 주면 **바깥 루프가 내놓는 것은
메시지가 아니라 스트림이다.** 바깥은 툴 루프의 iteration, 안쪽은 그 iteration의 이벤트다.
스트림 객체에서 `stop_reason`을 바로 읽으면 항상 `undefined`이므로 `finalMessage()`를 거쳐야
한다. 위 `node_modules` 타입 선언에서 직접 확인하라 — 추측하지 마라.

`src/chatbot/core/`는 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/chatbot/core/engine.ts`

```ts
export function createChatStream(config: ChatEngineConfig): ReadableStream<Uint8Array>;
```

`agent/route.ts:64-102`를 바탕으로 하되 아래를 지켜라.

- `config.apiKey`가 빈 문자열이거나 공백뿐이면 **스트림을 열자마자 `controller.error()`로 끝낸다.**
  호출자(step 7의 라우트)가 키 유무를 먼저 판단해 폴백으로 보내므로 정상 경로에서는 오지
  않지만, 계약을 코드로 못박아 둔다
- `new Anthropic({ apiKey: config.apiKey })`
- `client.beta.messages.toolRunner({ model, max_tokens, max_iterations, system, messages, tools, stream: true })`
- `config.tools.map(betaZodTool)`로 SDK 형식에 어댑트한다
- `messages`는 `normalizeHistory(config.history)`의 결과를 쓴다. **정규화를 건너뛰지 마라** —
  저장소에서 온 이력이 상한을 넘을 수 있다
- 바깥 루프는 iteration(스트림), 안쪽 루프는 이벤트다. 안쪽에서
  `event.type === "content_block_delta"`이고 `event.delta.type === "text_delta"`일 때만
  `event.delta.text`를 enqueue한다
- iteration마다 `await stream.finalMessage()`로 `stop_reason`을 받아 **마지막 값을 기억한다**
- 루프가 끝난 뒤:
  - 텍스트를 한 글자도 내보내지 않았으면 `EMPTY_ANSWER_NOTICE`를 enqueue한다
  - 마지막 `stop_reason`이 `"max_tokens"`면 `TRUNCATED_ANSWER_NOTICE`를 덧붙여 enqueue한다
- 에러는 `controller.error(error)`로 넘긴다. 헤더가 이미 나갔으므로 상태 코드를 바꿀 수 없다
- 마지막에 `controller.close()`

SDK 타입을 직접 정의하지 마라. `Anthropic.Beta.BetaMessageParam` 등 SDK가 export하는 타입을 쓴다.

### `src/chatbot/core/engine.test.ts` (먼저)

이 저장소는 **Anthropic SDK를 목킹하지 않는다.** 그래서 이 파일의 자동 커버리지는 구조적으로
얕다. 다음까지만 확인하고, 실제 모델 동작은 사람이 `live-ai-check` 절차로 본다.

- `apiKey`가 `""`일 때 스트림을 읽으면 reject된다
- `apiKey`가 공백뿐일 때도 같다
- 반환값이 `ReadableStream`이다

`vi.mock("@anthropic-ai/sdk")`를 쓰지 마라. 저장소 전체에 0건이고 그것이 방침이다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `await runner`로 툴 루프 전체를 기다리는 코드가 없는가?
   - `stop_reason`을 `finalMessage()`를 거쳐 읽는가?
   - `normalizeHistory`를 실제로 호출하는가?
   - `no-domain-imports.test.ts`가 이 파일도 검사해 통과하는가?
   - `vi.mock("@anthropic-ai/sdk")`가 없는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **`createChatStream`의 시그니처와 스트리밍 루프의 형태**(바깥=iteration,
안쪽=이벤트), 그리고 `apiKey`가 비었을 때의 동작을 적어라. step 7이 이 계약대로 부른다.

## 금지사항

- `await runner`로 툴 루프가 끝나기를 기다린 뒤 한 번에 enqueue하지 마라. 이유: 그것이 지금 `agent/route.ts:87-95`의 문제이고 이 step이 고치려는 대상이다. 대화형 UI에서는 첫 글자까지의 지연이 그대로 드러난다.
- 스트림 객체에서 `stop_reason`을 직접 읽으려 하지 마라. 이유: `stream: true`에서 바깥 루프가 내놓는 것은 메시지가 아니라 스트림이다. 항상 `undefined`가 나오고, 잘린 답에 고지가 붙지 않는다.
- `vi.mock("@anthropic-ai/sdk")`를 쓰지 마라. 이유: 이 저장소는 SDK를 목킹하지 않는 것이 방침이고 그 사실이 문서에 기록돼 있다. 목킹으로 만든 커버리지는 SDK가 바뀌어도 통과한다.
- `src/chatbot/core/`에서 `@/`나 `../`로 시작하는 것을 import하지 마라. 이유: 아키텍처 테스트가 즉시 실패한다. 이 디렉터리는 폴더 복사만으로 이식되는 단위다.
- 서버 툴(`web_search` 등)을 툴 목록에 섞지 마라. 이유: `pause_turn` 처리가 필요해지는데 이 엔진에는 그 분기가 없다. 긴 턴이 조용히 잘린 답으로 끝난다.
- SSE(`text/event-stream`)를 쓰지 마라. 이유: `docs/PRD.md`의 "3대 함정"이 배제한다. 기존 AI 라우트 셋 모두 순수 `text/plain` 바이트 스트림이고 클라이언트도 그것을 전제로 쓰여 있다.
- 마크다운 생성을 전제하지 마라. 이유: 답변은 `whitespace-pre-wrap` plain text로 렌더된다.
- step 1이 만든 파일을 고치지 마라. 이유: 그 계약 위에 step 5~8이 쌓인다. 부족한 것이 있으면 이 step에서 새 파일로 만들고 `summary`에 적어라.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
