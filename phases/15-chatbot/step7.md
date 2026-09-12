# Step 7: chat-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "AI 엔드포인트" 절. **레이트리밋 값이 라우트마다 다르다는 서술**이 이 step의 계약이다
- `/docs/ADR.md` — ADR-008의 "무인증 공개 라우트에 Opus 5를 건다" 트레이드오프
- `/src/app/api/admin/agent/route.ts` — **전문.** 이 step이 만들 라우트의 원형이다. 레이트리밋 → 바디 파싱 → 키 분기 → 스트림 순서, `responseHeaders` 상수, `getClientIp`, `createTextStream`
- `/src/app/api/reservations/route.ts:60-75` — `getUserIdFromRequest` 사용과 401 처리
- `/src/app/api/reservations/[id]/route.ts:5-8` — `sanitizeReservation()`. `userId`를 지우는 형태
- `/src/app/api/reservations/[id]/route.ts:12-35` — 동적 세그먼트의 `params: Promise<...>` 타입과 `NOT_FOUND:`/`FORBIDDEN:` prefix를 상태 코드로 옮기는 형태
- `/src/lib/cookie.ts:1-19` — `USER_ID_COOKIE_NAME`, `getUserIdFromRequest`. **`userId`의 유일한 출처다**
- `/src/lib/rate-limit.ts` — `createRateLimiter({ windowMs, maxRequests })`
- `/src/lib/basic-auth.ts:90` — `isProtectedPath`. `/api/admin/*`가 Basic 게이트 뒤라는 사실
- `/src/chatbot/core/engine.ts`, `/src/chatbot/core/fallback.ts` — **step 1~2에서 생성됨**
- `/src/services/conversation-store.ts`, `/src/services/index.ts` — **step 3~4에서 생성됨.** `getConversationStore()`
- `/src/chatbot/adapters/ticket/prompt.ts`, `/src/chatbot/adapters/ticket/tools.ts` — **step 5~6에서 생성됨**
- `/src/app/api/admin/agent/route.test.ts:31-50,112-124` — 라우트 테스트 골격. **IP를 매 테스트 `crypto.randomUUID()`로 유니크하게** 만드는 이유가 거기 있다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 1~6이 엔진·저장소·툴을 만들었다. 아직 부르는 곳이 없다. 이 step이 HTTP 표면을 붙인다.

라우트는 **`/api/chat` 아래여야 한다.** `/api/admin/` 아래에 두면 `basic-auth.ts:90`의
`isProtectedPath`에 걸려 미들웨어가 Basic 인증을 요구하고, 익명 관람객은 챗봇을 쓰지 못한다.
그 예외는 `docs/ARCHITECTURE.md`와 `AI_OPERATIONS_EXPANSION_PLAN.md`에 이미 기록돼 있다.

엔드포인트가 둘인 이유는 phase 16 때문이다. 손님이 보낸 질문에는 AI가 스트림으로 답하지만,
슬랙 상담원의 답장은 브라우저의 요청과 무관하게 나중에 도착한다. **보내는 경로와 받아 가는
경로가 분리**되어야 한다.

그래서 GET 응답은 `awaitingOperator`라는 **불리언 하나**로 대기 여부를 알린다.
`escalation` 객체를 통째로 내보내지 않는 이유가 둘이다 — `slackThreadTs`가 새어 나가면
안 되고, 클라이언트가 판정 로직을 가지면 `src/chatbot/ui/`가 `core/`를 import해야 해서
이식 단위가 깨진다. phase 15에서는 항상 `false`다.

라우트 파일은 TDD 가드 대상이다. **라우트가 둘이므로 테스트 파일도 둘이다.**

## 작업

### `src/app/api/chat/route.ts` — 질문 전송

```ts
export async function POST(request: Request): Promise<Response>;
```

처리 순서를 `agent/route.ts:104-139`와 같게 유지한다.

1. **IP 레이트리밋** — `createRateLimiter({ windowMs: 60_000, maxRequests: 10 })`.
   기존 AI 라우트의 3회는 버튼 한 번에 질문 하나인 패널 기준이다. 대화는 턴이 빠르게
   쌓이므로 3회로는 정상 사용이 막힌다. 초과 시 429 + `Retry-After`(초 단위)
2. **바디 파싱** — zod. `{ conversationId?: string, message: string }`.
   `message`는 `trim().min(1).max(CHAT_MESSAGE_LIMIT)`, `conversationId`는
   `/^[A-Za-z0-9_-]+$/`. 실패하면 400
3. **`userId`** — `getUserIdFromRequest(request)`. 없으면 401. **바디나 쿼리에서 받지 마라**
4. **`userId` 레이트리밋** — IP와 **별도 리미터**로 같은 창·같은 횟수를 건다. IP만 걸면
   같은 사람이 IP를 바꿔가며 새 대화를 계속 만들 수 있고, phase 16에서 그 경로가
   슬랙 도배가 된다. 지금 축을 하나 더 두면 그때 상한이 이미 서 있다
5. **대화 확보** — `conversationId`가 있으면 `get(conversationId, userId)`,
   없으면 `create(userId)`. `NOT_FOUND:`는 404, `FORBIDDEN:`는 403
6. **손님 턴 저장** — `appendTurns(id, userId, [{ role: "user", content: message }])`
7. **키 분기** — `process.env.ANTHROPIC_API_KEY`가 없으면 500이 아니라
   **200 + 폴백 스트림**이다. `buildTicketChatFallback()` 문구를 `notice` 턴으로 저장하고
   `createTextStream()`으로 내려보낸다. 기존 세 라우트가 모두 이 정책이다
8. **스트림** — `createChatStream({ apiKey, model: CHAT_MODEL, maxTokens: CHAT_MAX_TOKENS,
   maxIterations: CHAT_MAX_ITERATIONS, systemPrompt: buildTicketChatSystemPrompt(),
   tools: createTicketChatTools({ ...stores, userId }), history })`

**`history`는 6번이 돌려준 대화에서 뽑는다.** `appendTurns`의 **반환값**을 쓰라는 뜻이다.
저장 전 대화에서 뽑으면 방금 받은 질문이 통째로 빠져 모델이 엉뚱한 답을 한다.
`role`이 `"user"`/`"assistant"`인 턴만 골라 `ChatHistoryTurn[]`으로 옮긴다 —
`operator`·`notice` 턴은 모델에 보내지 않는다.

**응답 헤더**는 기존 세 라우트와 같다.

```ts
{ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" }
```

여기에 `X-Conversation-Id: <id>`를 더한다. 본문이 plain text 스트림이라 JSON으로 id를 줄
자리가 없고, 클라이언트는 이 값으로 폴링 대상을 안다. **본문 앞뒤에 id나 메타데이터를
섞지 마라** — 본문은 그대로 화면에 렌더되는 답변 텍스트다.

**답변 저장**: 엔진이 내놓는 스트림을 `TransformStream`으로 통과시키며 텍스트를 모으고,
`flush`에서 `appendTurns(id, userId, [{ role: "assistant", content: 모은 텍스트 }])`를 부른다.
손님이 중간에 창을 닫으면 `flush`가 돌지 않아 답변 턴이 저장되지 않을 수 있다. **허용한다** —
그 경우 다음 질문 때 이력이 `user` 두 개로 이어지는데, Messages API가 같은 역할의 연속
메시지를 하나로 합치므로 동작에 문제가 없다. 이 판단을 코드 주석으로 남겨라.

### `src/app/api/chat/[conversationId]/route.ts` — 폴링

```ts
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response>;
```

- `export const dynamic = "force-dynamic"`을 **반드시 넣어라.** 없으면 응답이 캐시돼
  상담원이 답해도 손님 화면이 바뀌지 않는다. 좌석 페이지가 같은 이유로 같은 설정을 갖는다
- `userId`는 쿠키에서. 없으면 401
- `getConversationStore().get(conversationId, userId)` — `NOT_FOUND:` 404, `FORBIDDEN:` 403
- 레이트리밋은 IP 기준 `{ windowMs: 60_000, maxRequests: 60 }`. 3초 폴링은 분당 20회이므로
  정상 사용을 막지 않으면서 폭주는 잡는다
- 응답은 JSON

```ts
{
  conversation: { id: string; turns: ChatTurn[]; updatedAt: number },
  awaitingOperator: boolean,
}
```

**`userId`를 절대 싣지 마라.** `sanitizeReservation`(`reservations/[id]/route.ts:5-8`)과
같은 형태의 제거 함수를 만들어 쓴다. **`escalation` 객체도 싣지 마라** — 대신
`awaitingOperator` 불리언 하나를 계산해 넣는다. phase 15에서는 `conversation.escalation`이
항상 `null`이므로 언제나 `false`다. phase 16이 이 값을 실제로 계산한다.

### 테스트

`agent/route.test.ts`의 골격을 따른다. `POST`/`GET`을 직접 import해 `new Request(...)`로 부른다.
**라우트가 둘이므로 `route.test.ts`도 둘이다** — 각 라우트 파일 옆에 하나씩.

- **IP는 매 테스트 `crypto.randomUUID()`로 유니크하게** 만들어라. 레이트리미터가 모듈
  스코프라 테스트 사이에 상태가 누적된다. `userId`도 마찬가지다
- 쿠키는 `new Request(url, { headers: { cookie: "userId=..." } })`로 만든다
- `delete process.env.ANTHROPIC_API_KEY`로 **폴백 경로만** 검증한다. SDK를 목킹하지 마라
- 최소 확인 항목: 쿠키 없으면 401, 바디가 잘못되면 400, 남의 `conversationId`면 403,
  없는 id면 404, 레이트리밋 초과 시 429 + `Retry-After`, 성공 시 `X-Conversation-Id` 헤더,
  GET 응답 JSON에 `userId`와 `escalation`이 **없음**, `awaitingOperator`가 `false`
- **위조 `userId` 테스트를 넣어라** — 바디에 `userId`를 실어 보내도 쿠키 값이 이긴다는 것을
  고정한다. `agent/route.test.ts:65-95`의 위조 메트릭 테스트와 같은 취지다

## Acceptance Criteria

```bash
npm run test && npm run lint
npm run build
```

`npm run build`를 포함하는 이유는 이 step이 새 라우트 세그먼트를 추가하기 때문이다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트가 `/api/chat` 아래인가? `/api/admin/` 아래가 아닌가?
   - `userId`를 바디·쿼리에서 읽는 코드가 한 줄도 없는가?
   - GET 응답에 `userId`와 `escalation`이 없는가? `awaitingOperator`만 있는가?
   - `history`를 `appendTurns`의 **반환값**에서 뽑는가?
   - GET 라우트에 `export const dynamic = "force-dynamic"`이 있는가?
   - `ANTHROPIC_API_KEY`가 없을 때 500이 아니라 200 + 폴백인가?
   - 응답이 `text/plain` 스트림인가? SSE가 아닌가?
   - 두 라우트 각각에 테스트 파일이 있는가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **두 라우트의 경로, 요청·응답 형태(GET의 JSON 키 이름 포함), 레이트리밋 값,
`X-Conversation-Id` 헤더**를 적어라. step 8의 훅이 이 계약에 맞춰 쓰이고, phase 16이
GET 라우트에 판정을 더한다.

## 금지사항

- 라우트를 `/api/admin/` 아래에 두지 마라. 이유: `isProtectedPath`가 그 경로를 Basic 게이트 뒤로 보낸다. 익명 관람객이 챗봇을 아예 쓸 수 없게 된다.
- `userId`를 요청 바디나 쿼리스트링에서 받지 마라. 이유: CRITICAL 규칙이다. 남의 `conversationId`와 남의 `userId`를 함께 보내면 그 대화가 그대로 열린다(IDOR). 출처는 HTTP-only 쿠키 하나뿐이다.
- 응답에 `userId`를 싣지 마라. 이유: CRITICAL 규칙이다. 대화에는 그 사람의 예매 내역이 답변으로 들어 있다.
- GET 응답에 `escalation` 객체를 싣지 마라. 이유: `slackThreadTs`가 들어 있다. 그 값을 알면 phase 16의 답장 경로에 위조 요청을 넣을 때 필요한 절반을 얻는다. 클라이언트에 필요한 것은 대기 여부 불리언 하나뿐이다.
- `history`를 저장 전 대화에서 뽑지 마라. 이유: 방금 받은 질문이 통째로 빠진다. 모델이 앞 대화만 보고 답해 손님은 자기 질문이 무시됐다고 느낀다.
- `operator`·`notice` 턴을 모델 이력에 넣지 마라. 이유: `ChatHistoryTurn`은 `user`/`assistant`만 표현한다. 상담원 답장을 이력에 넣으면 모델이 그것을 자기 말로 착각한다.
- GET 라우트에서 `export const dynamic = "force-dynamic"`을 빼지 마라. 이유: 응답이 캐시되면 상담원이 답해도 손님 화면이 바뀌지 않는다.
- `ANTHROPIC_API_KEY`가 없을 때 500을 내지 마라. 이유: 기존 세 AI 라우트가 모두 200 + 폴백이다. 키 없는 환경에서도 화면이 살아 있어야 심사자가 볼 수 있다.
- SSE(`text/event-stream`)나 WebSocket을 쓰지 마라. 이유: `docs/PRD.md`의 "3대 함정"이 배제한다. 상담원 답장은 phase 16에서 3초 폴링으로 받는다.
- 답변 본문 앞뒤에 `conversationId`나 JSON 메타데이터를 섞지 마라. 이유: 본문은 그대로 화면에 렌더되는 답변 텍스트다. 메타데이터는 `X-Conversation-Id` 헤더로 보낸다.
- 레이트리밋을 GET에 3회/분으로 걸지 마라. 이유: 3초 폴링은 분당 20회다. 정상 사용이 즉시 429에 걸린다.
- `vi.mock("@anthropic-ai/sdk")`를 쓰지 마라. 이유: 이 저장소는 SDK를 목킹하지 않는다. 라우트 테스트는 키를 지워 폴백 경로만 본다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
