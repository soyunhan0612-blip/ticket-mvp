# Step 4: escalation-wiring

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "관람객 챗봇(phase 15~16)의 예외" 절 **1번**. 부작용 툴을 허용하는 조건 셋이 거기 있다
- `/docs/ADR.md` — ADR-008의 "슬랙 전송만 부작용으로 허용한 이유"
- `/phases/15-chatbot/index.json` — phase 15 각 step의 `summary`. `read-only.test.ts`의 검사 대상 배열 상수 이름이 step 6의 `summary`에 있다
- `/src/chatbot/core/escalation.ts` — **step 2에서 생성됨.** `shouldSendAutoReply`, `isAwaitingOperator`, `AUTO_REPLY_TEXT`
- `/src/services/conversation-store.ts` — **step 3에서 확장됨.** `startEscalation`, `markAutoReplySent`
- `/src/lib/slack-client.ts` — **step 1에서 생성됨.** `postSlackMessage`, `hasSlackConfig`
- `/src/chatbot/adapters/ticket/tools.ts` — **phase 15 step 6에서 생성됨.** 툴 작성 형태와 `deps` 주입
- `/src/chatbot/adapters/ticket/__tests__/read-only.test.ts` — **phase 15 step 6에서 생성됨.** 이 step이 검사 범위를 조정한다
- `/src/chatbot/adapters/ticket/prompt.ts` — **phase 15 step 5에서 생성됨.** 시스템 프롬프트 조립
- `/src/chatbot/core/sanitize.ts` — **phase 15 step 1에서 생성됨.** `wrapUserInput()`
- `/src/app/api/chat/route.ts`, `/src/app/api/chat/[conversationId]/route.ts` — **phase 15 step 7에서 생성됨.** 이 step이 두 라우트를 모두 고친다
- `/src/lib/rate-limit.ts` — `createRateLimiter({ windowMs, maxRequests })`
- `/src/lib/ops-agent-tools.ts:43-89` — 툴이 실패를 데이터로 돌려주는 형태
- `/src/lib/sellout-alert.ts:1,19` — 외부 채널로 나가는 문자열을 중화하는 선례

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 1~3이 부품을 만들었다. 슬랙으로 보낼 수 있고, 대기 상태를 저장할 수 있고, 1분 경과를
판정할 수 있다. **아직 아무도 부르지 않는다.** 이 step이 연결한다.

**나가는 쪽** — AI가 못 답하는 질문을 만나면 스스로 `escalate_to_human` 툴을 부른다.
판단 주체는 모델이다.

여기서 조회 전용 원칙이 한 칸 넓어진다. 이 툴은 부작용이 있다 — 슬랙에 글이 하나 올라간다.
가드레일 문서가 그 예외를 이미 기록했고 조건 셋을 달았다. 그중 둘이 이 step의 작업이다.
조회 툴과 **다른 파일**에 둘 것, 그 파일도 쓰기 API 미참조 검사를 따로 받을 것.

조회 전용 아키텍처 테스트도 조정이 필요하다. phase 15 step 6이 만든 `read-only.test.ts`는
검사 대상을 배열 상수로 갖고 있다. 새 툴 파일을 그 배열에 넣으면 테스트가 깨진다.
**테스트를 지우지 말고, 예외를 하나 만들되 그 예외가 무엇을 만지는지 따로 고정하라.**

**들어오는 쪽** — 폴링이 들어올 때 1분 경과를 판정해 안내 턴을 넣는다.

**도배 방지 한 가지가 더 필요하다.** step 3의 `ESCALATION_IN_PROGRESS`는 **같은 대화**만
막는다. `conversationId` 없이 POST를 반복하면 새 대화가 계속 생기므로 한 사람이 슬랙에
여러 건을 밀어 넣을 수 있다. `userId` 단위 창 제한을 이 step에서 건다.

`src/chatbot/adapters/`와 `src/app/api/**/route.ts`는 둘 다 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/chatbot/adapters/ticket/escalation-tool.ts`

**새 파일로 만든다.** `tools.ts`에 넣지 마라 — 그 파일이 무부작용이라는 것을 테스트가
고정하고 있고, 그 성질을 유지하는 편이 낫다.

```ts
export interface EscalationToolDeps {
  conversationId: string;
  userId: string;
  conversationStore: Pick<ConversationStore, "get" | "startEscalation">;
  postMessage: (text: string) => Promise<{ ts: string }>;
  canEscalateNow: () => boolean;
  now: () => number;
}

export function createEscalationTool(deps: EscalationToolDeps): ChatToolDescriptor;
```

툴 이름은 `escalate_to_human`, 입력은 `z.object({ summary: z.string().min(1).max(N) })`.
`description`에 **언제 쓰는지**를 적어라 — 주어진 툴로 조회할 수 없는 문의(결제 오류,
계정 문제, 현장 안내 등)일 때만 쓰고, 공연·회차·예매·환불 규정 질문에는 쓰지 말라고 명시한다.

`run`의 순서:

1. `deps.canEscalateNow()`가 `false`면 슬랙에 보내지 말고
   `{ escalated: false, reason: "rate_limited" }`를 돌려준다
2. `conversationStore.get(conversationId, userId)`로 현재 상태를 읽는다.
   `isAwaitingOperator(...)`가 `true`면 `{ escalated: false, reason: "already_waiting" }`
3. 슬랙 메시지 본문을 만든다. `summary`는 **반드시 `wrapUserInput()`으로 감싼다** —
   모델이 손님 말을 옮겨 적은 값이라 신뢰 입력이 아니다. 본문에 `conversationId`와
   **"이 메시지에 스레드로 답장하면 손님 화면에 전달됩니다"**를 적어라. 상담원이 스레드를
   쓰지 않으면 답장이 연결되지 않는다
4. `deps.postMessage(text)` → `ts`
5. `conversationStore.startEscalation(conversationId, userId, ts, deps.now())`
6. `{ escalated: true }`

**어느 단계에서 실패해도 throw하지 마라.** `get`은 `NOT_FOUND:`/`FORBIDDEN:`을 throw할 수
있고 슬랙도 던진다. `try`/`catch`로 감싸 `{ escalated: false, reason: "unavailable" }`을
돌려주고 모델이 손님에게 설명하게 한다. 툴이 throw하면 툴 루프가 끊겨 손님이 빈 답을 본다.

**`userId`를 슬랙 메시지에 넣지 마라.** 상담원이 알아야 할 것은 문의 내용과 스레드뿐이다.

### `src/chatbot/adapters/ticket/prompt.ts` 수정

```ts
export function buildTicketChatSystemPrompt(options: { canEscalate: boolean }): string;
```

`canEscalate`가 `true`면 "조회로 답할 수 없는 문의는 `escalate_to_human`으로 상담원에게
넘긴다"는 문장을 더한다. `false`면 그 문장 대신 "상담원 연결은 현재 제공되지 않는다"를 넣어라.
슬랙 설정이 없는 환경에서 모델이 있지도 않은 툴을 약속하면 안 된다.

기존 호출자(phase 15 step 7의 POST 라우트)를 함께 고쳐라.

### `src/chatbot/adapters/ticket/__tests__/read-only.test.ts` 수정

- 검사 대상 배열에서 `escalation-tool.ts`를 **명시적으로 제외**하고, 왜 제외하는지 주석으로
  남긴다. 배열에 넣지 않으면 자동으로 빠지지만, **왜 빠졌는지가 코드에 없으면** 다음 사람이
  실수로 넣거나 다른 부작용 파일을 같은 자리에 추가한다
- `escalation-tool.ts` 전용 검사를 하나 더 만든다. 그 파일에
  `hold`·`confirmSeats`·`releaseSold`·`revertSold`·`cancel`·`getSeatStore`·`getShowStore`·
  `getReservationStore`가 **없음**을 확인한다. 허용되는 부작용은 슬랙 전송과
  `startEscalation` 둘뿐이다

### `src/app/api/chat/route.ts` 수정

- `hasSlackConfig()`가 `true`일 때만 툴 목록에 `createEscalationTool(...)`을 더한다
- `buildTicketChatSystemPrompt({ canEscalate: hasSlackConfig() })`
- `postMessage`에는 `postSlackMessage`를 감싼 함수를 넘긴다. 채널은 환경변수에서 읽으므로
  어댑터가 알 필요가 없다
- `canEscalateNow`에는 **`userId` 기준 에스컬레이션 리미터**를 넘긴다.
  `createRateLimiter({ windowMs: 60 * 60_000, maxRequests: 3 })` 정도로, 한 사람이 한 시간에
  슬랙에 올릴 수 있는 건수를 묶는다. 기존 요청 리미터와 **별개 인스턴스**여야 한다 —
  질문은 많이 해도 되지만 사람 호출은 드물어야 한다
- 그 외 처리 순서는 phase 15 step 7에서 바꾸지 마라

### `src/app/api/chat/[conversationId]/route.ts` 수정

대화를 읽은 뒤, 응답을 만들기 **전에** 자동 응답을 판정한다.

1. `conversation.escalation`에서 `askedAt`·`autoReplySentAt`·`answeredAt` 셋을 뽑아
   `EscalationSnapshot`을 만든다. `core/escalation.ts`는 `slackThreadTs`를 모른다
2. `shouldSendAutoReply(snapshot, Date.now())`가 `false`면 그대로 응답한다
3. `true`면 `markAutoReplySent(conversationId, userId, now)`를 부른다
4. **반환값이 `true`일 때만** `appendTurns(..., [{ role: "notice", content: AUTO_REPLY_TEXT }])`를
   부른다. `false`는 다른 폴링이 이미 이겼다는 뜻이다
5. 갱신된 대화로 응답한다
6. 응답의 `awaitingOperator`는 `isAwaitingOperator(snapshot)`로 계산한다.
   **`escalation` 객체 자체는 여전히 싣지 마라**

3번과 4번 사이에 인스턴스가 죽으면 그 대화는 안내 턴 없이 `autoReplySentAt`만 세워진다.
드물고 피해가 작으므로 **감수한다.** 코드 주석으로 남겨라.

### 테스트

- `escalation-tool.test.ts` — `postMessage`와 store를 가짜로 주입한다. 이미 대기 중이면
  `postMessage`가 **호출되지 않는지**, `canEscalateNow`가 `false`면 호출되지 않는지,
  슬랙이 throw하면 툴이 throw하지 않고 `unavailable`을 돌려주는지, `summary`가 중화되어
  본문에 들어가는지, 본문에 `userId`가 없는지, 본문에 스레드 답장 안내가 있는지
- POST `route.test.ts` — 슬랙 환경변수가 없을 때 툴 목록에 에스컬레이션 툴이 없고
  시스템 프롬프트가 "제공되지 않는다" 쪽인지
- GET `route.test.ts` — `escalation`을 대기 상태로 만들어 두고 1분 뒤 폴링에 `notice` 턴이
  **한 번만** 생기는지. 두 번 연속 폴링해도 턴이 하나여야 한다. 응답의 `awaitingOperator`가
  `true`인지. 시간은 저장된 `askedAt`을 과거로 두어 결정적으로 만든다

## Acceptance Criteria

```bash
npm run test && npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `tools.ts`는 여전히 부작용이 없는가? 기존 조회 전용 테스트가 그대로 도는가?
   - `escalation-tool.ts`에 좌석·예약 쓰기 식별자가 없는가?
   - 슬랙 메시지 본문에 `userId`가 없는가? `summary`가 `wrapUserInput()`을 거치는가?
   - 툴이 어떤 실패에서도 throw하지 않는가?
   - 자동 안내가 연속 폴링에서 한 번만 생기는가?
   - GET 응답에 `escalation` 객체가 없고 `awaitingOperator`만 있는가?
   - `userId` 기준 에스컬레이션 리미터가 요청 리미터와 별개 인스턴스인가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **툴 이름과 입력 스키마, 슬랙 메시지 본문의 구성, 에스컬레이션 리미터 값**을
적어라. step 5가 같은 스레드로 들어오는 답장을 받는다.

## 금지사항

- 에스컬레이션 툴을 `tools.ts`에 넣지 마라. 이유: 그 파일이 부작용을 갖지 않는다는 것이 테스트로 고정돼 있다. 한 파일에 섞으면 조회 전용 검사를 통째로 느슨하게 만들어야 하고, 그 순간 좌석 쓰기가 들어와도 아무도 막지 못한다.
- 좌석·예약을 바꾸는 툴을 추가하지 마라. 이유: ADR-007이 조회 전용으로 못박았다. 슬랙 전송이 허용되는 이유는 좌석 상태 전이에 개입하지 않기 때문이지, 쓰기 일반이 열린 것이 아니다.
- 툴 안에서 throw하지 마라. 이유: 툴 루프가 끊겨 손님이 빈 답을 본다. `conversationStore.get`은 throw할 수 있는 메서드이므로 반드시 감싸라.
- `summary`를 중화 없이 슬랙에 보내지 마라. 이유: 모델이 손님 말을 옮겨 적은 값이다. 구분자나 개행을 심어 메시지 형식을 위조할 수 있다. `sellout-alert.ts`가 같은 이유로 외부로 나가는 문자열을 중화한다.
- 슬랙 메시지에 `userId`를 넣지 마라. 이유: 응답에 남의 `userId`를 싣지 않는 것이 CRITICAL 규칙이고, 슬랙 채널도 저장소 밖의 노출 지점이다.
- `markAutoReplySent`의 반환값을 무시하고 안내 턴을 추가하지 마라. 이유: 그 반환값이 동시 폴링 경합의 승자를 가린다. 무시하면 탭 두 개에서 안내가 두 번 뜬다.
- `userId` 단위 에스컬레이션 제한을 빼지 마라. 이유: `ESCALATION_IN_PROGRESS`는 같은 대화만 막는다. `conversationId` 없이 POST를 반복하면 새 대화가 계속 생겨 한 사람이 슬랙을 도배할 수 있다.
- 슬랙 설정이 없는데 시스템 프롬프트가 상담원 연결을 약속하게 하지 마라. 이유: 모델이 있지도 않은 툴을 부르려 하거나 손님에게 지키지 못할 약속을 한다.
- GET 응답에 `escalation` 객체를 싣지 마라. 이유: `slackThreadTs`가 들어 있다. 그 값을 알면 step 5의 콜백에 위조 답장을 넣을 때 필요한 절반을 얻는다.
- phase 15 step 7이 정한 POST 처리 순서를 바꾸지 마라. 이유: 레이트리밋을 바디 파싱보다 먼저 두는 것 등은 의도된 순서다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
