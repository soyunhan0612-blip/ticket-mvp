# Step 6: ticket-tools

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "Agent 권한 경계"와 그 아래 "관람객 챗봇의 예외" 2번(본인 예약 개별 레코드 허용)
- `/docs/ADR.md` — ADR-007의 "Tool이 집계를 스스로 하지 않고 집계 함수를 거치는 이유"
- `/src/chatbot/core/types.ts` — **step 1에서 생성됨.** `ChatToolDescriptor`
- `/src/chatbot/core/sanitize.ts` — **step 1에서 생성됨.** `wrapUserInput()`
- `/src/chatbot/adapters/ticket/deps.ts` — **step 5에서 생성됨.** `TicketChatDeps`
- `/src/chatbot/adapters/ticket/refund-policy.ts` — **step 5에서 생성됨.** `REFUND_POLICY_TEXT`
- `/src/lib/ops-agent-tools.ts:43-89` — 툴 두 개의 실제 작성 형태. 반환은 `JSON.stringify` 문자열이다
- `/src/lib/ops-agent-tools.test.ts:15-29` — **금지 식별자 목록과 검사 대상 경로를 `배열 상수`로 두는 형태.** 디렉터리를 훑지 않는다
- `/src/lib/ops-agent-tools.test.ts:205-213` — 그 배열을 실제로 검사하는 부분
- `/src/lib/seat-stats.ts:12-44` — `computeSalesRate`, `computeSeatStats`. **`available`은 `total - held - sold`로 계산된다**(40행)
- `/src/services/show-store.ts:3-10` — `list`, `get`, `getBySessionId` 시그니처
- `/src/app/api/reservations/[id]/route.ts:5-8` — `sanitizeReservation()`. 응답에서 `userId`를 지우는 형태
- `/src/types/index.ts` — `Show`, `Session`, `Reservation`, `SeatSnapshot`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 5가 의존성 타입·환불 문구·프롬프트를 만들었다. 이 step이 모델이 실제로 부를 툴을 만든다.

두 가지가 이 파일의 성격을 정한다.

**첫째, 이 파일은 부작용이 없다.** 도메인을 읽기만 한다. phase 16이 슬랙 전송이라는 부작용을
가진 툴을 더하는데, 그때도 **이 파일에는 넣지 않는다** — 별도 파일로 간다. 여기가 무부작용
이라는 사실을 테스트로 고정해 두면, 나중에 누가 쓰기를 섞어도 즉시 드러난다.

**둘째, 예약 레코드를 개별로 내보내는 첫 사례다.** `AI_OPERATIONS_EXPANSION_PLAN.md`는
원래 "개별 예약 레코드를 Agent Tool 결과에 넣지 않는다"였다. 그 금지의 대상은 **남의**
예약이다. 쿠키로 신원이 확인된 본인 예약은 예외로 허용하도록 문서가 갱신돼 있으니
그 조건 — 본인 것에 한하고 `userId`는 제거 — 을 정확히 지켜라.

`src/chatbot/adapters/`는 TDD 가드 대상이다. `tools.ts`를 만들려면 `tools.test.ts`가
먼저 있어야 한다.

## 작업

### `src/chatbot/adapters/ticket/tools.ts`

```ts
export function createTicketChatTools(deps: TicketChatDeps): ChatToolDescriptor[];
```

툴 다섯 개. 반환은 전부 `JSON.stringify(...)` 문자열이다.

| 이름 | 입력 스키마 | 반환에 담을 것 |
|---|---|---|
| `list_shows` | `z.object({})` | 전체 공연의 `id`, `title` |
| `get_show` | `{ showId: string }` | 공연의 `id`·`title`·`description`, 회차 목록의 `id`·`startsAt` |
| `get_session_availability` | `{ sessionId: string }` | 공연 제목, 회차 시각, `total`·`available`·`held`·`sold` |
| `list_my_reservations` | `z.object({})` | 내 예매의 `id`·`status`·`createdAt`·`seatIds`, 그리고 공연 제목·회차 시각 |
| `get_refund_policy` | `z.object({})` | `REFUND_POLICY_TEXT` |

지켜야 할 규칙:

- **`userId`를 입력 스키마에 넣지 마라.** `deps.userId`를 클로저로 쓴다
- `list_my_reservations`는 `deps.reservationStore.listByUser(deps.userId)`의 결과에서
  **`userId` 필드를 제거하고** 반환한다. `sanitizeReservation` 패턴이다
- `Reservation`에는 공연 제목도 회차 시각도 없다. `deps.showStore.getBySessionId(sessionId)`로
  역참조해야 사람이 읽을 수 있는 답이 된다
- `get_session_availability`는 `deps.seatStore.getSnapshot(sessionId, deps.userId)`의 결과를
  `computeSeatStats(snapshot.seats, show.presetId)`에 넘긴다. **직접 세지 마라** —
  집계는 `src/lib/seat-stats.ts` 한 곳에 있다는 것이 ADR-007의 "숫자 출처 단일화"다
- `getSnapshot`이 돌려주는 `mine` 플래그를 툴 결과에 싣지 마라. 이 툴이 답하는 것은 잔여석이다
- **셀러가 입력한 값은 전부 `wrapUserInput()`으로 감싼다** — `show.title`과 `show.description`.
  `ops-agent-tools.ts:56,83`이 같은 처리를 한다
- 존재하지 않는 `showId`·`sessionId`에는 **throw하지 말고** `{ found: false }` 같은 형태로
  돌려줘라. 툴이 throw하면 툴 루프 전체가 끊겨 손님이 빈 답을 본다

### `src/chatbot/adapters/ticket/__tests__/read-only.test.ts`

`src/chatbot/adapters/ticket/` 아래 소스에 **쓰기 경로 식별자가 없음**을 정규식으로 고정한다.

- **검사 대상 파일 경로를 배열 상수로 둔다.** `ops-agent-tools.test.ts:15-19`가 그 형태다.
  디렉터리를 훑으면 금지 식별자 목록을 담은 **이 테스트 파일 자신이** 걸린다
- 금지 식별자 최소 목록: `hold`, `release`, `confirmSeats`, `releaseSold`, `revertSold`,
  `cancel`, `getSeatStore`, `getShowStore`, `getReservationStore`
- 팩토리 함수 이름까지 막는 이유는, `deps`를 우회해 store를 직접 가져오면 `Pick<>` 제약이
  무의미해지기 때문이다

phase 16이 이 배열에 손을 댄다(부작용 툴을 예외로 뺀다). **배열을 파일 상단에 named
constant로 두고 주석으로 용도를 밝혀라** — 그래야 다음 phase가 무엇을 고쳐야 할지 안다.

### `src/chatbot/adapters/ticket/tools.test.ts`

`ops-agent-tools.test.ts:53-61`처럼 `createTicketChatTools(...)`에서 이름으로 툴을 찾아
`tool.run(args)`를 직접 부르고 `JSON.parse`한다. 최소한 아래를 덮어라.

- 다섯 툴이 전부 존재하고 이름이 맞다
- `list_my_reservations`의 반환에 **`userId`가 없다**
- `list_my_reservations`가 다른 `userId`의 예약을 돌려주지 않는다
- `list_my_reservations`의 각 항목에 공연 제목과 회차 시각이 붙어 있다
- 제목에 `===USER_INPUT_END===`를 심은 공연을 넣어도 구분자 쌍이 하나만 남는다
- 없는 `showId`·`sessionId`에 throw하지 않는다
- `get_session_availability`의 `available`이 `total - held - sold`와 일치한다

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 어느 툴의 입력 스키마에도 `userId`가 없는가?
   - `list_my_reservations`의 반환에 `userId`가 없는가?
   - `deps`를 거치지 않고 `getShowStore()` 등을 직접 부르는 곳이 없는가?
   - `show.title`과 `show.description`이 `wrapUserInput()`을 거치는가?
   - 잔여석을 직접 세지 않고 `computeSeatStats()`를 쓰는가?
   - `read-only.test.ts`가 디렉터리를 훑지 않고 배열 상수를 쓰는가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **툴 다섯 개의 이름과 각 입력 스키마**, 그리고 `read-only.test.ts`의 검사 대상
배열 상수 이름을 적어라. step 7이 툴 목록을 라우트에 넘기고, phase 16이 그 배열에 예외를 더한다.

## 금지사항

- `userId`를 툴의 입력 스키마에 넣지 마라. 이유: 모델이 만들어낸 값이 그대로 조회 키가 된다. 인젝션 한 줄로 남의 예매 내역이 열린다. CRITICAL 규칙이 `userId`는 쿠키에서만 읽으라고 정한 이유가 이것이다.
- `list_my_reservations`의 반환에 `userId`를 남기지 마라. 이유: 응답에 남의 `userId`를 싣지 않는 것이 CRITICAL 규칙이다. 모델이 답변 본문에 그대로 옮겨 적을 수 있다.
- `deps`를 우회해 `getShowStore()`·`getSeatStore()`·`getReservationStore()`를 직접 부르지 마라. 이유: `Pick<>`으로 쓰기 메서드를 잘라낸 것이 조회 전용의 실제 방어선이다. 팩토리를 직접 부르면 전체 인터페이스가 열려 그 방어가 사라진다.
- 좌석·예매를 바꾸는 툴을 만들지 마라. 이유: ADR-007이 조회 전용으로 못박았다. 자연어 판단이 좌석 상태 전이에 개입하면 "왜 이 좌석이 풀렸는가"를 사후에 설명할 수 없다.
- 슬랙 전송이나 그 밖의 부작용을 이 파일에 넣지 마라. 이유: 이 파일이 무부작용이라는 사실을 테스트가 고정한다. phase 16의 에스컬레이션 툴은 별도 파일로 간다.
- 잔여석을 툴에서 직접 세지 마라. 이유: 집계는 `src/lib/seat-stats.ts`의 순수 함수 한 곳에 있다. 두 번째 계산이 생기면 화면과 챗봇이 다른 숫자를 말한다.
- `show.title`·`show.description`을 중화 없이 툴 결과에 넣지 마라. 이유: 셀러가 입력한 값이다. 구분자를 심어 신뢰 영역으로 빠져나갈 수 있다.
- 툴 안에서 throw하지 마라. 이유: 툴 루프 전체가 끊겨 손님이 빈 답을 본다. 없으면 없다는 데이터를 돌려주고 모델이 답하게 하라.
- `read-only.test.ts`에서 디렉터리를 훑지 마라. 이유: 금지 식별자 목록을 담은 그 테스트 파일 자신이 검사에 걸려 거짓 실패한다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
