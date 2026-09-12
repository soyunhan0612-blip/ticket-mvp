# Ticket MVP 저장소 지침

## 프로젝트

- `docs/PRD.md`에 설명된 티켓 예매 MVP를 구현한다.
- Next.js, TypeScript 엄격 모드, Tailwind CSS, TanStack Query, Jotai, Vitest를 사용한다.
- `docs/ARCHITECTURE.md`에 정의된 RSC/클라이언트 경계와 저장소 인터페이스를 유지한다. 그 설계 근거는 `docs/ADR.md`에 있다.
- 시각적 요소에 관한 결정은 `docs/UI_GUIDE.md`(스타일)와 `docs/UX_PRINCIPLES.md`(원칙·화면 매핑)를 최종 기준으로 삼는다.

## 아키텍처

- 라우트는 `src/app/api/`, 재사용 가능한 UI는 `src/components/`, 순수 로직은 `src/lib/`, 인터페이스로 추상화한 영속성 구현은 `src/services/`, 공유 타입은 `src/types/` 아래에 둔다.
- 예외는 하나다. **다른 프로젝트로 폴더째 이식하는 모듈**은 `src/chatbot/`처럼 자기 완결적인 최상위 디렉터리에 둔다. 그 안에서 도메인을 모르는 부분(`core/`)과 이 프로젝트 전용 어댑터(`adapters/`)를 나누고, 도메인 import가 없다는 것을 테스트로 고정한다. 근거는 `docs/ADR.md`의 ADR-008.
- 익명 사용자 ID는 서버가 발급한 HTTP-only 쿠키에서만 읽는다. 요청 본문이나 쿼리 문자열로는 절대 받지 않으며, 응답에 다른 사용자의 ID를 절대 노출하지 않는다.
- 좌석 수 제한, 좌석 ID 유효성, 홀드 소유권, 만료 여부, 예약 소유권을 서버에서 검증하고 강제한다.
- 여러 좌석의 홀드, 확정, 취소 작업은 모두 성공하거나 모두 실패해야 한다. Redis 구현에서는 원자적 Lua 스크립트를 사용해야 한다.
- AI 또는 Redis 자격 증명을 `NEXT_PUBLIC_*` 변수로 절대 노출하지 않는다.
- 생성된 설명은 일반 텍스트로 렌더링한다. `dangerouslySetInnerHTML`을 사용하지 않는다.

## 개발 워크플로

- `src/lib/`, `src/services/`, `src/app/api/**/route.ts` 아래의 파일에는 TDD를 적용한다. 구현 전에 해당 테스트를 먼저 추가한다.
- 작업 트리에 있는 사용자의 관련 없는 변경 사항을 보존한다.
- 사용자가 커밋을 요청하면 Conventional Commits 형식의 커밋 메시지를 사용한다.
- 사용자가 명시적으로 요청하지 않는 한 `docs/PRD.md`에서 범위 밖으로 분류한 기능을 추가하지 않는다.

## 에이전트 역할

- Claude: 명세(`phases/*/step*.md`, `docs/`)를 설계하고 완료된 단계를 검토하며 비정기 리팩터링을 처리한다. 하네스 루프는 실행하지 않는다.
- Codex: `scripts/execute.py`를 통해 호출되어 각 단계의 명세를 구현한다. 명세를 정확히 준수하며, 명세가 모호하거나 서로 모순되면 추측하지 않고 해당 단계를 `blocked`로 표시한다.
- 두 에이전트는 `scripts/hooks/` 아래의 훅 스크립트를 공유한다(아래 참조).

## 에이전트 훅

- Claude Code는 `.claude/settings.json`을 사용하고 Codex는 `.codex/hooks.json`을 사용한다.
- Codex는 위험 명령 검사, TDD 가드, Stop 검증 게이트를 `scripts/hooks/` 아래의 개별 스크립트에 위임한다.
- 두 에이전트 모두 `package.json`이 생기기 전까지 TDD와 Stop 검증을 건너뛴다. 스캐폴딩이 끝나면 Stop 게이트가 `npm run lint`와 `npm run test`를 실행한다. 프로덕션 빌드는 배포 또는 설정 시 명시적으로 검사한다.
- Codex 훅 스크립트는 Node 기반이므로 Windows와 Unix에서 동일한 정책이 적용된다. 훅을 사용하기 전에 Codex에서 저장소 훅을 한 번 검토하고 신뢰하도록 설정한다.

## 검증

- 구현 중에는 관련된 최소 범위의 테스트부터 실행한다.
- 완료한 코드 변경을 인계하기 전에 `package.json`이 있으면 `npm run lint`와 `npm run test`를 실행한다.
- 배포 전이나 변경 사항이 프로덕션 컴파일, 라우팅 또는 설정에 영향을 줄 때는 `npm run build`를 실행한다.

## 코드 리뷰 규칙

- 여러 좌석 중 일부만 홀드되는 문제, 클라이언트가 제공하는 사용자 식별 정보, 사용자 ID 유출, 소유권 검사 누락, 클라이언트에서만 수행하는 좌석 검증, 비원자적 예약 상태 전환은 차단 이슈로 표시한다.
- 스냅샷 버전이나 개별 좌석 상태가 바뀌지 않았는데도 2,000개의 좌석 atom을 모두 교체하는 폴링 코드는 문제로 표시한다.
