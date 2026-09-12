# Step 0: slack-signature

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "보안 경계" 절
- `/docs/ADR.md` — ADR-007의 트레이드오프. 이 저장소가 인증을 어디까지 단순화했는지
- `/src/lib/basic-auth.ts` — **전문.** 기대 자격증명이 비어 있으면 거부하는 fail-closed 가드(`:18-26`)가 이 step이 따라야 할 선례다. 다만 `:55`의 자격증명 비교는 평범한 `===`다 — **이 저장소에 상수 시간 비교는 아직 없고, 이 step이 첫 사례가 된다.** `basic-auth.ts`를 고치려 들지 마라
- `/src/lib/basic-auth.test.ts` — 인증 순수 함수를 테스트하는 이 저장소의 형태
- `/src/lib/rate-limit.ts` — 순수 함수 + 팩토리 스타일
- `/src/lib/sellout-alert.ts` — 임계값을 **인자로 받아** 판정을 결정적으로 만드는 순수 함수의 서술 스타일
- `/src/lib/hold.ts:1-11` — **시각**을 인자로 받아 만료를 비교하는 형태. 이 step의 타임스탬프 검사가 같은 모양이다
- `/package.json:19-30` — 의존성 목록. **Slack SDK는 없고, 추가하지 않는다**

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

phase 16은 슬랙 상담원의 답장을 손님 화면에 띄운다. 답장은 슬랙이 이 앱의 URL을
**바깥에서 호출**하면서 들어온다. 즉 인터넷에 열린 엔드포인트가 하나 생긴다.

그 엔드포인트는 `userId` 쿠키를 검사할 수 없다. 슬랙은 쿠키를 갖고 있지 않다. 대신
**서명을 검증한다.** 요청 본문과 타임스탬프를 서명 비밀로 HMAC한 값이 헤더의 값과
같은지 보는 방식이다.

이것이 phase 15·16 전체에서 **가장 위험한 지점**이다. 이 검증이 뚫리면 누구나 임의의
`thread_ts`로 남의 대화에 "상담원" 이름을 달고 글을 넣을 수 있다. 쿠키 검사가 없는
유일한 쓰기 경로이기 때문이다.

그래서 서명 검증을 라우트에 인라인으로 쓰지 않고 **순수 함수로 떼어낸다.** 이 저장소가
SDK를 목킹하지 않아 AI 경로의 자동 커버리지가 0인 것과 달리, 이 함수는 외부 의존이 없어
테스트로 완전히 덮을 수 있다. 라우트는 다음 step들에서 만들고, 여기서는 판정만 만든다.

새 npm 패키지를 쓰지 않는다. HMAC은 Node 내장 `node:crypto`로 충분하다.

`src/lib/`는 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/lib/slack-signature.ts`

```ts
export const SLACK_SIGNATURE_VERSION = "v0";
export const SLACK_TIMESTAMP_TOLERANCE_MS = 300_000;

export interface SlackSignatureInput {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  now: number;
}

export function verifySlackSignature(input: SlackSignatureInput): boolean;
```

판정 규칙. 하나라도 어긋나면 `false`이고, **예외를 던지지 마라** — 라우트가 분기를
단순하게 유지해야 한다.

1. `signingSecret`이 빈 문자열이거나 공백뿐이면 `false`. **fail-closed다.**
   `basic-auth.ts`가 같은 이유로 같은 가드를 갖고 있다. 환경변수를 빠뜨린 배포에서
   검증이 통과해 버리면 방어선이 통째로 사라진다
2. `timestamp`가 정수 문자열이 아니면 `false`
3. `Math.abs(now - timestamp * 1000) > SLACK_TIMESTAMP_TOLERANCE_MS`이면 `false`.
   가로챈 요청을 나중에 다시 보내는 공격을 막는다
4. 서명 대상 문자열은 `v0:{timestamp}:{rawBody}`를 그대로 이어 붙인 것이다
5. `node:crypto`의 HMAC-SHA256에 `signingSecret`을 키로 넣고 hex로 뽑은 뒤
   `v0=`를 앞에 붙인 값이 기대 서명이다
6. 기대 서명과 `input.signature`를 **`crypto.timingSafeEqual`로** 비교한다.
   두 버퍼의 길이가 다르면 `timingSafeEqual`이 던지므로, **길이를 먼저 비교해
   다르면 `false`를 반환하라.** `===`로 비교하지 마라

`now`를 인자로 받는 이유는 테스트를 결정적으로 만들기 위해서다. 함수 안에서
`Date.now()`를 부르지 마라. `src/lib/hold.ts`가 같은 이유로 같은 형태다.

### `src/lib/slack-signature.test.ts` (먼저)

최소한 아래를 덮어라.

| 경우 | 기대 |
|---|---|
| 올바른 서명·최신 타임스탬프 | `true` |
| 본문을 한 글자 바꾼 경우 | `false` |
| 서명 비밀이 다른 경우 | `false` |
| 타임스탬프가 6분 전 | `false` |
| 타임스탬프가 6분 후(미래) | `false` |
| `timestamp`가 `"abc"` | `false` |
| `signingSecret`이 `""` | `false` |
| `signature`가 `"v0=короткий"`처럼 길이가 다른 값 | `false` (던지지 않는다) |
| `signature`가 빈 문자열 | `false` |

**기대 서명을 만들 때 `verifySlackSignature`를 재사용하지 마라.** 테스트 안에서
`node:crypto`로 직접 조립하라. 구현을 호출해 기대값을 만들면 구현이 틀려도 테스트가 통과한다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `signingSecret`이 비었을 때 `false`인가? (fail-closed)
   - 비교가 `timingSafeEqual`이고, 길이 불일치에서 던지지 않는가?
   - 함수 안에서 `Date.now()`를 부르지 않는가?
   - 새 의존성을 추가하지 않았는가?
   - 테스트가 기대 서명을 구현과 독립적으로 만드는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **`verifySlackSignature`의 시그니처와 허용 오차 값**을 적어라.
step 5가 이 함수를 콜백 라우트에서 부른다.

## 금지사항

- `signingSecret`이 비었을 때 `true`를 반환하거나 검증을 건너뛰지 마라. 이유: 환경변수를 빠뜨린 배포에서 아무나 남의 대화에 상담원 이름으로 글을 쓸 수 있게 된다. `basic-auth.ts`가 같은 함정을 fail-closed로 막았고 그것이 phase 10의 산출물이다.
- 서명을 `===`나 `==`로 비교하지 마라. 이유: 문자열 비교는 첫 불일치에서 즉시 반환하므로 응답 시간이 정답 접두사 길이에 비례한다. 서명을 한 바이트씩 알아낼 수 있다.
- `timingSafeEqual`에 길이가 다른 버퍼를 그대로 넘기지 마라. 이유: 예외를 던진다. 라우트에서 500이 나고, 슬랙은 5xx를 재전송으로 받아들여 같은 요청을 반복한다.
- 타임스탬프 검사를 빼지 마라. 이유: 서명은 본문이 같으면 영원히 유효하다. 한 번 가로챈 요청을 며칠 뒤에 다시 보낼 수 있다.
- 함수 안에서 `Date.now()`를 부르지 마라. 이유: 테스트가 실제 시계에 의존하게 되어 경계값(정확히 5분)을 검증할 수 없다.
- `@slack/web-api`나 다른 Slack 패키지를 설치하지 마라. 이유: 서명 검증에 필요한 것은 `node:crypto`의 HMAC뿐이다. 새 의존성 추가는 이 저장소의 명시적 경계다.
- 서명 비밀이나 서명 값을 로그·에러 메시지에 넣지 마라. 이유: 저장소나 로그에 들어간 비밀은 회전 외에 되돌릴 방법이 없다.
- 이 step에서 라우트를 만들지 마라. 이유: 판정과 HTTP 표면을 분리하는 것이 이 step의 목적이다. 콜백 라우트는 step 5가 만든다.
- 기존 테스트를 깨뜨리지 마라.
