@AGENTS.md

# 프로젝트: 티켓 예매 MVP

포트폴리오용 티켓링크형 예매 서비스. 핵심 여정(공연 목록 → 회차 → 좌석 선택 → 예매/취소, 셀러 등록 + AI 설명)을 10일 MVP로 구현. **좌석 선택 화면이 시각적·기술적 시그니처**다.

## 기술 스택
- Next.js 15 (App Router, RSC)
- TypeScript strict mode
- Tailwind CSS
- Tanstack Query (서버 상태, 3초 폴링, 낙관적 업데이트)
- Jotai (atomFamily로 좌석 구독 격리)
- vitest (TDD)
- Upstash Redis (Day 9 영속화)

## 아키텍처 규칙
- CRITICAL: 모든 API 로직은 `app/api/**/route.ts`에서만 처리. 클라이언트 컴포넌트에서 외부 API 직접 호출 금지
- CRITICAL: `userId`는 쿠키에서만 읽는다. 요청 바디·쿼리스트링에서 절대 받지 않는다 (IDOR)
- CRITICAL: 응답에 남의 `userId`를 절대 싣지 않는다. 폴링 스냅샷은 서버가 쿠키와 비교해 `mine: boolean`으로 환원해 내려보낸다
- CRITICAL: 좌석 규칙(최대 매수 4석, 좌석 ID 유효성)은 서버에서도 재검증한다 — `lib/seat-rules.ts`, `lib/seat-map.ts`를 route handler에서 호출
- CRITICAL: `NEXT_PUBLIC_` 접두사를 AI 키·Upstash 토큰에 절대 붙이지 않는다 (브라우저 번들에 평문 유출)
- CRITICAL: `release`/`confirm`은 소유권 검증 필수. 좌석 소유자와 쿠키 `userId` 불일치 시 403
- CRITICAL: 좌석 페이지에 `export const dynamic = 'force-dynamic'`. 없으면 RSC 결과가 캐시돼 옛 좌석 스냅샷을 보게 된다
- CRITICAL: 셀러 등록 설명은 **plain text + `whitespace-pre-wrap`**. `dangerouslySetInnerHTML` 금지 (저장형 XSS 방어)
- 순수 로직은 `lib/`, Store 구현체는 `services/`, UI는 `components/`, 타입은 `types/`
- Store 구현체는 팩토리로 교체 (memory ↔ redis). API route는 인터페이스만 참조

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- `tdd-guard` 훅이 `lib/`, `services/`, `app/api/**/route.ts` 편집을 테스트 선행 없이 차단한다. `components/`, `page.tsx`, `layout.tsx`, `types/`, 설정 파일은 통과. 훅과 싸우지 말고 순서를 지킨다
- 커밋 메시지는 conventional commits 형식 (feat:, fix:, docs:, refactor:)
- **Day 3의 순진한 좌석 구현은 반드시 별도 커밋으로 남긴다** — 성능 before/after 서사의 증거. 없으면 서사가 통째로 증발한다

## Claude/Codex 훅

- Claude Code는 `.claude/settings.json`, Codex는 `.codex/hooks.json`을 사용하며 **두 에이전트가 `scripts/hooks/` 아래의 동일한 Node 스크립트를 공유**한다. 파일명이 `codex-*`로 시작하는 것은 초기 구현 순서일 뿐 Codex 전용이 아니다.
- 훅은 위험 명령 차단(`codex-block-dangerous.cjs`), TDD 가드(`codex-tdd-guard.cjs`), Stop 검증 게이트(Codex: `codex-verify-gate.cjs` / Claude: `claude-verify-gate.cjs` — 종료 코드 규약만 다르고 검사 로직은 동일)로 분리한다. Windows와 Unix에서 동일하게 동작하도록 Node로 구현한다.
- `package.json`이 생기기 전에는 TDD와 Stop 검증을 건너뛴다. 스캐폴딩 이후 Stop 훅은 `npm run lint`와 `npm run test`만 실행하며, `npm run build`는 배포 또는 라우팅·설정 변경 시 명시적으로 실행한다.
- Codex에서는 저장소 훅을 최초 1회 review & trust 해야 한다.
- `scripts/execute.py`의 테스트는 `python -m pytest scripts/test_execute.py`로 돈다. vitest도 `pnpm test:hooks`도 이것을 수집하지 않으므로 CI에 별도 스텝이 있다.
- 훅 스크립트의 테스트는 `pnpm test:hooks`로 돈다. vitest의 `include`가 `src/**`뿐이라 `pnpm test`는 이것을 수집하지 않는다. CI에서 별도 스텝으로 실행하며, Stop 훅에는 넣지 않는다 (매 정지마다 도는 비용이 이득보다 크다).

## 에이전트 자산 (Claude Code 전용)

Codex는 이 자산들을 보지 못한다. `execute.py`가 띄우는 세션은 `.codex/hooks.json`과 `scripts/hooks/`만 쓴다.

- `.claude/agents/critical-rules-auditor.md` — 위 CRITICAL 규칙과 `AGENTS.md` 차단 이슈를 코드에서 검사. `src/lib/`·`src/services/`·`src/app/api/`를 건드린 변경 후에 돌린다
- `.claude/agents/docs-drift-detector.md` — 코드와 `docs/ARCHITECTURE.md`·`ADR.md`·`README.md` 진행표의 불일치를 찾는다. 문서를 직접 고치지는 않는다. 이미 연기하기로 한 항목은 호출할 때 알려준다
- `.claude/agents/harness-preflight.md` — `execute.py` 실행 직전에 명세의 줄 번호 참조·가드레일 문서와 코드의 모순·외부 API 계약을 확인한다. step당 최대 30분 × 3회 재시도라 사전 점검이 훨씬 싸다
- `.claude/skills/harness-spec/` — step 명세 설계 7원칙과 `stepN.md`·`index.json` 템플릿
- `.claude/skills/live-ai-check/` — AI 라우트를 실제 Anthropic API로 검증하는 절차. 이 저장소는 SDK를 목킹하지 않아 `toolRunner` 경로의 자동 커버리지가 구조적으로 0이다
- `.claude/commands/harness.md` — `execute.py` 실행법과 `error`/`blocked` 복구 절차
- `.claude/commands/review.md` — 위 서브에이전트 두 개를 병렬로 돌려 결과를 합친다

## 이 머신의 환경 함정

- `pnpm`과 `python3`가 PATH에 없다. 검증은 `npm run ...`, 하네스는 `python`으로 실행한다
- heredoc을 지나는 백슬래시 이스케이프(`\n` 등)가 실제 개행이 되어 파일을 깨뜨린다. 템플릿 리터럴을 쓰거나 `chr(92)`로 우회한다
- 파일마다 줄바꿈이 CRLF와 LF로 갈린다. 문자열 치환 전에 확인하지 않으면 앵커가 조용히 빗나간다
- Windows `python`은 `/tmp` 경로를 읽지 못한다. 임시 파일은 저장소 안이나 Windows 경로에 만든다

## 명령어
```
pnpm dev      # 개발 서버
pnpm build    # 프로덕션 빌드 (배포 직전 수동)
pnpm lint     # ESLint
pnpm test     # 테스트 (Stop 훅에서 자동)
pnpm test:hooks  # 훅 스크립트 테스트 (CI에서 별도 스텝)
python -m pytest scripts/test_execute.py   # 하네스 테스트 (CI에서 별도 스텝)
```

패키지 매니저는 pnpm으로 고정한다 (`package.json`의 `packageManager`). Stop 훅 스크립트는 `npm run lint`/`npm run test`를 그대로 호출하는데, pnpm이 만든 `node_modules/.bin`에서도 동일하게 동작하므로 훅은 바꾸지 않는다.
