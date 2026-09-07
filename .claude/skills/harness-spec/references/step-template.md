# stepN.md 템플릿

`phases/{phase}/step{N}.md`. 아래 다섯 절을 순서대로 둔다.
잘 쓰인 실제 사례: `phases/11-perf-metrics/step2.md`.

---

```markdown
# Step {N}: {kebab-case-name}

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 디렉토리 구조와 Store 인터페이스
- `/docs/ADR.md` — 기술 선택의 근거
- `{이전 step에서 생성·수정된 파일}` — {이 파일에서 무엇을 볼지, 줄 번호까지}

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

{이 step이 왜 필요한지. 현재 코드가 어떤 상태이고 무엇이 부족한지.
관련 코드를 짧게 인용해 문제를 눈으로 보이게 한다.}

## 작업

{구체적 구현 지시. 파일 경로와 함수·타입 시그니처를 제시하고, 내부 구현은 재량에 맡긴다.}

### {파일 경로}

```ts
export function foo(input: Bar): Baz;
```

{이 함수가 지켜야 할 규칙. 벗어나면 안 되는 것만 적는다.}

## Acceptance Criteria

```bash
npm run test
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `docs/ARCHITECTURE.md`의 디렉토리 구조를 따르는가?
   - `docs/ADR.md`의 기술 스택을 벗어나지 않았는가?
   - CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/{phase}/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요(API 키, 외부 인증, 수동 측정) → `"status": "blocked"`,
     `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- {X}를 하지 마라. 이유: {Y}
- 기존 테스트를 깨뜨리지 마라
```

---

## 절별 주의

**읽어야 할 파일** — 경로만 나열하지 말고 각 파일에서 **무엇을 볼지** 적는다.
`src/services/seat-store.ts`보다 `src/services/seat-store.ts:18 — hold() 시그니처`가 낫다.

**배경** — 이 절이 없으면 세션이 지시를 문자 그대로만 따르고 의도를 벗어난다.
현재 코드의 문제를 인용으로 보여라.

**작업** — 구현체를 통째로 적지 마라. 시그니처와 규칙만 준다.
전부 적으면 세션이 그대로 베끼고, 주변 코드와 어긋나도 알아채지 못한다.

**AC** — 그대로 복사해 실행 가능해야 한다. `&&`로 묶어도 되고 줄을 나눠도 된다.

**금지사항** — 이유를 반드시 붙인다. 이유 없는 금지는 지켜지지 않거나,
비슷한 다른 방법으로 우회된다.

## `summary` 필드

step 완료 시 세션이 `index.json`에 쓴다. `execute.py`가 이것을 **다음 step 프롬프트에
누적 전달**하므로, 다음 step에 유용한 정보를 담아야 한다 — 생성된 파일 경로,
핵심 설계 결정, 예상과 달랐던 점.

나쁜 예: `"작업 완료"`
좋은 예: `"src/lib/seat-stats.ts에 aggregateSeatStats() 추출. /api/admin/stats가 이를 호출하도록 교체, 응답 형태 무변경. 프리셋 밖 섹션은 집계에서 제외."`
