# Step 2: admin-agent-panel

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/UX_PRINCIPLES.md` — Admin 화면 매핑과 "배지 컴포넌트를 만들지 않는다"(30행)
- `/docs/UI_GUIDE.md` — 안티패턴 표의 "Powered by AI" 배지(21행), 배지 금지(129행)
- `/docs/PRD.md` — 3대 함정 2번(차트 라이브러리)과 핵심 기능 7번의 "Agent UI는 텍스트 전용"
- `/src/app/api/admin/agent/route.ts` — **step 1에서 생성됨.** 요청 바디 형식과 응답 계약
- `/src/components/admin/OperationsPanel.tsx` — **이 step이 그대로 따를 원본.** 특히 `useQuery` 구성(39행), 필터 변경 시 진행 중 스트림을 끊는 `useEffect`(58~67행), 스트림 소비 전체(`generateSummary`, 69~132행), `section aria-labelledby`(135행), `Card tone="dark"`(157행), `Button variant="outline-on-dark"`(151·169행), 답변 렌더(`whitespace-pre-wrap`, 182행)
- `/src/components/admin/OperationsPanel.test.tsx` — `vi.spyOn(globalThis, "fetch")`로 `ReadableStream`을 돌려주는 목킹 방식
- `/src/components/admin/admin-query.tsx` — `UnauthorizedNotice`(8행), `ErrorNotice`(28행). 401 문구의 단일 출처
- `/src/lib/api-error.ts` — `UnauthorizedError`(5행)
- `/src/app/admin/page.tsx` — 현재 화면 전체. 특히 `canShowDashboard` 게이트(66행)와 `OperationsPanel` 배치(139행), 그 아래에서 게이트가 시작되는 지점(141행)
- `/src/components/ui/Button.tsx`, `/src/components/ui/Card.tsx` — 재사용할 버튼과 카드
- `/src/components/ui/TextInput.tsx` — 질문 입력에 쓸 수 있는 기존 입력 컴포넌트. `FIELD_CLASS_NAMES`(10행)와 `FIELD_LABEL_CLASS_NAMES`(13행)도 export돼 있어 `textarea`를 쓰더라도 같은 표면을 맞출 수 있다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0이 조회 Tool을, step 1이 `POST /api/admin/agent`를 만들었다. **화면에서 부르는 곳이
없다.** 이 step이 소비자를 만든다.

`OperationsPanel`과 갈라지는 지점이 둘 있다.

1. **입력이 있다.** 요약은 버튼 하나지만 Agent는 관리자가 질문을 쓴다. 빈 질문으로 Opus
   호출이 나가지 않게 막아야 한다.
2. **응답이 느리다.** Opus가 Tool을 고르고, Tool이 회차마다 `getSnapshot`을 부르고, 그 결과로
   다시 답을 만든다. 요약보다 확실히 오래 걸리므로 진행 중임이 화면에 드러나야 한다.

step 1에서 이미 확정된 런타임 동작 두 가지를 화면이 흡수해야 한다.

1. `ANTHROPIC_API_KEY`가 없으면 **정상 200**으로 폴백 문장이 온다. 오류로 표시하면 안 된다.
2. 헤더가 먼저 나가므로 **본문이 0바이트여도 상태 코드는 200**이다. 받은 길이가 0이면
   실패로 표시한다.

## 작업

**UI 레이어만 다룬다.** 라우트와 `src/lib/`은 건드리지 않는다.

### src/components/admin/OpsAgentPanel.tsx (신규)

```tsx
interface OpsAgentPanelProps {
  /** 빈 문자열이면 전체 공연 */
  showId: string;
}
export function OpsAgentPanel(props: OpsAgentPanelProps): JSX.Element;
```

- 질문 입력 요소 + 전송 버튼 + 답변 영역. 입력 요소의 종류는 재량이되 라벨을 붙이고,
  표면은 기존 것을 쓴다 — `TextInput`을 그대로 쓰거나, `textarea`가 낫다고 판단하면
  `FIELD_CLASS_NAMES`·`FIELD_LABEL_CLASS_NAMES`를 재사용한다. 새 입력 스타일을 만들지 않는다
- 질문이 비어 있으면(공백만 있는 경우 포함) 전송 버튼을 비활성한다. 빈 질문으로 Opus
  호출이 나가면 안 된다
- 요청 중에는 버튼을 비활성하고 라벨로 진행 중임을 알린다
- 요청 바디는 `{ question }`에 `showId`가 빈 문자열이 아닐 때만 `showId`를 더한다.
  `OperationsPanel`이 `showId === "" ? {} : { showId }`로 하는 것과 같은 이유다 —
  라우트의 zod 스키마가 `z.string().min(1)`이라 빈 문자열을 보내면 400이 온다
- 스트림 소비는 `OperationsPanel.tsx:69-132`와 **같은 방식**으로 한다: 요청마다 새
  `AbortController`, `response.body.getReader()` + `TextDecoder`의 `{ stream: true }` 누적,
  루프 뒤 `decoder.decode()` flush, 누적 길이가 0이면 실패 처리
- `showId`가 바뀌면 진행 중 요청을 끊고 답변과 에러를 지운다
  (`OperationsPanel.tsx:58-67`과 같은 이유 — 이전 필터로 만든 답이 새 필터의 표 옆에 남는다).
  사용자가 필터를 바꿔 끊은 것은 **실패가 아니므로** 에러로 표시하지 않는다
- 401은 `UnauthorizedError`로 던지고 `UnauthorizedNotice`로 렌더한다. 그 밖의 실패는
  `ErrorNotice`. **문구를 새로 쓰지 마라** — 같은 화면에서 두 패널이 다른 말로 같은 상황을
  설명하게 된다
- 답변은 `whitespace-pre-wrap`의 **plain text**로 렌더한다
- 표시는 기존 토큰과 `components/ui/`의 `Button`·`Card`를 재사용한다. Admin 화면 전체가
  어두운 밴드이므로 `tone="dark"`와 `variant="outline-on-dark"` 계열을 쓴다

### src/app/admin/page.tsx 수정

`OpsAgentPanel`을 `canShowDashboard` 게이트 **밖**, `OperationsPanel`(139행) 바로 아래에
둔다. `showId`만 넘긴다 — Agent는 회차 하나가 아니라 필터 전체를 보므로 `sessionId`와
무관하다.

### src/components/admin/OpsAgentPanel.test.tsx (신규)

`src/components/**`는 TDD 가드가 막지 않지만, 이 저장소는 컴포넌트에도 테스트를 둔다.

1. 질문이 비어 있으면 전송 버튼이 비활성이다
2. 질문을 넣고 전송하면 `POST /api/admin/agent`를 부르고, 바디에 질문이 담긴다
3. `showId`가 빈 문자열이면 바디에 `showId`가 없고, 값이 있으면 담긴다
4. 스트림으로 온 텍스트가 화면에 누적된다
5. 0바이트로 끝나면 실패 문구를 보여준다
6. 401이면 `UnauthorizedNotice`의 문구를 보여준다

`fetch`는 `OperationsPanel.test.tsx`처럼 `vi.spyOn(globalThis, "fetch")`로 대체하고
`ReadableStream`을 담은 `Response`를 돌려준다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `dangerouslySetInnerHTML`이 0건인가?
   - 차트 라이브러리를 넣지 않았는가? `package.json`이 무수정인가?
   - 폴링(`refetchInterval`)을 걸지 않았는가?
   - `OpsAgentPanel`이 `canShowDashboard` 게이트 밖에 있는가?
   - `src/app/api/`와 `src/lib/`을 수정하지 않았는가?
3. 결과에 따라 `phases/13-ops-agent/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **생성한 컴포넌트 경로와 `/admin`에서의 배치**를 적어라.

## 금지사항

- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 답변에는 셀러가 입력한 공연 제목이 섞여 들어온다. HTML로 렌더하면 저장형 XSS 경로가 된다. plain text + `whitespace-pre-wrap`이 이 저장소의 규칙이다.
- 차트 라이브러리를 넣지 마라. 이유: `docs/PRD.md`의 3대 함정 2번이다. 번들만 커지고, Agent UI는 텍스트 전용으로 정해져 있다.
- "Powered by AI" 배지나 배지 컴포넌트를 만들지 마라. 이유: `docs/UI_GUIDE.md`가 기능이 아니라 장식으로 분류한다. 상태는 명도로, 분류는 텍스트로 표현한다.
- 폴링을 걸지 마라. 이유: 버튼을 누를 때만 요청한다. Agent 한 번에 Opus 호출과 회차 수만큼의 `getSnapshot`이 따라붙는다(`src/lib/operations.ts:42`). 주기 호출로 만들면 비용이 시간에 비례해 쌓인다.
- 빈 질문으로 요청을 보내지 마라. 이유: 답할 것이 없는 질문에 Opus 호출과 Tool 루프가 그대로 나간다.
- `OpsAgentPanel`을 `canShowDashboard` 게이트 안에 넣지 마라. 이유: 그 게이트는 회차 하나를 고른 뒤에 열린다. Agent는 필터 전체를 보므로 회차 선택을 기다릴 이유가 없다.
- 401·실패 문구를 새로 쓰지 마라. 이유: 같은 화면의 두 패널이 같은 상황을 다른 말로 설명하게 된다. `admin-query.tsx`의 `UnauthorizedNotice`/`ErrorNotice`를 쓴다.
- 키 없는 폴백 응답을 오류로 표시하지 마라. 이유: 그것은 정상 200이다. 오류로 칠하면 "AI 키 없이도 전체 흐름을 끝까지 볼 수 있다"는 이 프로젝트의 폴백 설계가 화면에서 부정된다.
- 요청을 GET으로 보내지 마라. 이유: 질문이 URL과 서버 로그에 남고, 라우트는 POST만 받는다.
- 바디에 `userId`나 좌석 수·판매율을 넣지 마라. 이유: `userId`는 쿠키에서만 읽는다. 클라이언트가 보낸 수치로 답을 만들면 위조된 운영 보고가 된다.
- `src/app/api/`와 `src/lib/`을 수정하지 마라. 이유: 이 step은 UI 레이어만 다룬다. 라우트를 고쳐야 할 이유가 보이면 그 자체가 step 1과의 계약 불일치이므로 `blocked`로 표시하라.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
