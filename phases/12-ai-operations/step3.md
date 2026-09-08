# Step 3: admin-ops-panel

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 렌더링 경계 표, "보안 경계"의 AI 엔드포인트·`/admin·/seller` 절
- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "Operations API 계약", "테스트·검증 규약"의 마지막 항목(Admin UI는 텍스트 전용)
- `/docs/UI_GUIDE.md` — 밴드/표면 정책(33~44행), **dark 밴드에서 red를 텍스트로 쓰지 않는다**(70~72행), Admin 절(마지막)
- `/src/app/admin/page.tsx` — 현재 화면 전체. 특히 `showId`/`sessionId` 상태(36~37행), `ADMIN_SELECT_CLASS_NAMES`(26~27행), `canShowDashboard` 게이트(65행)
- `/src/components/admin/OccupancyStats.tsx` — `UnauthorizedError` 클래스(14~19행)와 401 이후 폴링을 멈추는 `refetchInterval` 함수
- `/src/components/admin/OccupancyStats.test.tsx` — 이 저장소의 컴포넌트 테스트 스타일(`QueryClientProvider` + `vi.spyOn(globalThis, "fetch")`)
- `/src/components/seller/AiDescriptionGenerator.tsx` — 스트리밍 리더 패턴(48~56행)과 plain text 렌더(86~89행)
- `/src/app/api/admin/operations/route.ts` — **step 1에서 생성됨.** 쿼리 스키마와 응답 봉투 `{ sessions }`(27행)
- `/src/lib/operations.ts` — **step 1에서 생성됨.** `OperationsRow` 필드 9개(4~14행), `getSnapshot`을 회차마다 한 번씩 부르는 루프(42행)
- `/src/app/api/admin/ai-summary/route.ts` — **step 2에서 생성됨.** 요청 바디 스키마(13~16행), 폴백 문장(43~57행), 스트림 생성(72~106행)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 1이 `GET /api/admin/operations`를, step 2가 `POST /api/admin/ai-summary`를 만들었다.
**둘 다 화면에서 부르는 곳이 없다.** 이 step이 소비자를 만든다.

현재 `/admin`은 회차를 하나 골라야만 내용이 뜬다:

```tsx
const canShowDashboard = sessionId !== "" && selectedShow !== undefined;
```

그래서 "어느 회차가 잘 팔리나", "오늘 매진 임박한 공연이 있나" 같은 **비교** 질문에
답하지 못한다. Operations API가 단일 객체가 아니라 목록을 돌려주는 이유가 그것인데
(`docs/AI_OPERATIONS_EXPANSION_PLAN.md`의 "Operations API 계약") 소비자가 없어 그 설계가
화면에서 증명되지 않는다.

라우트 쪽에서 이미 확인된 동작 두 가지를 화면이 흡수해야 한다.

1. **키가 없으면 폴백 문장이 스트리밍된다.** 200이고 정상 응답이다. 에러로 표시하면 안 된다.
2. **스트림이 한 글자도 없이 끝날 수 있다.** `createAnthropicStream`은 `ReadableStream`을
   만드는 시점에 이미 응답 헤더가 나간 뒤라, Anthropic 호출이 즉시 실패하면 상태는 200인데
   본문만 비어서 끝난다. 이때 화면이 조용히 빈칸을 보이면 사용자는 "요약할 게 없구나"로
   오인한다. 실패로 표시해야 한다.

## 작업

UI 레이어만 다룬다. 라우트와 `src/lib/`는 건드리지 않는다.

### `src/components/admin/OperationsPanel.tsx` (신규)

```tsx
interface OperationsPanelProps {
  /** 빈 문자열이면 전체 공연 */
  showId: string;
}

export function OperationsPanel(props: OperationsPanelProps): JSX.Element;
```

한 컴포넌트가 두 가지를 담당한다 — 회차별 운영 현황 표와, 그 위에 얹는 AI 요약.

#### 표 (`GET /api/admin/operations`)

- TanStack Query를 쓴다. `queryKey`는 `showId`를 포함해야 공연을 바꿀 때 다시 받는다
- `showId`가 빈 문자열이면 **쿼리스트링에 아예 넣지 마라.** 라우트 스키마가
  `z.string().min(1)`이라 `?showId=`는 400이 된다
- 응답 봉투는 `{ sessions: OperationsRow[] }`다. 배열이 바로 오지 않는다
- 컬럼은 `OperationsRow`의 필드를 쓴다: 공연명, 회차 시각, 전체, 예매가능, 홀드, 판매완료, 판매율
- 회차 시각은 `page.tsx:120-122`가 쓰는 `toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })`과
  같은 방식으로 표시해 화면 안에서 표기가 갈리지 않게 한다
- 행이 0개일 때의 문구를 따로 둔다 (표 머리만 남기지 마라)
- 401은 `OccupancyStats`의 `UnauthorizedError`와 **같은 문구**로 구분해 알린다.
  데이터 오류와 뭉뚱그리면 다시 로그인할 길이 없다

#### AI 요약 (`POST /api/admin/ai-summary`)

- 버튼을 눌렀을 때만 호출한다
- 바디는 필터만 보낸다. `showId`가 빈 문자열이면 필드 자체를 넣지 않는다 (`{}` 를 보낸다)
- 스트리밍 읽기는 `AiDescriptionGenerator.tsx:48-56`과 같은 방식
  (`response.body.getReader()` + `TextDecoder`, `{ stream: true }` 누적)
- 받은 텍스트는 **plain text + `whitespace-pre-wrap`** 으로 렌더한다
- 요약 중에는 버튼을 `disabled`로 두어 중복 호출을 막는다
- **스트림이 0바이트로 끝나면 실패로 표시한다** (배경 2번). 성공과 구분되는 문구를 보여라

#### 표시 규칙

- `/admin`은 dark 밴드다. 에러는 **red 채움 + 흰 글씨**로 표현한다. red 텍스트는 ink 위에서
  3.08:1이라 AA 미달이다 (`docs/UI_GUIDE.md` 70~72행). `page.tsx:129-136`의 에러 배너가
  이미 이 형태이므로 그것과 맞춘다
- 새 색·새 spacing 토큰을 만들지 말고 기존 Tailwind 토큰과 `components/ui/`의
  `Button`·`Card`를 재사용한다

### `src/app/admin/page.tsx` 수정

`OperationsPanel`을 `canShowDashboard` 게이트 **바깥**에 둔다. 회차를 고르지 않아도,
공연을 고르지 않아도 보여야 한다 — 전체 회차 비교가 이 패널의 존재 이유다.
`showId`만 넘긴다. `sessionId`는 이 패널과 무관하다.

### `src/components/admin/OperationsPanel.test.tsx` (신규)

`src/components/**`는 TDD 가드가 막지 않지만, 이 저장소는 컴포넌트에도 테스트를 둔다
(`OccupancyStats.test.tsx`). 최소 아래를 덮어라.

1. 응답의 회차 행을 모두 렌더한다 (공연명과 판매율이 화면에 보인다)
2. `showId`가 빈 문자열이면 요청 URL에 `showId`가 들어가지 않는다
3. 401 응답이면 로그인 만료 문구를 보인다
4. 요약 버튼을 누르면 스트림 조각이 누적되어 렌더된다 (두 조각 이상으로 나눠 검증하라)
5. 스트림이 빈 채로 끝나면 실패 문구를 보인다
6. 요약 텍스트에 `<script>` 같은 문자열이 들어 있어도 **문자 그대로** 보인다
   (`dangerouslySetInnerHTML`을 쓰지 않았다는 증거)

`fetch` 목킹은 `OccupancyStats.test.tsx`처럼 `vi.spyOn(globalThis, "fetch")`를 쓰고,
스트리밍 응답은 `ReadableStream`을 직접 만들어 `new Response(stream)`으로 돌려주면 된다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트(`src/app/api/**/route.ts`)와 `src/lib/`가 **무수정**인가?
   - `dangerouslySetInnerHTML`이 0건인가?
   - 차트 라이브러리를 추가하지 않았는가? `package.json`이 무수정인가?
   - 빈 `showId`가 쿼리스트링·요청 바디에 실리지 않는가?
   - 폴링(`refetchInterval`)을 걸지 않았는가?
3. 결과에 따라 `phases/12-ai-operations/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **생성한 컴포넌트 경로와 `/admin`에서의 배치**를 적어라. phase 13의 Agent UI가
같은 화면에 붙으므로 다음 세션이 이 정보를 필요로 한다.

## 금지사항

- 차트 라이브러리를 넣지 마라. 이유: `docs/PRD.md`의 3대 함정 2번이자 `docs/UI_GUIDE.md`의 Admin 규칙이다. 번들만 키우고 좌석맵 재사용이 훨씬 강한 증거다. 표와 숫자로 끝낸다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 요약 텍스트에는 셀러가 입력한 공연 제목이 그대로 섞여 들어온다(폴백 문장은 AI를 거치지도 않는다). 저장형 XSS의 실제 경로다.
- 운영 현황 표에 폴링을 걸지 마라. 이유: `collectOperations`는 회차마다 `getSnapshot`을 한 번씩 부른다(`src/lib/operations.ts:42`). 3초 폴링을 붙이면 Redis 커맨드가 회차 수에 비례해 늘어난다. `OccupancyStats`의 3초 폴링은 **회차 하나**를 보는 것이라 성격이 다르다. 갱신이 필요하면 수동 새로고침 버튼을 둔다.
- AI 요약을 화면 진입만으로 자동 호출하지 마라. 이유: 화면을 열 때마다 과금되고, 레이트리밋(분당 3회)이 사용자 조작 없이 소진된다.
- 요청 바디나 쿼리에 좌석 수·판매율 같은 수치를 넣지 마라. 이유: 클라이언트가 보낸 숫자를 요약하면 위조된 운영 보고를 만들 수 있다. 서버가 직접 집계한다.
- `src/app/api/**/route.ts`와 `src/lib/`를 수정하지 마라. 이유: 이 step은 UI 레이어 하나만 다룬다. 라우트에서 부족한 점을 발견하면 고치지 말고 `index.json`의 `summary`에 적고, 화면 쪽에서 흡수하라.
- 새 의존성을 추가하지 마라. 이유: `@tanstack/react-query`로 충분하다.
- "Powered by AI" 배지를 달지 마라. 이유: `docs/UI_GUIDE.md`가 금지한다.
- 키가 없을 때 오는 폴백 문장을 에러로 표시하지 마라. 이유: 200이고 정상 응답이다. "AI 장애 시 AI 영역만 실패"라는 이 phase의 전제가 화면에서 뒤집힌다.
- 기존 테스트를 깨뜨리지 마라.
