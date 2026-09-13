# Step 2: escalation-core

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — ADR-008의 "1분 자동 응답을 타이머로 만들지 않은 이유"
- `/src/lib/hold.ts:1-11` — **시각을 인자로 받아** 만료를 비교하는 형태. 이 step이 같은 모양이다
- `/src/lib/sellout-alert.ts` — 판정은 순수 함수, 호출은 라우트로 나누는 서술 스타일
- `/src/chatbot/core/fallback.ts` — **phase 15 step 1에서 생성됨.** 안내 문구를 한 파일에 모아 두는 이유
- `/src/chatbot/core/__tests__/no-domain-imports.test.ts` — **phase 15 step 1에서 생성됨.** 디렉터리를 읽으므로 이 step의 새 파일도 자동으로 검사 대상이 된다
- `/src/types/index.ts` — **phase 15 step 3에서 추가됨.** `ConversationEscalation`. 이 step의 타입은 그것의 부분집합이다
- `/phases/15-chatbot/index.json` — phase 15 각 step의 `summary`. **`execute.py`는 현재 phase의 index만 프롬프트에 싣는다.** 이전 phase가 무엇을 어떤 이름으로 만들었는지는 이 파일을 직접 읽어야 안다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

손님이 AI가 못 답하는 질문을 하면 슬랙으로 넘어간다. 그 뒤 1분이 지나도 상담원이 받지
않으면 "확인하는 대로 답변드립니다" 안내가 떠야 한다.

**이것을 타이머로 만들지 않는다.** 서버리스 인스턴스는 요청 사이에 죽으므로 예약된 작업의
실행을 보장할 수 없다. 대신 **질문한 시각만 저장하고, 폴링이 들어올 때마다 순수 함수가
판정한다.** `src/lib/hold.ts`가 홀드 만료를 다루는 방식과 같다.

이 step은 **판정 함수만** 만든다. 저장은 step 3, 호출은 step 4다. 나누는 이유는 이 함수가
도메인도 슬랙도 모르는 자리에 있어야 하기 때문이다 — `src/chatbot/core/`는 폴더째 이식되는
단위이고, 아키텍처 테스트가 `@/`와 `../` import를 전부 막는다.

`src/chatbot/core/`는 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/chatbot/core/escalation.ts`

```ts
export const AUTO_REPLY_DELAY_MS = 60_000;
export const AUTO_REPLY_TEXT: string;

export interface EscalationSnapshot {
  askedAt: number;
  autoReplySentAt: number | null;
  answeredAt: number | null;
}

export function shouldSendAutoReply(
  escalation: EscalationSnapshot | null,
  now: number,
): boolean;

export function isAwaitingOperator(
  escalation: EscalationSnapshot | null,
): boolean;
```

`shouldSendAutoReply`는 아래를 **순서대로** 보고 하나라도 걸리면 `false`다.

1. `escalation`이 `null` — 상담원 연결이 없는 대화다
2. `answeredAt`이 `null`이 아님 — 이미 답이 왔다
3. `autoReplySentAt`이 `null`이 아님 — 이미 안내를 보냈다
4. `now - askedAt < AUTO_REPLY_DELAY_MS` — 아직 1분이 안 지났다

`isAwaitingOperator`는 `escalation`이 있고 `answeredAt`이 `null`일 때 `true`다.
GET 라우트가 이 값을 불리언으로 내려보내고, UI가 그것으로 폴링을 켤지 끌지 정한다.

`AUTO_REPLY_TEXT`는 "지금 바로 응대가 어렵다, 확인하는 대로 답변한다"는 뜻의 한 문단이다.
`fallback.ts`에 문구를 모아 둔 것과 같은 이유로 `core/`에 둔다 — 이식할 때 고칠 자리가
한 곳이어야 한다.

**`EscalationSnapshot`에 `slackThreadTs`를 넣지 마라.** `core/`는 슬랙을 모른다.
판정에 필요한 것은 세 시각뿐이고, 도메인 타입 `ConversationEscalation`에서 이 세 필드만
뽑아 넘기는 것은 호출자(step 4)의 일이다.

### `src/chatbot/core/escalation.test.ts` (먼저)

네 조건의 경계를 각각 확인한다. 특히 **정확히 `AUTO_REPLY_DELAY_MS`가 지난 시점**의 동작을
고정하라 — `>=`인지 `>`인지가 여기서 결정된다. `now`를 인자로 받으므로 가짜 타이머가 필요 없다.

`isAwaitingOperator`도 `null`·대기 중·답변 완료 셋을 덮어라.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `escalation.ts`에 `@/`나 `../`로 시작하는 import가 없는가?
     (`no-domain-imports.test.ts`가 자동으로 잡는다)
   - `Date.now()`를 부르지 않는가?
   - `EscalationSnapshot`에 `slackThreadTs`가 없는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **두 함수의 시그니처, `AUTO_REPLY_DELAY_MS` 값, 경계(정확히 1분)에서의 동작**을
적어라. step 4가 이 함수를 GET 라우트에서 부른다.

## 금지사항

- `setTimeout`이나 스케줄러로 1분 뒤 자동 응답을 예약하지 마라. 이유: 서버리스 인스턴스는 요청 사이에 죽는다. 예약된 작업의 실행이 보장되지 않아 안내가 영영 안 뜨는 대화가 생긴다.
- 함수 안에서 `Date.now()`를 부르지 마라. 이유: 테스트가 실제 시계에 의존하게 되어 정확히 1분 경계를 검증할 수 없다.
- `EscalationSnapshot`에 `slackThreadTs`를 넣지 마라. 이유: `src/chatbot/core/`는 슬랙도 도메인도 몰라야 한다. 아키텍처 테스트가 import는 잡지만 타입 필드는 잡지 못하므로 이 규칙은 사람이 지켜야 한다.
- 저장소 메서드나 라우트를 만들지 마라. 이유: step 3과 step 4의 범위다. 판정만 만드는 step이다.
- `src/chatbot/core/`의 다른 파일을 고치지 마라. 이유: phase 15가 정한 계약 위에 여러 step이 쌓여 있다. 부족한 것이 있으면 새 파일로 만들고 `summary`에 적어라.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
