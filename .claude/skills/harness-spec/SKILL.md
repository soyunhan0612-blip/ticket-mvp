---
name: harness-spec
description: Harness phase/step 명세를 설계하고 phases/ 아래 파일을 생성한다. "step 명세 작성", "phase 추가", "다음 단계 설계", "12-ai-operations step1 써줘" 같은 요청에 사용.
---

# Harness step 명세 작성

`scripts/execute.py`가 각 `stepN.md`를 **독립된 Codex 세션**에 던진다. 그 세션은
이 대화를 보지 못한다. 명세의 자기완결성이 곧 실행 성공률이다.

## 먼저 읽을 것

1. `docs/ARCHITECTURE.md` — 현재 구조의 최종 기준
2. `docs/ADR.md` — 왜 그렇게 됐는지
3. 대상 phase의 계획 문서 (예: `docs/AI_OPERATIONS_EXPANSION_PLAN.md`)
4. 직전 step의 `stepN.md`와 `phases/{phase}/index.json`의 `summary` 필드

잘 쓰인 샘플: `phases/11-perf-metrics/step2.md` (135줄). 구조를 여기에 맞춘다.

## 설계 7원칙

1. **Scope 최소화** — 한 step에서 한 레이어 또는 한 모듈만. 여러 모듈을 동시에
   고쳐야 하면 step을 쪼갠다.
2. **자기완결성** — "이전 대화에서 논의한 대로" 같은 외부 참조 금지.
   필요한 정보는 전부 파일 안에 적는다.
3. **사전 준비 강제** — 읽어야 할 파일의 **절대 경로**와 각 파일에서 볼 지점(줄 번호까지)을
   명시한다. 세션이 코드를 읽고 맥락을 잡은 뒤 작업하게 만든다.
4. **시그니처 수준 지시** — 함수·타입의 인터페이스만 제시하고 내부 구현은 재량에 맡긴다.
   단 설계 의도에서 벗어나면 안 되는 핵심 규칙(멱등성·보안·데이터 무결성)은 박아넣는다.
5. **AC는 실행 가능한 커맨드** — "동작해야 한다"가 아니라 `npm run test && npm run lint`.
6. **금지사항은 구체적으로** — "조심해라" 대신 **"X를 하지 마라. 이유: Y"**.
7. **네이밍** — step name은 kebab-case slug, 핵심 모듈·작업을 한두 단어로
   (`project-setup`, `api-layer`, `operations-api`).

## 이 저장소에서 반드시 지킬 것

### TDD 가드 경로는 테스트 선행을 명세에 박는다

`scripts/hooks/codex-tdd-guard.cjs`가 아래 경로를 **테스트 없이 편집하면 차단**한다.

- `src/lib/**`
- `src/services/**`
- `src/app/api/**/route.ts`

이 경로를 건드리는 step은 "먼저 `<파일>.test.ts`를 작성하고, 그 다음 구현하라"를
작업 절에 명시한다. 안 그러면 Codex가 훅에 막혀 재시도 3회를 태우고 `error`로 끝난다.

테스트는 소스 옆 `<name>.test.ts`에 둔다. vitest는 `src/**`만 수집한다
(`vitest.config.ts`). `vitest.setup.ts`가 Upstash 환경변수를 지우므로 테스트는
항상 메모리 스토어로 돈다 — Redis 경로는 클라이언트를 목킹해 검증한다.

### AC는 `npm run test && npm run lint`

`npm run build`는 배포 직전 수동이다. Stop 훅도 lint·test만 돌린다.
라우팅·설정을 바꾸는 step에서만 build를 AC에 추가한다.

### CRITICAL 규칙을 명세에 옮겨 적는다

`CLAUDE.md`는 `execute.py`의 가드레일에 **실리지 않는다**(`AGENTS.md`와 `docs/*.md`만 실린다).
따라서 그 step에 해당하는 CRITICAL 규칙은 명세 본문에 직접 적어야 한다.

라우트를 건드리는 step이면 최소한 이 셋: `userId`는 쿠키에서만
(`getUserIdFromRequest`, `src/lib/cookie.ts`), 응답에 남의 `userId` 금지,
좌석 규칙은 서버에서 재검증(`src/lib/seat-rules.ts`·`seat-map.ts`).

### phase 12~14는 계획 문서의 경계를 반영한다

`docs/AI_OPERATIONS_EXPANSION_PLAN.md`가 정한 것 — 새 `*Service` 계층 금지
(순수 집계는 `src/lib/`, 조립은 route handler), Agent는 조회 전용,
운영 라우트는 `/api/admin/**` 아래, 프롬프트 인젝션 구분자 재사용,
새 의존성 추가 금지.

## 작업 순서

1. 대상 phase 디렉토리와 `index.json`이 있는지 확인한다 (`ls phases/`)
2. 없으면 `phases/{phase}/index.json`을 만들고 `phases/index.json`에 항목을 추가한다
   — 스키마는 `references/index-schema.md`
3. `stepN.md`를 작성한다 — 템플릿은 `references/step-template.md`
4. 작성 후 스스로 검수한다:
   - 이 파일만 읽고 구현할 수 있는가 (외부 참조가 남아 있지 않은가)
   - 읽어야 할 파일 경로가 실제로 존재하는가
   - AC가 그대로 붙여넣어 실행 가능한가
   - TDD 가드 경로를 건드리는데 테스트 선행 지시가 빠지지 않았는가

## 실행은 사용자가 한다

명세를 만든 뒤 실행하지 마라. `python3 scripts/execute.py {phase}`는 사용자가 직접 돌린다.
실행법과 `error`/`blocked` 복구 절차는 `/harness` 커맨드에 있다.
