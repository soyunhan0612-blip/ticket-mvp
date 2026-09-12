# Step 5: slack-events

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "AI 엔드포인트" 절. `/api/chat/slack/events`가 서명 검증만으로 게이트된다는 서술
- `/docs/ADR.md` — ADR-008의 "쿠키 검사 없이 대화에 쓰는 경로가 하나 생겼다" 트레이드오프
- `/src/lib/slack-signature.ts` — **step 0에서 생성됨.** `verifySlackSignature`의 인자 이름과 순서
- `/src/lib/slack-client.ts` — **step 1에서 생성됨.** `hasSlackConfig`
- `/src/services/conversation-store.ts` — **step 3에서 확장됨.** `appendOperatorReply`
- `/src/lib/basic-auth.ts:90` — `isProtectedPath`. **새 라우트가 여기에 걸리면 슬랙이 401을 받는다.** 걸리지 않는 것을 확인하라
- `/src/app/api/chat/route.ts` — **phase 15 step 7에서 생성됨.** `responseHeaders` 상수와 라우트 작성 형태
- `/src/lib/ops-agent-tools.test.ts:15-29` — 소스를 읽어 정규식으로 검사하는 아키텍처 테스트 기법

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

상담원이 슬랙 스레드에 답장하면 슬랙이 이 앱의 URL을 호출한다. 그 요청을 받아 대화에 붙이는
것이 이 step이다.

**이 라우트는 이 저장소에서 쿠키 검사 없이 쓰기가 일어나는 유일한 경로다.** 방어선은
step 0의 서명 검증 하나뿐이다. 그래서 실수하기 쉬운 지점을 아래에 전부 적어 둔다. 하나라도
빠지면 누구나 임의의 스레드 식별자로 남의 대화에 "상담원" 이름을 달고 글을 넣거나, 같은
답장이 여러 번 뜨거나, 슬랙이 이벤트 구독을 꺼 버린다.

## 작업

### `src/app/api/chat/slack/events/route.ts`

```ts
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response>;
```

처리 순서를 그대로 지켜라.

1. **`const rawBody = await request.text()`를 가장 먼저 한다.**
   `request.json()`을 먼저 부르면 원문이 사라져 서명을 다시 만들 수 없다. 다시 직렬화한
   JSON은 키 순서·공백이 달라 서명이 절대 맞지 않고, 모든 정상 요청이 401이 된다
2. `x-slack-request-timestamp`와 `x-slack-signature` 헤더를 읽는다. 없으면 401.
   **헤더 이름은 대소문자를 가리지 않는다** — `Request.headers.get()`이 이미 그렇게 동작한다
3. `verifySlackSignature({ signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
   timestamp, signature, rawBody, now: Date.now() })`. `false`면 **401**.
   응답 본문에 실패 사유를 적지 마라
4. `JSON.parse(rawBody)`를 `try`/`catch`로 감싼다. 실패하면 400
5. `type`이 `"url_verification"`이면 본문의 `challenge` 값을 그대로 돌려준다.
   슬랙 앱에 Request URL을 등록할 때 한 번 온다. 이것이 없으면 등록 자체가 안 된다
6. `type`이 `"event_callback"`이면:
   - `event.bot_id`가 있거나 `event.subtype`이 `"bot_message"`면 **무시하고 200**.
     봇 자신의 메시지에 반응하면 무한 루프가 된다
   - `event.type`이 `"message"`가 아니면 무시하고 200
   - `event.channel`이 `SLACK_CHANNEL_ID`와 다르면 무시하고 200.
     다른 채널의 대화가 손님 화면에 들어오면 안 된다
   - `event.thread_ts`가 없거나 `event.ts`와 같으면 무시하고 200.
     스레드 답장이 아니라 새 메시지다
   - `event.text`가 비어 있으면 무시하고 200
   - `appendOperatorReply(event.thread_ts, event.text, body.event_id, Date.now())`.
     **`event_id`는 `event` 안이 아니라 바깥 봉투에 있다**
7. 그 외 `type`은 무시하고 200
8. 어떤 경우에도 **빠르게 응답한다.** 대화에 붙이는 것 외의 일을 하지 마라

**응답 본문을 비운다.** `appendOperatorReply`는 `userId`와 대화 전문을 담은 `Conversation`을
돌려준다. 그것을 JSON으로 내보내면 유출이다. 성공·무시 모두 본문 없는 200이면 충분하다.

**모르는 스레드, 처리하지 않는 이벤트에 4xx를 주지 마라.** 200이다. 슬랙은 실패가 반복되면
이벤트 구독을 자동으로 끈다. 401은 서명이 틀렸을 때뿐이다.

레이트리밋을 IP로 걸지 마라. 슬랙의 출발 IP는 고정이 아니고, 서명이 이미 게이트다.

### `src/app/api/chat/slack/events/route.test.ts` (먼저)

- 서명이 맞고 스레드 답장이면 턴이 추가된다
- **서명이 틀리면 401이고 대화가 바뀌지 않는다**
- `SLACK_SIGNING_SECRET`이 비어 있으면 401 (fail-closed)
- 타임스탬프가 6분 전이면 401
- `url_verification`에 `challenge`를 그대로 돌려준다
- `bot_id`가 있는 이벤트는 200이지만 턴이 늘지 않는다
- 다른 채널의 이벤트는 200이지만 턴이 늘지 않는다
- 모르는 `thread_ts`는 **200**이다 (4xx가 아니다)
- 같은 `event_id`로 두 번 오면 턴이 하나만 늘어난다
- 본문이 JSON이 아니면 400
- **성공 응답의 본문에 `userId`나 대화 내용이 없다**

테스트에서 서명을 만들 때는 `node:crypto`로 직접 조립하라. `verifySlackSignature`를
재사용하면 구현이 틀려도 통과한다.

### 호출자 유일성 테스트

`appendOperatorReply`를 부르는 곳이 **이 콜백 라우트 하나뿐**임을 소스 정규식으로 고정한다.
파일 위치는 재량이되 `src/` 아래 테스트로 수집되는 자리에 둔다.

- `src/` 아래에서 그 식별자가 나오는 파일을 모은다
- 저장소 인터페이스·구현(`src/services/conversation-store*.ts`)과 테스트 파일을 뺀 나머지가
  `src/app/api/chat/slack/events/route.ts` 하나인지 확인한다
- 왜 이 검사가 있는지 주석으로 남겨라 — 이 메서드가 `userId` 검사 없이 쓰는 유일한
  경로이므로, 호출자가 늘어나는 것 자체가 소유권 검증을 우회하는 경로가 늘어나는 것이다

## Acceptance Criteria

```bash
npm run test && npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트를 확인한다:
   - `request.text()`가 `JSON.parse`보다 먼저인가?
   - 서명 실패에 401을, 그 외 처리 못 하는 이벤트에 200을 주는가?
   - 봇 자신의 메시지와 다른 채널의 이벤트를 무시하는가?
   - 같은 `event_id`가 두 번 와도 턴이 하나인가?
   - **응답 본문이 비어 있는가?** `Conversation`을 내보내지 않는가?
   - `appendOperatorReply`의 호출자가 이 라우트 하나뿐인가?
   - `isProtectedPath`에 걸리지 않는 경로인가? (걸리면 슬랙이 401을 받는다)
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **라우트 경로, 무시 조건 목록, 호출자 유일성 테스트의 파일 경로**를 적어라.
step 6이 이 경로를 설정 문서에 적는다.

## 금지사항

- `request.json()`을 서명 검증보다 먼저 부르지 마라. 이유: 원문 바이트가 사라진다. 다시 직렬화한 JSON은 키 순서·공백이 달라 서명이 절대 맞지 않고, 모든 정상 요청이 401이 된다.
- 서명 검증을 건너뛰거나 `SLACK_SIGNING_SECRET`이 없을 때 통과시키지 마라. 이유: 이 라우트는 쿠키 검사 없이 대화에 쓰는 유일한 경로다. 검증이 유일한 방어선이고, 뚫리면 누구나 남의 화면에 "상담원" 이름으로 글을 넣는다.
- 응답 본문에 `Conversation`을 내보내지 마라. 이유: `userId`와 그 사람의 예매 내역이 담긴 대화 전문이 들어 있다. 응답에 남의 `userId`를 싣지 않는 것이 CRITICAL 규칙이다.
- 모르는 스레드나 처리하지 않는 이벤트에 4xx를 주지 마라. 이유: 슬랙은 실패가 반복되면 이벤트 구독을 자동으로 끈다. 한 번 꺼지면 사람이 콘솔에서 다시 켜야 한다.
- 봇 자신의 메시지를 처리하지 마라. 이유: 앱이 보낸 메시지에 앱이 반응해 무한 루프가 된다.
- `event_id` 중복 검사를 빼지 마라. 이유: 슬랙은 응답이 늦으면 같은 이벤트를 재전송한다. 상담원의 한 마디가 화면에 여러 번 뜬다.
- 콜백 안에서 느린 작업을 하지 마라. 이유: 응답이 늦으면 슬랙이 재전송한다. 대화에 붙이는 것 외의 일을 하지 마라.
- `appendOperatorReply`를 이 라우트 밖에서 부르지 마라. 이유: `userId` 검사가 없는 메서드다. 호출자가 늘어나는 것 자체가 소유권 검증을 우회하는 경로가 늘어나는 것이다.
- 이 라우트에 IP 레이트리밋을 걸지 마라. 이유: 슬랙의 출발 IP는 고정이 아니다. 정상 이벤트가 막히고, 서명이 이미 게이트다.
- 서명 실패 사유를 응답 본문에 적지 마라. 이유: 어느 검사에서 걸렸는지 알려주면 우회 시도를 도와준다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
