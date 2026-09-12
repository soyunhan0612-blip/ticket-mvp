# Step 3: escalation-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — ADR-008의 "쿠키 검사 없이 대화에 쓰는 경로가 하나 생겼다" 트레이드오프
- `/phases/15-chatbot/index.json` — phase 15 각 step의 `summary`. **`execute.py`는 현재 phase의 index만 프롬프트에 싣는다.** Redis 키 이름과 Lua `operation` 마커 이름이 step 4의 `summary`에 적혀 있으니 직접 읽어라
- `/src/services/conversation-store.ts` — **phase 15 step 3에서 생성됨.** 인터페이스에 메서드를 더한다
- `/src/services/conversation-store-memory.ts` — **phase 15 step 3에서 생성됨**
- `/src/services/conversation-store-redis.ts` — **phase 15 step 4에서 생성됨.** 기존 키 구조와 Lua 형태
- `/src/services/conversation-store-redis.test.ts` — **phase 15 step 4에서 생성됨.** 가짜 Redis 클라이언트. 새 Lua마다 분기를 더해야 한다
- `/src/services/conversation-store-memory.test.ts` — **phase 15 step 3에서 생성됨.** 같은 시나리오를 두 구현에 돌리는 형태
- `/src/types/index.ts` — `ConversationEscalation`. **지금까지 항상 `null`이었다**
- `/src/chatbot/core/escalation.ts` — **step 2에서 생성됨.** `EscalationSnapshot`은 이 타입의 부분집합이다
- `/src/services/reservation-store-memory.ts:42-58` — `NOT_FOUND:`/`FORBIDDEN:` 에러 prefix 규약
- `/src/services/seat-store-redis.ts:16,65,87` — 여러 Lua 스크립트를 한 파일에 두는 형태와 `-- operation:` 마커

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 2가 판정 함수를 만들었다. 판정할 **상태**가 아직 저장되지 않는다. 이 step이 그것을 더한다.

세 가지를 저장소가 맡는다. 각각 함정이 하나씩 있다.

**하나. 대기 상태를 세운다.** 같은 대화가 슬랙에 여러 번 올라가면 안 된다. 프롬프트
인젝션이나 모델의 오작동으로 반복 호출이 일어날 수 있으므로 **저장소가 불변식을 지킨다.**

**둘. 자동 안내를 한 번만 보낸다.** 손님이 탭을 두 개 열어 두면 두 폴링이 거의 동시에
"보내야 한다"는 같은 판정을 받는다. "보냈다"는 표시를 세우는 연산이 **읽고 나서 쓰는 두
단계가 아니라 한 번에** 끝나야 한다.

**셋. 슬랙에서 온 답장을 붙인다.** 이것이 위험한 쪽이다. 슬랙은 쿠키를 갖고 있지 않으므로
이 메서드는 **이 저장소에서 유일하게 소유권 검사 없이 대화에 쓴다.** 열쇠는 `userId`가 아니라
슬랙 스레드 식별자다. 그 식별자를 아는 경로가 서명 검증을 통과한 콜백 하나뿐이어야 한다는
것이 이 설계 전체의 전제다(step 0이 그 검증을 만들었고, step 5가 호출자를 하나로 묶는다).

`src/services/`는 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/services/conversation-store.ts`에 메서드 추가

```ts
startEscalation(
  conversationId: string,
  userId: string,
  slackThreadTs: string,
  now: number,
): Promise<Conversation>;

markAutoReplySent(
  conversationId: string,
  userId: string,
  now: number,
): Promise<boolean>;

appendOperatorReply(
  slackThreadTs: string,
  content: string,
  eventId: string,
  now: number,
): Promise<Conversation | null>;
```

규칙:

- **`startEscalation`** — `escalation`이 이미 있고 `answeredAt`이 `null`이면
  `ESCALATION_IN_PROGRESS: conversation ...`을 throw한다. `slackThreadTs`를 스레드 인덱스에
  등록해 `appendOperatorReply`가 되찾을 수 있게 한다.
  `slackThreadTs`는 **형식을 검증하고 저장하라** — Redis 키의 일부가 되므로 `/^\d+\.\d+$/`
  같은 좁은 형태만 받는다. `docs/ARCHITECTURE.md`가 검증 없이 Redis 키에 값을 넣는 것을
  키 인젝션으로 경고한다
- **`markAutoReplySent`** — **compare-and-set이다.** `autoReplySentAt`이 `null`이고
  `answeredAt`도 `null`일 때만 값을 세우고 `true`를 반환한다. 그 외에는 아무것도 바꾸지 않고
  `false`다. 호출자는 `true`를 받았을 때만 안내 턴을 추가한다.
  **읽고 나서 쓰는 두 번의 호출로 구현하지 마라**
- **`appendOperatorReply`** — `userId`를 받지 않는다
  - `eventId`를 이미 처리했으면 아무것도 하지 않고 `null`을 반환한다(멱등).
    슬랙은 응답이 늦으면 같은 이벤트를 다시 보낸다
  - `slackThreadTs`로 대화를 찾지 못하면 `null`을 반환한다. **throw하지 마라** —
    호출자가 200을 돌려줘야 슬랙이 이벤트 구독을 끊지 않는다
  - 찾으면 `role: "operator"` 턴을 더하고, `answeredAt`이 `null`이면 `now`로 세운다
  - `content` 길이 상한은 phase 15 step 3의 `MAX_TURN_CONTENT_LENGTH`가 이미 강제한다.
    여기서 다시 자르지 마라
  - 처리한 `eventId`를 기록한다. 짧은 TTL(1시간 정도)이면 충분하다 — 슬랙의 재전송은
    기본 설정에서 그 안에 끝난다

두 구현(`-memory`, `-redis`)에 같은 계약을 넣는다. Redis 쪽은 phase 15 step 4와 같은 원칙이다.

- 조회·검사·쓰기·TTL 갱신이 **한 번의 `eval`** 안에서 끝나야 한다
- 새 Lua 스크립트마다 `-- operation: <kebab-name>` 마커를 넣는다
- 스레드 인덱스와 이벤트 기록의 키 이름이 phase 15 step 4의 키와 겹치지 않게 한다.
  기존 키 이름은 그 step의 `summary`에 있다

### 테스트 (먼저)

`conversation-store-memory.test.ts`와 `conversation-store-redis.test.ts` 양쪽에 **같은
시나리오**를 더한다.

- `startEscalation` 두 번 호출 시 두 번째가 `ESCALATION_IN_PROGRESS`로 throw
- `slackThreadTs`가 형식에 맞지 않으면 거부
- `markAutoReplySent`를 두 번 부르면 **첫 번째만 `true`**
- `answeredAt`이 세워진 뒤 `markAutoReplySent`가 `false`
- `appendOperatorReply`가 같은 `eventId`로 두 번 불려도 턴이 하나만 늘어남
- 모르는 `slackThreadTs`에 `null` 반환(throw 아님)
- `appendOperatorReply`가 `answeredAt`을 세움
- `appendOperatorReply` 후 `get`으로 읽으면 `operator` 턴이 보임

`-redis.test.ts`의 가짜 클라이언트에 새 `operation` 분기를 더한다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `markAutoReplySent`가 한 번의 원자적 연산인가?
   - `appendOperatorReply`가 `userId`를 받지 않는가?
   - `appendOperatorReply`가 모르는 스레드에 throw하지 않고 `null`을 주는가?
   - `slackThreadTs` 형식을 검증하고 Redis 키에 넣는가?
   - 새 Lua 스크립트에 `-- operation:` 마커가 있는가?
   - 두 구현이 같은 계약인가? 같은 시나리오가 양쪽에서 도는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **세 메서드의 시그니처, 새 Redis 키와 `operation` 마커 이름,
`slackThreadTs` 검증 정규식**을 적어라. step 4가 앞의 둘을, step 5가 마지막 하나를 부른다.

## 금지사항

- `markAutoReplySent`를 조회 후 갱신의 두 단계로 구현하지 마라. 이유: 손님이 탭을 두 개 열면 두 폴링이 같은 판정을 받아 안내가 두 번 뜬다. 한 번의 원자적 연산이어야 한다.
- `appendOperatorReply`에 `userId` 파라미터를 넣지 마라. 이유: 슬랙은 쿠키를 갖고 있지 않다. 이 메서드의 열쇠는 스레드 식별자이고, 그것을 아는 경로가 서명 검증을 통과한 콜백 하나뿐이라는 것이 이 설계의 전제다.
- `appendOperatorReply`가 모르는 스레드에 throw하게 하지 마라. 이유: 호출자가 500을 내면 슬랙이 재전송하고, 반복되면 이벤트 구독 자체를 끈다. 한 번 꺼지면 사람이 콘솔에서 다시 켜야 한다.
- `eventId` 중복 검사를 빼지 마라. 이유: 슬랙은 응답이 늦으면 같은 이벤트를 다시 보낸다. 검사가 없으면 상담원의 한 마디가 화면에 여러 번 뜬다.
- `startEscalation`이 이미 대기 중인 대화에서 성공하게 하지 마라. 이유: 프롬프트 인젝션이나 모델의 오작동으로 같은 대화가 슬랙에 반복 전송될 수 있다. 불변식을 저장소가 지켜야 한다.
- `slackThreadTs`를 검증 없이 Redis 키에 넣지 마라. 이유: 서명 게이트가 있어도 키 공간을 오염시킬 여지를 남긴다. `docs/ARCHITECTURE.md`가 같은 종류의 위험을 이미 경고한다.
- 이 step에서 툴이나 라우트를 만들지 마라. 이유: step 4·5의 범위다. 저장만 만드는 step이다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
