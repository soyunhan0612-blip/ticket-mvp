# Step 8: chat-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — **전문.** 특히 아이콘 단독 버튼 금지(120행 부근), 모달은 네이티브 `<dialog>`의 `showModal()`만 쓴다(110행 부근), 배지를 만들지 않는다(129행 부근)
- `/docs/UX_PRINCIPLES.md` — 원칙과 화면 매핑
- `/src/components/admin/OpsAgentPanel.tsx` — **전문.** 특히 `:30-38`(`AbortController`를 `useRef`에 담고 cleanup에서 abort), `:67-89`(스트림 읽기), `:137-149`(서버 상수로 입력 길이 클램프), `:169`(`whitespace-pre-wrap`)
- `/src/components/admin/OpsAgentPanel.test.tsx:9-19` — `createStreamingResponse(chunks)` 헬퍼와 `vi.spyOn(globalThis, "fetch")`
- `/src/components/reservation/ReservationCard.test.tsx:7-30` — 훅을 `vi.mock`으로 통째 교체하고 접근성 쿼리로 확인하는 형태
- `/src/hooks/use-my-reservations.ts` — 쿼리 훅의 전체 형태
- `/src/components/providers.tsx:10-19` — **retry 정책은 이 한 곳에만 있다.** 쿼리마다 `retry`를 박지 마라
- `/src/components/toast/Toast.tsx:17` — `fixed inset-x-0 bottom-lg z-50`. **플로팅 런처와 같은 띠·같은 스택을 다툰다**
- `/src/components/ui/` — `Button`(+`buttonClassName`), `Card`(+`cardClassName`), `TextInput`(+`FIELD_CLASS_NAMES`), `Dialog`
- `/src/app/layout.tsx` — `isOperatorSession()`을 부르는 **서버 컴포넌트**다. `<Providers>`가 children을 감싼다
- `/src/chatbot/adapters/ticket/prompt.ts` — **step 5에서 생성됨.** `CHAT_MESSAGE_LIMIT`
- `/src/app/api/chat/route.ts`, `/src/app/api/chat/[conversationId]/route.ts` — **step 7에서 생성됨.** 요청·응답 계약, `X-Conversation-Id` 헤더, GET의 `awaitingOperator`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 7이 두 엔드포인트를 만들었지만 부르는 화면이 없다. 이 step이 화면을 붙인다.

이식 요구가 여기서 한 번 갈린다. **헤드리스 훅은 이식 대상이고, 위젯은 아니다.**

- `src/chatbot/ui/use-chat.ts` — 전송·스트림 읽기·복원 로직. `@/`로 시작하는 import가
  하나도 없어야 한다. 다른 프로젝트에 그대로 복사된다
- `src/chatbot/ui/ChatWidget.tsx` — 이 프로젝트의 디자인 시스템(`@/components/ui`)을 쓴다.
  이식할 때는 새로 쓴다. 훅이 로직을 전부 갖고 있으므로 새로 쓰는 비용이 작다

훅이 `core/`의 판정 함수를 import하지 않아도 되도록 step 7의 GET이 `awaitingOperator`를
불리언으로 내려준다. 훅은 그 값을 그대로 전달만 한다.

`src/chatbot/ui/`는 step 0에서 **TDD 가드 대상이 아니다.** 렌더링 코드는 구현 후 렌더
테스트가 자연스럽다는 기존 규약과 같다. 그래도 테스트는 반드시 남겨라.

## 작업

### `src/chatbot/ui/use-chat.ts`

```ts
export interface ChatTurnView {
  id: string;
  role: "user" | "assistant" | "operator" | "notice";
  content: string;
  createdAt: number;
}

export interface UseChatOptions {
  sendPath?: string;                                   // 기본 "/api/chat"
  conversationPath?: (conversationId: string) => string;
  messageLimit: number;
}

export interface UseChatResult {
  turns: ChatTurnView[];
  isStreaming: boolean;
  awaitingOperator: boolean;
  error: Error | null;
  send: (message: string) => Promise<void>;
  reset: () => void;
}

export function useChat(options: UseChatOptions): UseChatResult;
```

동작 규칙:

- `send()`는 `POST`로 `{ conversationId?, message }`를 보낸다. 응답의 `X-Conversation-Id`
  헤더를 기억한다
- 스트림은 `OpsAgentPanel.tsx:67-89`와 같은 방식으로 읽는다. **표기를 정확히 하라** —
  디코더는 `new TextDecoder()`로 만들고, `stream: true`는 **`decode()`의 두 번째 인자**다
  (`decoder.decode(value, { stream: true })`). 생성자에 객체를 넘기면 라벨이
  `"[object Object]"`가 되어 `RangeError`가 난다
- 루프가 끝난 뒤 `decoder.decode()`를 인자 없이 한 번 더 불러 **남은 바이트를 flush**한다.
  이 호출을 빼면 멀티바이트 문자가 잘려 한글 끝 글자가 깨진다
- 스트리밍 중에는 보이는 `assistant` 턴의 `content`를 조각마다 늘린다. 전부 받은 뒤 다시
  그리지 마라 — 그러면 스트리밍한 의미가 없다
- **스트림이 끝나면 `GET`을 한 번 부른다.** 서버가 저장한 최종 턴 목록과 `awaitingOperator`를
  받아 로컬 상태를 맞춘다. 이것이 없으면 phase 16에서 에스컬레이션이 일어나도 클라이언트가
  그 사실을 영영 모른다
- `AbortController`를 `useRef`에 담고 언마운트 cleanup에서 abort한다. abort된 뒤 도착한
  조각은 버린다
- `conversationId`를 `sessionStorage`에 저장하고, **마운트 시 그 값으로 `GET`을 불러 대화를
  복원한다.** 새로고침해도 대화가 이어져야 한다. `sessionStorage` 접근은 `try`/`catch`로
  감싼다 — 사생활 보호 모드에서 던진다. `GET`이 404·403이면 저장된 id를 버리고 빈 대화로 시작한다
- 상태 코드를 `error`에 담아 위젯이 문구를 고르게 하라. 이 훅은 `@/lib`을 쓰지 않는다
- **`retry` 옵션을 직접 박지 마라.** 정책은 `providers.tsx`에 있다

TanStack Query를 써도 좋고 `useState`만 써도 좋다. 다만 `@/`로 시작하는 import는 금지다.

### `src/chatbot/ui/__tests__/no-domain-imports.test.ts`

`src/chatbot/ui/use-chat.ts`만 검사하는 **별도 테스트**를 만든다. step 1의
`core/__tests__/no-domain-imports.test.ts`에 이 파일을 더하지 마라 — 화이트리스트가 공용이
되면 `react`를 여는 순간 `core/`의 React 금지가 조용히 사라진다.

허용: `react`, `@tanstack/react-query`, 그리고 `./`로 시작하는 같은 디렉터리 상대 경로.
`@/`로 시작하는 것과 `../`로 올라가는 것은 금지다. `ChatWidget.tsx`는 검사 대상이 아니다.

### `src/chatbot/ui/ChatWidget.tsx`

`"use client"`. 화면 오른쪽 아래 런처 버튼, 누르면 대화 패널이 열린다.

`docs/UI_GUIDE.md`를 따르며, 특히 세 가지를 지켜라.

- **런처에 텍스트 라벨을 붙인다.** 아이콘만 있는 버튼은 금지다. 아이콘 버블이 아니라
  "문의하기" 같은 라벨이 보이는 버튼이어야 한다
- **패널을 `createPortal`로 손수 쌓지 마라.** 모달로 만들 거면 네이티브 `<dialog>`의
  `showModal()`을 쓰고(`src/components/ui/Dialog`가 이미 그 형태다), 모달이 아니라면
  일반 `position: fixed` 패널로 둔다. `<dialog>`를 고르면 jsdom에는 `showModal()`이 없어
  `vitest.setup.ts:18-27`의 폴리필에 의존하게 된다는 점을 알고 골라라
- **배지를 만들지 마라.** `operator` 턴은 "상담원"이라는 **텍스트 라벨**로 구분한다

그 밖에:

- 답변은 **`whitespace-pre-wrap` plain text**로 렌더한다
- `notice` 턴은 안내 문구로 보이게 한다. phase 16 전까지 `operator`·`notice`는 나타나지
  않지만 렌더 분기는 지금 만들어 둔다
- 입력 길이는 `maxLength={CHAT_MESSAGE_LIMIT}`로 클램프하고 남은 글자 수를 보여준다
  (`OpsAgentPanel.tsx:137-149`와 같은 이유 — 서버에서 400이 날 요청도 레이트리밋 슬롯을 먹는다)
- **`usePathname()`으로 `/admin`과 `/seller` 하위에서는 `null`을 반환한다.** 운영자 화면에는
  이미 `OpsAgentPanel`이 있다
- **`Toast`와 겹치지 않게 한다.** `Toast.tsx:17`이 `fixed inset-x-0 bottom-lg z-50`이다.
  런처를 그 아래 z-index에 두거나 세로 오프셋을 주어 토스트를 가리지 않게 하라

### `src/app/layout.tsx`에 부착

`<Providers>` 안에 `<ChatWidget />`을 넣는다. `Providers` 바깥에 두면 TanStack Query와
Jotai 컨텍스트가 없다. **`layout.tsx`를 클라이언트 컴포넌트로 바꾸지 마라.**

### 테스트

- `use-chat.test.tsx` — `OpsAgentPanel.test.tsx:9-19`의 `createStreamingResponse` 방식으로
  `fetch`를 목킹한다. 조각이 순서대로 누적되는지, **한글을 두 조각으로 쪼갠 `Uint8Array`에서
  글자가 깨지지 않는지**, 스트림 종료 후 `GET`이 한 번 불리는지, 언마운트 시 abort되는지,
  `sessionStorage` 복원이 404에서 조용히 실패하는지
- `ChatWidget.test.tsx` — 훅을 `vi.mock`으로 통째 교체하고 `getByRole({ name })`로 확인한다.
  런처에 접근 가능한 이름이 있는지, `/admin`에서 렌더되지 않는지(`usePathname` 목킹),
  `operator` 턴이 "상담원" 라벨과 함께 보이는지

## Acceptance Criteria

```bash
npm run test && npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `use-chat.ts`에 `@/`나 `../`로 시작하는 import가 0건인가?
   - `core/`의 아키텍처 테스트 화이트리스트를 건드리지 않았는가?
   - `new TextDecoder()` + `decode(value, { stream: true })` + 마지막 flush 형태인가?
   - 스트림 종료 후 `GET`을 한 번 부르는가?
   - 런처에 텍스트 라벨이 있는가? 배지를 만들지 않았는가? `createPortal`을 쓰지 않았는가?
   - 답변이 `whitespace-pre-wrap`인가? `dangerouslySetInnerHTML`이 없는가?
   - `/admin`·`/seller`에서 위젯이 렌더되지 않는가?
   - `layout.tsx`가 여전히 서버 컴포넌트인가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **`useChat`의 반환 필드 이름 전부**와 `ChatWidget`의 부착 위치, 패널을
`<dialog>`로 만들었는지 여부를 적어라. phase 16이 이 훅에 폴링을 더하고 위젯에 상담원
턴 표시를 채운다.

## 금지사항

- `use-chat.ts`에서 `@/`나 `../`로 시작하는 것을 import하지 마라. 이유: 이 훅이 이식의 단위다. 도메인이나 디자인 시스템에 묶이는 순간 복사해서 쓸 수 없다.
- `core/`의 아키텍처 테스트에 `ui/` 파일을 더하지 마라. 이유: 화이트리스트가 공용이 되면 `react`를 여는 순간 `core/`의 React 금지가 사라진다. `ui/`는 자기 테스트를 갖는다.
- `new TextDecoder({ stream: true })`처럼 쓰지 마라. 이유: 생성자의 첫 인자는 인코딩 라벨이다. 객체를 넘기면 `"[object Object]"`가 되어 `RangeError`가 난다. `stream`은 `decode()`의 옵션이다.
- `TextDecoder`의 마지막 `decode()` flush를 빼지 마라. 이유: 조각 경계에 걸친 멀티바이트 문자가 버려져 한글 끝 글자가 깨진다.
- 스트림이 끝난 뒤 `GET`을 부르지 않고 넘어가지 마라. 이유: phase 16에서 에스컬레이션이 일어나도 클라이언트가 모른다. 폴링이 영영 안 켜져 자동 안내도 상담원 답장도 새로고침 전까지 안 뜬다.
- 아이콘만 있는 런처 버튼을 만들지 마라. 이유: `docs/UI_GUIDE.md`가 아이콘 단독 버튼을 금지한다. 무엇을 여는 버튼인지 스크린리더에도 보이지 않는다.
- `createPortal`로 오버레이를 손수 쌓지 마라. 이유: `docs/UI_GUIDE.md`가 네이티브 `<dialog>`의 `showModal()`만 쓰도록 정했다. 포커스 트랩과 `Esc` 처리를 손으로 다시 만들게 된다.
- 배지 컴포넌트를 만들지 마라. 이유: `docs/UI_GUIDE.md`가 배지를 만들지 않는다고 정했다. 턴 구분은 텍스트 라벨로 한다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 답변에는 셀러가 입력한 공연 제목과 (phase 16에서는) 상담원이 쓴 문장이 섞인다. 렌더 방식이 저장형 XSS의 방어선이다.
- 스트리밍이 끝난 뒤 전체 텍스트로 다시 그리지 마라. 이유: 조각마다 늘리지 않으면 손님은 한 번에 나타나는 답을 본다.
- 쿼리마다 `retry` 옵션을 박지 마라. 이유: 재시도 정책은 `src/components/providers.tsx` 한 곳에 있다.
- `layout.tsx`를 `"use client"`로 바꾸지 마라. 이유: 루트 레이아웃이 `isOperatorSession()`으로 쿠키를 읽는 서버 컴포넌트다.
- `localStorage`에 대화 내용을 저장하지 마라. 이유: 대화의 단일 출처는 서버다. `sessionStorage`에는 `conversationId`만 둔다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
