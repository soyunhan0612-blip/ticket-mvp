# 훅 스크립트 (Claude/Codex 공용)

- Claude Code는 `.claude/settings.json`, Codex는 `.codex/hooks.json`을 사용하며 **두 에이전트가 `scripts/hooks/` 아래의 동일한 Node 스크립트를 공유**한다. 파일명이 `codex-*`로 시작하는 것은 초기 구현 순서일 뿐 Codex 전용이 아니다.
- 훅은 위험 명령 차단(`codex-block-dangerous.cjs`), TDD 가드(`codex-tdd-guard.cjs`), Stop 검증 게이트(Codex: `codex-verify-gate.cjs` / Claude: `claude-verify-gate.cjs` — 종료 코드 규약만 다르고 검사 로직은 동일)로 분리한다. Windows와 Unix에서 동일하게 동작하도록 Node로 구현한다.
- `package.json`이 생기기 전에는 TDD와 Stop 검증을 건너뛴다. 스캐폴딩 이후 Stop 훅은 `npm run lint`와 `npm run test`만 실행하며, `npm run build`는 배포 또는 라우팅·설정 변경 시 명시적으로 실행한다.
- Codex에서는 저장소 훅을 최초 1회 review & trust 해야 한다.
- `scripts/execute.py`의 테스트는 `python -m pytest scripts/test_execute.py`로 돈다. vitest도 `pnpm test:hooks`도 이것을 수집하지 않으므로 CI에 별도 스텝이 있다.
- 훅 스크립트의 테스트는 `pnpm test:hooks`로 돈다. vitest의 `include`가 `src/**`뿐이라 `pnpm test`는 이것을 수집하지 않는다. CI에서 별도 스텝으로 실행하며, Stop 훅에는 넣지 않는다 (매 정지마다 도는 비용이 이득보다 크다).
