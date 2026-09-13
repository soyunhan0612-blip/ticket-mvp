# Step 1: slack-client

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 흐름" 절. n8n이 슬랙으로 나가는 기존 경로가 그려져 있다
- `/docs/ADR.md` — ADR-007. n8n을 Agent와 분리한 이유
- `/src/services/redis-client.ts:7-12` — `hasRedisConfig()`. **설정이 갖춰졌는지 판정하는 이 저장소의 형태**
- `/src/lib/slack-signature.ts` — **step 0에서 생성됨.** 같은 디렉터리에 짝이 되는 파일을 만든다
- `/src/lib/basic-auth.ts` — 비밀을 다루는 코드가 로그에 무엇을 남기지 않는지
- `/.env.example` — **전문.** 주석이 각 변수의 용도와 빠졌을 때의 동작을 설명하는 형식
- `/ops/n8n/README.md` — 기존 슬랙 연동이 Webhook을 어떻게 다루는지. **이 step은 Webhook이 아니라 봇 토큰을 쓴다**
- `/package.json:19-30` — **Slack SDK는 없고 추가하지 않는다.** `fetch`로 REST를 직접 부른다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

phase 14가 이미 슬랙으로 메시지를 보낸다. 다만 그것은 n8n이 Incoming Webhook을 호출하는
경로이고, **이 step이 필요한 것은 다른 종류의 전송**이다.

이유는 하나다. 상담원이 답장했을 때 **어느 대화의 답장인지 알아야 한다.**
Incoming Webhook은 보낸 메시지의 식별자(`ts`)를 돌려주지 않는다. 돌려주지 않으면
연결할 열쇠가 없다.

그래서 봇 토큰으로 `chat.postMessage`를 호출한다. 응답의 `ts`를 대화에 저장해 두면,
상담원이 **그 메시지에 스레드로 답장**했을 때 들어오는 이벤트의 `thread_ts`로
대화를 되찾을 수 있다.

슬랙 API의 함정이 하나 있다. **실패해도 HTTP 200을 준다.** 본문의 `ok` 필드가 `false`이고
`error`에 사유가 들어온다. `response.ok`만 보면 실패를 성공으로 읽는다.

이 저장소는 새 의존성을 추가하지 않는 것이 경계다. `chat.postMessage`는 JSON 한 번의
POST이므로 `fetch`로 충분하다.

`src/lib/`는 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/lib/slack-client.ts`

```ts
export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
export const SLACK_REQUEST_TIMEOUT_MS = 5_000;

export interface SlackPostMessageInput {
  text: string;
  threadTs?: string;
}

export interface SlackPostMessageResult {
  ts: string;
}

export function hasSlackConfig(): boolean;
export async function postSlackMessage(
  input: SlackPostMessageInput,
): Promise<SlackPostMessageResult>;
```

규칙:

- `hasSlackConfig()`는 `SLACK_BOT_TOKEN`과 `SLACK_CHANNEL_ID`가 **둘 다** 있을 때만 `true`.
  `hasRedisConfig()`와 같은 형태다
- `postSlackMessage`는 `hasSlackConfig()`가 `false`면 즉시 throw한다. 설정이 없는데
  네트워크를 때리지 마라
- 헤더는 `Authorization: Bearer {SLACK_BOT_TOKEN}`과
  `Content-Type: application/json; charset=utf-8`
- 본문은 `{ channel, text }`, `threadTs`가 있으면 `thread_ts`도 넣는다
- **응답 본문의 `ok`를 검사하라.** `ok`가 `false`면 `error` 값을 담아 throw한다.
  `response.ok`만 보면 안 된다
- `ok`가 `true`인데 `ts`가 없으면 그것도 실패로 다룬다
- `AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS)`로 상한을 건다. Node 22의 내장이다.
  이 저장소의 기존 외부 호출에는 타임아웃이 없는데, 이 호출은 손님 요청 처리 중에
  일어나므로 매달리면 손님이 답을 못 받는다
- 토큰을 에러 메시지·로그에 넣지 마라

`text`는 호출자가 완성해서 넘긴다. 이 파일은 문구를 만들지 않는다 — 무엇을 보낼지는
도메인 결정이고 step 4의 어댑터가 정한다.

### `.env.example`에 추가

기존 형식대로 **용도와 빠졌을 때의 동작을 주석으로** 적는다.

```
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CHANNEL_ID=
```

주석에 담을 것:

- 셋은 관람객 챗봇의 상담원 연결에 쓰인다
- `SLACK_BOT_TOKEN`에는 **스코프가 둘 이상 필요하다.** 보내기에 `chat:write`, 상담원 답장을 이벤트로 받기 위해 채널 종류에 맞는 history 스코프 — 공개 채널이면 `channels:history`, 비공개 채널이면 `groups:history`. **`chat:write`만으로는 답장이 앱에 들어오지 않는다.** 봇은 대상 채널에 초대돼 있어야 한다
- `SLACK_SIGNING_SECRET`은 들어오는 답장의 서명 검증에 쓰이며, **비어 있으면 콜백이
  전부 거부된다**(fail-closed)
- 비어 있으면 챗봇은 AI 답변만 하고 상담원 연결이 비활성화된다
- **`NEXT_PUBLIC_` 접두사를 붙이지 마라** — 붙이면 브라우저 번들에 평문으로 들어간다

### `src/lib/slack-client.test.ts` (먼저)

`vi.spyOn(globalThis, "fetch")`로 목킹한다. 최소한 아래를 덮어라.

| 경우 | 기대 |
|---|---|
| `ok: true`, `ts` 있음 | `ts`를 반환 |
| `ok: false`, `error: "channel_not_found"` | throw, 메시지에 `channel_not_found` 포함 |
| `ok: true`인데 `ts` 없음 | throw |
| HTTP 500 | throw |
| 환경변수가 없을 때 | throw, **`fetch`가 호출되지 않음** |
| `threadTs` 전달 | 요청 본문에 `thread_ts`가 들어감 |
| 어떤 실패에서든 | 에러 메시지에 토큰 값이 없음 |

환경변수는 `vi.stubEnv`로 세우고 `afterEach`에서 되돌린다.
`Authorization` 헤더가 `Bearer `로 시작하는지도 확인하라.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 응답의 `ok` 필드를 검사하는가? `response.ok`만 보지 않는가?
   - 설정이 없을 때 네트워크를 호출하지 않는가?
   - 타임아웃이 걸려 있는가?
   - 토큰이 에러 메시지에 섞이지 않는가?
   - `.env.example`의 새 항목에 `NEXT_PUBLIC_` 접두사가 없는가?
   - 새 의존성을 추가하지 않았는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **함수 시그니처, 추가한 환경변수 이름 셋, 타임아웃 값**을 적어라.
step 4가 `postSlackMessage`를 부르고 step 5가 같은 환경변수를 읽는다.

## 금지사항

- `NEXT_PUBLIC_SLACK_*` 같은 이름을 쓰지 마라. 이유: CRITICAL 규칙이다. `NEXT_PUBLIC_` 접두사가 붙은 값은 브라우저 번들에 평문으로 들어간다. 봇 토큰이 노출되면 누구나 그 워크스페이스에 글을 쓸 수 있다.
- `response.ok`만 보고 성공으로 판단하지 마라. 이유: 슬랙은 실패해도 HTTP 200을 준다. 채널을 못 찾거나 봇이 초대되지 않은 경우가 조용히 성공으로 기록되고, `ts`가 없어 상담원 답장이 영원히 연결되지 않는다.
- Incoming Webhook URL을 쓰지 마라. 이유: Webhook은 `ts`를 돌려주지 않는다. `ts`가 없으면 답장을 어느 대화에 붙일지 알 수 없고, 이 phase 전체가 성립하지 않는다.
- 타임아웃 없이 `fetch`를 부르지 마라. 이유: 이 호출은 손님의 요청을 처리하는 도중에 일어난다. 슬랙이 느리면 손님이 답을 받지 못한 채 매달린다.
- 봇 토큰이나 서명 비밀을 로그·에러 메시지·테스트 픽스처에 실제 값으로 넣지 마라. 이유: 저장소나 로그에 들어간 비밀은 회전 외에 되돌릴 방법이 없다.
- `@slack/web-api`를 설치하지 마라. 이유: 필요한 것은 JSON POST 한 번이다. 새 의존성 추가는 이 저장소의 명시적 경계다.
- 이 파일에서 슬랙에 보낼 문구를 만들지 마라. 이유: 무엇을 보낼지는 도메인 결정이다. 여기서 정하면 이식할 때 티켓 문구가 따라온다.
- 이 step에서 라우트나 저장소를 건드리지 마라. 이유: 전송 수단만 만드는 step이다. 연결은 step 4가 한다.
- 기존 테스트를 깨뜨리지 마라.
