@AGENTS.md

# 프로젝트: 티켓 예매 MVP

포트폴리오용 티켓링크형 예매 서비스. 핵심 여정(공연 목록 → 회차 → 좌석 선택 → 예매/취소, 셀러 등록 + AI 설명)을 10일 MVP로 구현. **좌석 선택 화면이 시각적·기술적 시그니처**다.

## 아키텍처 규칙
- CRITICAL: 모든 API 로직은 `app/api/**/route.ts`에서만 처리. 클라이언트 컴포넌트에서 외부 API 직접 호출 금지
- CRITICAL: `userId`는 쿠키에서만 읽는다. 요청 바디·쿼리스트링에서 절대 받지 않는다 (IDOR)
- CRITICAL: 응답에 남의 `userId`를 절대 싣지 않는다. 폴링 스냅샷은 서버가 쿠키와 비교해 `mine: boolean`으로 환원해 내려보낸다
- CRITICAL: 좌석 규칙(최대 매수 4석, 좌석 ID 유효성)은 서버에서도 재검증한다 — `lib/seat-rules.ts`, `lib/seat-map.ts`를 route handler에서 호출
- CRITICAL: `NEXT_PUBLIC_` 접두사를 AI 키·Upstash 토큰에 절대 붙이지 않는다 (브라우저 번들에 평문 유출)
- CRITICAL: `release`/`confirm`은 소유권 검증 필수. 좌석 소유자와 쿠키 `userId` 불일치 시 403
- CRITICAL: 좌석 페이지에 `export const dynamic = 'force-dynamic'`. 없으면 RSC 결과가 캐시돼 옛 좌석 스냅샷을 보게 된다
- CRITICAL: 셀러 등록 설명은 **plain text + `whitespace-pre-wrap`**. `dangerouslySetInnerHTML` 금지 (저장형 XSS 방어)
- Store 구현체는 팩토리로 교체 (memory ↔ redis). API route는 인터페이스만 참조

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- `tdd-guard` 훅이 `lib/`, `services/`, `app/api/**/route.ts` 편집을 테스트 선행 없이 차단한다. `components/`, `page.tsx`, `layout.tsx`, `types/`, 설정 파일은 통과. 훅과 싸우지 말고 순서를 지킨다
- 커밋 메시지는 conventional commits 형식 (feat:, fix:, docs:, refactor:)
- **Day 3의 순진한 좌석 구현은 반드시 별도 커밋으로 남긴다** — 성능 before/after 서사의 증거. 없으면 서사가 통째로 증발한다
- 훅 스크립트 자체의 규약은 `scripts/hooks/CLAUDE.md`에 있다 (그 디렉터리 작업 시 자동 로드)

## 에이전트 자산 (Claude Code 전용)

Codex는 이 자산들을 보지 못한다. `execute.py`가 띄우는 세션은 `.codex/hooks.json`과 `scripts/hooks/`만 쓴다.
각 자산의 용도는 정의 파일의 frontmatter에서 자동으로 로드된다. 거기 없는 것만 여기 적는다.

- `docs-drift-detector` — 문서를 직접 고치지는 않는다. 이미 연기하기로 한 항목은 호출할 때 알려준다
- `harness-preflight` — step당 최대 30분 × 3회 재시도라 사전 점검이 훨씬 싸다
- `live-ai-check` — 이 저장소는 SDK를 목킹하지 않아 `toolRunner` 경로의 자동 커버리지가 구조적으로 0이다

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
