이 프로젝트는 Harness 프레임워크를 사용한다 — `scripts/execute.py`가 각 step 명세를 독립된 Codex 세션에 던져 순차 구현한다.

## 명세 작성

`harness-spec` 스킬을 사용한다. 설계 7원칙, `stepN.md` 템플릿, `index.json` 스키마가
거기에 있다. "step 명세 써줘", "phase 추가하자" 같은 요청이면 자동으로 로드된다.

## 실행 전 점검

`harness-preflight` 서브에이전트를 먼저 돌린다. `execute.py`는 step당 최대 30분에 3회
재시도라, 잘못된 전제로 출발하는 비용이 점검 비용보다 훨씬 크다. 특히 명세가 인용한
줄 번호가 코드와 어긋났거나, `docs/*.md`의 단정형 문장이 직전 step 산출물과 모순되면
Codex가 `blocked`로 멈춘다 — 그 문서들은 매 step 프롬프트에 전문이 실린다.

## 실행

이 머신의 Git Bash에는 `python3`가 없다. `python`으로 읽는다.

```bash
python3 scripts/execute.py {phase}          # 순차 실행
python3 scripts/execute.py {phase} --once   # pending step 하나만 실행하고 종료
python3 scripts/execute.py {phase} --push   # 실행 후 push
```

`--once`는 step 하나를 끝내면 멈춘다. 같은 명령을 다시 실행하면 다음 pending step으로
이어지고, 마지막 step을 끝냈을 때만 phase가 `completed`로 마감된다 — 따라서 `--push`도
그때만 발동한다. step마다 결과를 검토하고 넘어갈 때 쓴다.

execute.py가 자동으로 하는 것:

- `feat-{phase}` 브랜치 생성·checkout
- 가드레일 주입 — `AGENTS.md`와 `docs/*.md`를 매 step 프롬프트에 포함
  (**`CLAUDE.md`는 실리지 않는다** — CRITICAL 규칙은 명세 본문에 직접 적어야 한다.
  `execute.py`의 `GUARDRAIL_DOC_EXCLUDE`에 든 문서도 빠진다)
- 컨텍스트 누적 — 완료된 step의 `summary`를 다음 step 프롬프트에 전달
- 자가 교정 — 실패 시 최대 3회 재시도하며 직전 에러를 프롬프트에 피드백
- 2단계 커밋 — 코드 변경(`feat`)과 메타데이터(`chore`)를 분리
- 타임스탬프 자동 기록 (KST)

시작 전 검사: 워크트리가 깨끗해야 하고, `error`·`blocked` step이 남아 있으면
실행을 거부한다(각각 exit 1, exit 2).

## 복구

**error** — `phases/{phase}/index.json`에서 해당 step의 `status`를 `"pending"`으로
바꾸고 `error_message`를 삭제한 뒤 재실행한다.

**blocked** — `blocked_reason`에 적힌 사유를 해결한 뒤, `status`를 `"pending"`으로
바꾸고 `blocked_reason`을 삭제한 뒤 재실행한다.

`phases/index.json`의 phase 레벨 status도 함께 되돌린다.

## 실행 후

`/review`로 CRITICAL 규칙과 문서 정합성을 확인한다.
