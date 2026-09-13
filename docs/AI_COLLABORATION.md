# AI 협업 방식

이 저장소는 AI 코딩 에이전트와 함께 작업한 흔적을 지우지 않고 그대로 커밋했습니다. 규칙 파일과 훅 스크립트가 저장소 안에 있습니다.

| 파일 | 역할 |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) · [`AGENTS.md`](../AGENTS.md) | 아키텍처 CRITICAL 규칙(쿠키 전용 `userId`, 응답에 타인 `userId` 금지, 서버 재검증, `NEXT_PUBLIC_` 금지, plain text 렌더). 에이전트가 매 작업에서 읽습니다 |
| [`.claude/settings.json`](../.claude/settings.json) · [`.codex/hooks.json`](../.codex/hooks.json) | 두 에이전트가 `scripts/hooks/`의 같은 Node 스크립트를 공유합니다 |
| [`scripts/hooks/`](../scripts/hooks/) | 위험 명령 차단 · TDD 가드(`lib/`·`services/`·`route.ts`는 테스트 선행 없이 편집 차단) · Stop 검증 게이트(`lint`·`test`) |
| [`phases/`](../phases/) | 단계별 명세와 실행 결과. `status`가 `completed`/`blocked`로 기록됩니다 |

규칙을 문서로 적어두는 것과 그 규칙이 실제로 뭔가를 막는 것은 다릅니다. 실제로 막힌 사례 두 가지:

## 1. 빈 문자열 자격증명으로 Basic Auth가 뚫리던 결함

`verifyBasicAuth`가 기대 자격증명의 `undefined`만 검사하고 있었습니다. 그런데 환경변수에 `BASIC_AUTH_USER=`처럼 이름만 있으면 값은 `undefined`가 아니라 `""`로 로드됩니다. 그러면 가드를 통과하고 `"" === "" && "" === ""`이 `true`가 되어, **브라우저 인증 프롬프트에 아무것도 입력하지 않아도 `/admin`·`/seller`가 전부 열립니다.** 기존 테스트는 `undefined` 케이스만 덮고 있어 이 경로를 잡지 못했습니다.

리뷰에서 발견해 재현 근거를 [`phases/10-release/step0.md`](../phases/10-release/step0.md)에 남기고, 테스트를 먼저 추가한 뒤 fail-closed로 고쳤습니다(`c4712ec`). **설정되지 않은 자격증명은 열리는 방향이 아니라 닫히는 방향으로 실패해야 한다**가 그 커밋의 유일한 목적입니다.

## 2. 성능 수치를 지어내는 대신 멈춘 것

이 프로젝트의 정량 증거는 좌석 리렌더 수 하나뿐이었습니다. 그래서 명세의 금지사항에 "측정값을 추정하거나 그럴듯한 숫자로 채우지 마라. 값이 없으면 `blocked`가 정답이다"를 박아 두었습니다. 실제로 실측값이 없자 해당 단계는 문서를 고치지 않고 [`blocked`로 멈췄습니다](../phases/10-release/index.json) — `blocked_reason`에 어떤 값이 없는지 그대로 남아 있습니다.

이후 그 자리는 추정이 아니라 **직접 세고 재는 코드**로 채웠습니다.

- 클릭당 리렌더 수와 파생 atom 재계산 수: [`naive-render-count.test.tsx`](../src/components/seat/__tests__/naive-render-count.test.tsx), [`seat-render-count.test.tsx`](../src/components/seat/__tests__/seat-render-count.test.tsx)가 실행 중 직접 계측합니다.
- 초기 마운트 시간: [`scripts/perf/measure-initial-mount.mjs`](../scripts/perf/measure-initial-mount.mjs)가 before/after 두 빌드를 같은 절차로 측정합니다. 절차와 결과는 [Perf Measurement](PERF_MEASUREMENT.md)에 있습니다.

숫자가 나오기 전까지 그 자리는 비어 있었고, 비어 있다는 사실도 문서에 그대로 적혀 있었습니다.
