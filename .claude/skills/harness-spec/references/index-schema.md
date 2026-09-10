# phases/ index.json 스키마

두 계층이다. 최상위가 phase 목록, phase 안이 step 목록.

## `phases/index.json` — 전체 현황

```json
{
  "phases": [
    { "dir": "12-ai-operations", "status": "pending" }
  ]
}
```

- `dir` — phase 디렉토리명
- `status` — `"pending"` | `"completed"` | `"error"` | `"blocked"`

이미 존재하면 `phases` 배열에 항목을 **추가**한다. 덮어쓰지 마라.

## `phases/{phase}/index.json` — phase 상세

```json
{
  "project": "티켓 예매 MVP",
  "phase": "12-ai-operations",
  "steps": [
    { "step": 0, "name": "seat-stats", "status": "pending" },
    { "step": 1, "name": "operations-api", "status": "pending" }
  ]
}
```

- `project` — `CLAUDE.md`의 프로젝트명
- `phase` — 디렉토리명과 **일치시킨다**
- `steps[].step` — 0부터 시작하는 순번
- `steps[].name` — kebab-case slug, `step{N}.md`의 제목과 일치
- `steps[].status` — 생성 시 전부 `"pending"`

## 생성 시 넣지 않는 필드

아래는 `scripts/execute.py`가 **자동 기록**한다. 손으로 넣으면 실제 실행 시각과 어긋난다.

| 필드 | 위치 | 기록 시점 |
|---|---|---|
| `created_at` | phase | 최초 실행 시 한 번 |
| `started_at` | step | 각 step 시작 |
| `completed_at` | step·phase | `completed` 전이 |
| `failed_at` | step·phase | `error` 전이 |
| `blocked_at` | step·phase | `blocked` 전이 |

타임스탬프는 KST(UTC+9)로 기록된다.

## 상태 전이

| 전이 | 함께 기록되는 필드 | 누가 쓰는가 |
|---|---|---|
| → `completed` | `summary` | Codex 세션 |
| → `error` | `error_message` | Codex 세션 |
| → `blocked` | `blocked_reason` | Codex 세션 |

`summary`는 다음 step 프롬프트에 누적 전달된다. 작성 요령은
`references/step-template.md`의 마지막 절을 보라.

## 복구

`execute.py`는 `error`나 `blocked` step이 있으면 **시작 자체를 거부한다**
(각각 exit 1, exit 2). 재실행하려면 손으로 되돌려야 한다.

**error** — 해당 step의 `status`를 `"pending"`으로 바꾸고 `error_message`를 삭제한다.
**blocked** — `blocked_reason`에 적힌 사유를 먼저 해결하고, `status`를 `"pending"`으로
바꾸고 `blocked_reason`을 삭제한다.

phase 레벨(`phases/index.json`)의 status도 함께 되돌려야 한다.

## 진행 상태의 단일 출처

`phases/*/index.json`이다. `README.md`의 진행 표나 `docs/PROGRESS.md`가 이것과
어긋나면 그쪽이 틀린 것이다.

`docs/*.md`에 실행 로그나 체크리스트를 쌓지 마라 — `execute.py`가 매 step 프롬프트에
`docs/*.md` 전문을 싣기 때문에, 분량이 그대로 모든 step의 비용이 된다.
