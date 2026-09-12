# Step 0: tdd-guard-chatbot

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/scripts/hooks/CLAUDE.md` — 이 디렉터리의 규약 전문. 훅이 Claude와 Codex 양쪽에서 공유된다는 점
- `/scripts/hooks/hook-utils.cjs:7-8` — `SOURCE_SUFFIXES`, `TEST_MARKERS` 상수
- `/scripts/hooks/hook-utils.cjs:69-75` — `requiresTest()`. **이 step이 고치는 유일한 함수다**
- `/scripts/hooks/hook-utils.cjs:77-88` — `testCandidates()`. 소스 옆과 `__tests__/` 하위를 모두 후보로 낸다
- `/scripts/hooks/codex-tdd-guard.cjs:34-42` — `requiresTest`와 `testCandidates`를 실제로 쓰는 곳
- `/scripts/hooks/hook-utils.test.cjs:1-23` — `node --test` 스타일과 import 목록. 여기에 케이스를 추가한다
- `/package.json:17` — `test:hooks` 스크립트 정의
- `/AGENTS.md` — "개발 워크플로" 절의 TDD 적용 범위

## 배경

이 phase는 `src/chatbot/` 아래에 새 모듈을 만든다. 그런데 TDD 가드는 지금 세 경로만 본다
(`scripts/hooks/hook-utils.cjs:73-74`):

```js
if (lowered.startsWith("src/lib/") || lowered.startsWith("src/services/")) return true;
return /^src\/app\/api\/.+\/route\.(?:ts|tsx|js|jsx)$/.test(lowered);
```

`src/chatbot/core/engine.ts`는 어느 조건에도 걸리지 않는다. 즉 **이후 step들이 테스트 없이
구현해도 아무것도 막지 않는다.** `AGENTS.md`가 순수 로직에 TDD를 요구하는데 새 디렉터리만
예외가 되는 것은 규약의 구멍이다.

이 step이 그 구멍을 먼저 막는다. 가드가 선 뒤에 step 1~3이 돌아야 순서가 실제로 강제된다.

`src/chatbot/ui/`는 **가드 대상에서 뺀다.** 기존 규약이 `src/components/`를 빼는 것과 같은
이유다 — 렌더링 코드는 구현 후 렌더 테스트가 자연스럽고, 훅과 싸우는 비용이 이득보다 크다.

## 작업

`scripts/hooks/hook-utils.test.cjs`에 **먼저** 케이스를 추가하고, 그 다음
`scripts/hooks/hook-utils.cjs`를 고쳐라. 순서를 바꾸지 마라.

### `scripts/hooks/hook-utils.test.cjs` (먼저)

`requiresTest()`에 대해 최소 아래 표를 확인하는 케이스를 추가한다.

| 입력 | 기대 |
|---|---|
| `src/chatbot/core/engine.ts` | `true` |
| `src/chatbot/adapters/ticket/tools.ts` | `true` |
| `src/chatbot/core/engine.test.ts` | `false` |
| `src/chatbot/core/__tests__/engine.test.ts` | `false` |
| `src/chatbot/ui/use-chat.ts` | `false` |
| `src/chatbot/ui/ChatWidget.tsx` | `false` |
| `src/chatbot/core/notes.md` | `false` |

기존 경로의 회귀도 같은 케이스에 넣어라 — `src/lib/foo.ts`는 `true`,
`src/services/bar.ts`는 `true`, `src/components/Foo.tsx`는 `false`,
`src/app/api/chat/route.ts`는 `true`.

`testCandidates("src/chatbot/core/engine.ts", ROOT)`가
`src/chatbot/core/engine.test.ts`와 `src/chatbot/core/__tests__/engine.test.ts`를
**둘 다** 포함하는지도 확인한다. 이미 그렇게 동작하므로 회귀 방어용이다.

### `scripts/hooks/hook-utils.cjs`

```js
function requiresTest(filePath)   // 시그니처 무변경, 반환 타입 무변경
```

- 가드 대상에 `src/chatbot/core/`와 `src/chatbot/adapters/` 두 접두사를 더한다
- **`src/chatbot/ui/`는 더하지 마라**
- `SOURCE_SUFFIXES` 검사와 `TEST_MARKERS` 조기 반환은 **지금 순서를 유지하라**.
  테스트 파일이 먼저 걸러지지 않으면 `engine.test.ts` 자체가 테스트를 요구하게 된다
- 접두사가 넷이 되므로 `if` 연쇄 대신 배열 + `some()`으로 정리해도 좋다. 판정 결과만
  같으면 구현은 재량이다
- 기존 세 경로의 판정은 **한 글자도 달라지면 안 된다**

## Acceptance Criteria

```bash
npm run test:hooks
npm run lint && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트를 확인한다:
   - `src/` 아래를 하나도 만들거나 고치지 않았는가?
   - `requiresTest("src/lib/foo.ts")`가 여전히 `true`인가?
   - `requiresTest("src/components/Foo.tsx")`가 여전히 `false`인가?
   - `requiresTest("src/chatbot/ui/use-chat.ts")`가 `false`인가?
   - `package.json`과 `codex-tdd-guard.cjs`가 무수정인가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **가드 대상이 된 경로 목록과 제외한 경로**를 적어라. step 1~3이 자기 파일이
가드에 걸리는지 이 값으로 판단한다.

## 금지사항

- `src/chatbot/ui/`를 가드 대상에 넣지 마라. 이유: 렌더링 코드는 구현 후 렌더 테스트가 자연스럽다. 기존 규약도 같은 이유로 `src/components/`를 뺀다. 넣으면 step 5가 훅과 싸우며 재시도를 태운다.
- `src/` 아래에 파일을 만들지 마라. 이유: 이 step은 가드만 세운다. 실제 모듈은 step 1이 만든다. 지금 빈 파일을 만들면 step 1이 이미 있는 파일을 마주쳐 설계 의도를 오해한다.
- `codex-tdd-guard.cjs`에 경로 판정을 복제하지 마라. 이유: 판정은 `requiresTest` 한 곳에 있어야 한다. 두 곳으로 갈라지면 Claude Code와 Codex의 동작이 조용히 어긋난다.
- 기존 세 경로(`src/lib/`, `src/services/`, `src/app/api/**/route.ts`)의 판정을 바꾸지 마라. 이유: 저장소 전체가 그 규약 위에 서 있고, 완료된 14개 phase가 그것을 전제로 만들어졌다.
- `TEST_MARKERS` 조기 반환을 뒤로 옮기지 마라. 이유: 테스트 파일이 먼저 걸러지지 않으면 테스트 파일 자체가 테스트를 요구해 어떤 편집도 통과하지 못한다.
- 새 의존성을 추가하지 마라. 이유: 훅은 Node 내장만으로 돌아야 Windows와 Unix에서 같은 정책이 적용된다.
- 기존 테스트를 깨뜨리지 마라.
