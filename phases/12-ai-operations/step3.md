# Step 3: admin-ops-panel

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "테스트·검증 규약"의 UI 제약
- `/docs/UI_GUIDE.md` — AI 슬롭 안티패턴, 색·타이포·컴포넌트 규칙
- `/docs/UX_PRINCIPLES.md` — 로딩·에러 표현 원칙
- `/docs/PRD.md` — 3대 함정
- `/src/app/admin/page.tsx` — 이 화면에 패널을 더한다
- `/src/app/admin/page.test.tsx` — 기존 테스트 패턴
- `/src/components/admin/OccupancyStats.tsx` — 같은 화면의 기존 컴포넌트 스타일
- `/src/components/seller/AiDescriptionGenerator.tsx` — 이 프로젝트가 AI 스트리밍 응답을 화면에 붙이는 기존 방식
- `/src/app/api/admin/ai-summary/route.ts` — Step 2에서 만든 엔드포인트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

Admin 화면에 AI 운영 요약 패널을 더한다. 버튼 하나와 결과 영역이면 충분하다. 채팅 UI를 만들지 않는다.

- 컴포넌트는 `src/components/admin/`에 새로 만들고 `src/app/admin/page.tsx`에서 조립한다
- 현재 선택된 `showId`/`sessionId` 맥락을 필터로 넘긴다
- 버튼을 누르면 `POST /api/admin/ai-summary`를 호출하고, 스트리밍 응답을 받는 대로 이어 붙여 보여 준다
- 결과는 **plain text**로 렌더하고 `whitespace-pre-wrap`으로 줄바꿈을 살린다
- 상태 세 가지를 모두 다룬다: 대기(요청 전), 진행 중(버튼 비활성 + 진행 표시), 실패(그 영역 안의 오류 메시지 + 재시도)

### 장애 격리

**AI 패널의 실패가 기존 점유 현황을 건드리면 안 된다.** 별도 상태로 관리하고, 기존 `useQuery`와 공유하지 않는다. AI 요청이 실패해도 좌석맵과 집계 수치는 그대로 보여야 한다.

### 테스트

`src/app/admin/page.test.tsx`(또는 새 컴포넌트의 테스트 파일)에 다음을 더한다.

1. 버튼을 누르면 요약 요청이 나간다
2. 스트리밍 텍스트가 화면에 누적돼 표시된다
3. 요청이 실패해도 기존 점유 현황 영역이 그대로 렌더된다
4. 진행 중에는 버튼이 비활성화된다

`components/`와 `page.tsx`는 TDD 가드 밖이지만, 테스트는 같은 step에서 함께 낸다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 결과가 plain text + `whitespace-pre-wrap`으로 렌더되는가? `dangerouslySetInnerHTML`이 없는가?
   - 차트나 그래프를 그리는 코드·의존성이 없는가?
   - AI 영역의 오류가 좌석맵·집계 렌더를 막지 않는가?
   - `docs/UI_GUIDE.md`의 색·타이포 토큰을 쓰는가? 임의 색상을 넣지 않았는가?
3. 결과에 따라 `phases/12-ai-operations/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 차트 라이브러리를 추가하지 마라. 이유: `docs/PRD.md`의 3대 함정 2번이다. 번들만 키우고 좌석맵 재사용보다 약하다.
- "Powered by AI" 배지, 반짝이·마법봉 아이콘, 보라/인디고 그라데이션을 넣지 마라. 이유: `docs/UI_GUIDE.md`가 AI 슬롭 안티패턴으로 금지한다. 기능이 아니라 장식이다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 모델 출력과 셀러 입력이 섞인 텍스트다. plain text 렌더가 저장형 XSS 방어선이다.
- AI 요약 상태를 기존 점유 현황 `useQuery`에 합치지 마라. 이유: AI가 실패하면 좌석 현황까지 같이 사라진다. 장애 격리가 이 phase의 전제다.
- 채팅 히스토리·멀티턴 대화를 만들지 마라. 이유: 이 step은 버튼 하나짜리 요약이다. 대화형 Agent는 다음 phase의 범위다.
- 클라이언트에서 Anthropic API를 직접 호출하지 마라. 이유: 모든 AI 호출은 route handler를 거친다. 키가 브라우저로 나간다.
- 기존 테스트를 깨뜨리지 마라.
