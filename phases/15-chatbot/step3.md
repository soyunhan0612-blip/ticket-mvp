# Step 3: conversation-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — ADR-008의 "대화 저장소를 신설한 이유". 이것이 금지된 새 `*Service` 계층이 아닌 근거
- `/docs/ARCHITECTURE.md` — Store 인터페이스와 "보안 경계" 절
- `/src/types/index.ts` — **도메인 타입이 전부 이 한 파일에 있다.** 여기에 더한다
- `/src/services/reservation-store.ts` — 인터페이스 파일의 크기와 모양. 7줄짜리다
- `/src/services/reservation-store.test.ts` — **7줄짜리 인터페이스 파일에도 테스트가 있다.** 그 형태를 보라
- `/src/services/reservation-store-memory.ts:42-58` — 소유권 검증과 `NOT_FOUND:`/`FORBIDDEN:` 에러 prefix 규약
- `/src/services/reservation-store-memory.ts:6-11,62-65` — `globalThis` 싱글톤으로 HMR을 견디는 패턴
- `/src/lib/hold.ts` — 만료를 타이머가 아니라 **시각 비교**로 다루는 이 저장소의 방식
- `/src/chatbot/core/history.ts` — **step 1에서 생성됨.** `MAX_HISTORY_TURNS`. 여기서 정할 턴 상한과 관계가 있다
- `/vitest.setup.ts:8-9` — Upstash 환경변수를 지우므로 테스트는 기본이 메모리 스토어다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

지금까지 이 저장소의 AI 라우트는 상태가 없었다. 질문이 오면 답하고 끝이다.

챗봇은 다르다. phase 16에서 **슬랙 상담원이 답장하면 그 답이 손님 화면에 떠야 한다.**
답장은 브라우저가 아니라 슬랙에서 들어오므로, 두 경로가 만날 장소가 서버에 있어야 한다.

phase 16이 아니라 지금 만드는 이유는 되돌아와 고치는 일을 피하기 위해서다. 이력을 브라우저가
들고 있게 설계했다가 나중에 서버로 옮기면 라우트·훅·타입을 전부 다시 만진다.

이 step에서 `escalation` 필드는 **자리만 만들고 항상 `null`이다.** 채우는 것은 phase 16이다.

이 step은 **타입·인터페이스·메모리 구현**까지다. Redis 구현은 step 4다 — 원자적 Lua와 가짜
클라이언트 테스트가 따로 한 덩어리이기 때문이다.

`src/services/`는 TDD 가드 대상이다. **인터페이스 파일도 예외가 아니다** —
`conversation-store.ts`를 만들려면 `conversation-store.test.ts`가 먼저 있어야 한다.
`reservation-store.ts`(7줄)에도 테스트가 있는 것이 그 선례다.

## 작업

### `src/types/index.ts`에 추가

```ts
export type ChatTurnRole = "user" | "assistant" | "operator" | "notice";

export interface ChatTurn {
  id: string;
  role: ChatTurnRole;
  content: string;
  createdAt: number;
}

export interface ConversationEscalation {
  askedAt: number;
  slackThreadTs: string | null;
  autoReplySentAt: number | null;
  answeredAt: number | null;
}

export interface Conversation {
  id: string;
  userId: string;
  turns: ChatTurn[];
  escalation: ConversationEscalation | null;
  updatedAt: number;
}
```

`operator`는 슬랙에서 온 상담원 답, `notice`는 서버가 만든 안내 문구다. 둘 다 phase 16에서
쓰인다. 지금은 타입에만 존재한다.

### `src/services/conversation-store.ts`

```ts
import type { ChatTurnRole, Conversation } from "@/types";

export const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_TURNS_PER_CONVERSATION = 100;
export const MAX_TURN_CONTENT_LENGTH = 4_000;

export interface NewChatTurn {
  role: ChatTurnRole;
  content: string;
}

export interface ConversationStore {
  create(userId: string): Promise<Conversation>;
  get(conversationId: string, userId: string): Promise<Conversation>;
  appendTurns(
    conversationId: string,
    userId: string,
    turns: NewChatTurn[],
  ): Promise<Conversation>;
}
```

지켜야 할 규칙:

- `id`는 `crypto.randomUUID()`
- `get`과 `appendTurns`는 **소유권을 검증한다.** 없으면 `NOT_FOUND: conversation ...`,
  남의 것이면 `FORBIDDEN: conversation ...`을 throw한다. prefix 규약은
  `reservation-store-memory.ts:44-52`와 같다 — 라우트가 이 prefix로 상태 코드를 고른다
- `ChatTurn.id`와 `createdAt`은 **store가 매긴다.** 호출자가 준 값을 쓰지 마라
- **`content`를 `MAX_TURN_CONTENT_LENGTH`로 자른다.** phase 16에서 슬랙 상담원의 답장이
  이 경로로 들어오는데, 서명을 통과한 큰 본문이 그대로 저장되면 안 된다. 길이 제한을
  호출자마다 두면 하나를 빠뜨린다. 저장소가 지킨다
- 턴 수가 `MAX_TURNS_PER_CONVERSATION`을 넘으면 **오래된 것부터 버린다.** 모델에 실제로
  실리는 것은 `normalizeHistory`가 남기는 최근 `MAX_HISTORY_TURNS`개뿐이므로(step 1),
  그보다 오래된 턴을 버려도 답변 품질에 영향이 없다. 상한 없이 두면 한 대화가 무한히 자란다
- TTL은 `CONVERSATION_TTL_MS`. 마지막 `appendTurns` 시점부터 다시 센다

### `src/services/conversation-store-memory.ts`

```ts
export function createConversationStoreMemory(): ConversationStore;
```

`reservation-store-memory.ts`와 같은 `globalThis` 싱글톤 구조. `Map<string, Conversation>`.

TTL을 타이머로 만들지 마라. **읽을 때 만료된 것을 버리는 지연 정리**로 처리한다 —
서버리스에서 타이머는 신뢰할 수 없고, 이 저장소가 홀드 만료를 다루는 방식도 같다
(`src/lib/hold.ts`).

### 테스트 (먼저)

- `conversation-store.test.ts` — **인터페이스 파일의 가드를 여는 테스트다. 선택이 아니다.**
  `reservation-store.test.ts`가 어떤 형태인지 먼저 읽고 같은 수준으로 맞춰라. 상수 값
  (`CONVERSATION_TTL_MS`·`MAX_TURNS_PER_CONVERSATION`·`MAX_TURN_CONTENT_LENGTH`)과
  `MAX_TURNS_PER_CONVERSATION > MAX_HISTORY_TURNS` 관계를 고정한다
- `conversation-store-memory.test.ts` — 생성·조회·append, 남의 대화에 `FORBIDDEN`,
  없는 id에 `NOT_FOUND`, 턴 상한 초과 시 오래된 것부터 버려짐, `content`가 상한으로 잘림,
  TTL 경과 후 `NOT_FOUND`, `escalation`이 `null`로 생성됨

시간에 의존하는 테스트는 `vi.useFakeTimers()`로 결정적으로 만들어라. 실제 24시간을
기다리는 테스트를 쓰지 마라.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `get`과 `appendTurns`가 `userId`를 받아 소유권을 검증하는가?
   - `conversation-store.test.ts`가 실제로 존재하는가? (없으면 인터페이스 파일 편집이 막혔을 것이다)
   - `content` 길이 상한을 저장소가 강제하는가?
   - TTL을 `setTimeout` 없이 처리하는가?
   - `src/chatbot/` 아래를 수정하지 않았는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **인터페이스의 세 메서드 시그니처와 세 상수의 실제 값**을 적어라.
step 4가 같은 계약을 Redis로 구현하고, step 7이 라우트에서 부른다.

## 금지사항

- `userId`를 요청 바디나 쿼리스트링에서 받는 코드를 쓰지 마라. 이유: CRITICAL 규칙이다. `userId`는 HTTP-only 쿠키에서만 읽는다(`src/lib/cookie.ts`의 `getUserIdFromRequest`). 바디에서 받으면 남의 대화를 그대로 연다(IDOR).
- `get`이 남의 대화를 돌려주게 하지 마라. 이유: 대화에는 그 사람의 예매 내역이 답변으로 들어 있다. 소유권 검증이 유일한 방어선이다.
- `Conversation`을 그대로 API 응답에 싣는 코드를 만들지 마라. 이유: `userId` 필드가 들어 있다. 응답에 남의 `userId`를 싣지 않는 것이 CRITICAL 규칙이고, 제거는 step 7의 일이다.
- `content` 길이 제한을 호출자에게 맡기지 마라. 이유: phase 16에서 슬랙 콜백이 같은 경로로 쓴다. 호출자가 둘이 되는 순간 하나를 빠뜨린다.
- TTL을 `setTimeout`으로 구현하지 마라. 이유: 서버리스 인스턴스는 요청 사이에 죽는다. 타이머는 실행을 보장하지 않는다.
- `escalation` 필드를 채우는 로직을 만들지 마라. 이유: phase 16의 범위다. 지금 추측으로 만들면 슬랙 스레드 연결 설계와 어긋난다.
- Redis 구현을 만들지 마라. 이유: step 4의 범위다. 원자적 Lua와 가짜 클라이언트 테스트가 따로 한 덩어리이고, 함께 하면 이 step이 30분을 넘긴다.
- `conversation-store.test.ts`를 건너뛰지 마라. 이유: `src/services/` 아래 모든 소스가 TDD 가드 대상이다. 인터페이스 파일도 테스트가 없으면 생성 자체가 차단된다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
