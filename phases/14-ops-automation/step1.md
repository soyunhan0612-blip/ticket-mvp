# Step 1: alerts-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "보안 규약"의 쿠키 절과 "n8n 자격증명" 절
- `/docs/ADR.md` — ADR-007. 특히 운영 라우트가 `userId` 쿠키를 검사하지 않는 이유와 그 트레이드오프
- `/src/lib/sellout-alert.ts` — **step 0에서 생성됨.** `SELLOUT_RISK_THRESHOLD`, `selectSelloutRiskRows`, `buildSelloutAlertText`
- `/src/lib/sellout-alert.test.ts` — **step 0에서 생성됨.** 픽스처 형태
- `/src/app/api/admin/operations/route.ts` — **이 step이 그대로 따를 원본.** 전체가 28줄이다. zod 쿼리 파싱(6~9행), 400 분기(18~20행), `collectOperations` 주입(22~25행), 응답(27행)
- `/src/app/api/admin/operations/route.test.ts` — 이 저장소의 운영 라우트 테스트 방식. 실제 메모리 스토어로 픽스처를 만든다
- `/src/lib/basic-auth.ts` — `isAdminApiPath`. 새 라우트가 왜 자동으로 게이트 뒤에 들어가는지
- `/src/lib/operations.ts` — `collectOperations`와 `OperationsFilter`(16~19행)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0이 판정 함수를 만들었다. **부르는 곳이 없다.** 이 step이 n8n이 호출할 엔드포인트로 노출한다.

n8n은 저장소 밖에서 스케줄로 돈다. 그래서 이 라우트는 사람이 쓰는 화면용 API와 조건이 다르다.

- **쿠키가 없다.** n8n은 `Authorization: Basic` 헤더만 보낸다
- **주기적으로 반복 호출한다.** 사람의 버튼 클릭이 아니다
- **응답을 그대로 사람에게 전달한다.** Slack 메시지가 되므로 형식이 계약이다

## 작업

`src/app/api/admin/alerts/sellout/route.ts`를 만든다.

```
GET /api/admin/alerts/sellout?threshold=90&showId=...&date=...

200 응답 바디:
{
  "threshold": number,
  "sessions": OperationsRow[],   // 임계값 이상, 판매율 내림차순
  "text": string                 // 보낼 문장. 대상이 없으면 빈 문자열
}
```

`sessions`와 `text`를 **둘 다** 내보낸다. n8n이 준비된 문장을 그대로 쓸 수도 있고, 수치로 자기 조건을 더 걸 수도 있어야 한다. 문장만 주면 후자가 막히고, 수치만 주면 문구 생성이 n8n 안으로 새어 나가 테스트가 닿지 않는다.

### 조립

`operations/route.ts`의 형태를 그대로 따른다 — zod로 쿼리를 파싱하고, 실패면 400, 성공이면 `collectOperations`에 필터를 넘긴다. 그 결과를 `selectSelloutRiskRows` → `buildSelloutAlertText`에 통과시킨다.

`threshold` 쿼리:

- 숫자로 파싱한다. 쿼리스트링은 항상 문자열이므로 zod의 강제 변환을 쓴다
- 범위는 **0 이상 100 이하**다. 판매율이 백분율이므로 그 밖의 값은 의미가 없다
- 생략하면 `SELLOUT_RISK_THRESHOLD`를 쓴다. 라우트에 `90`을 리터럴로 적지 마라
- 범위를 벗어나거나 숫자가 아니면 **400**

`showId`·`date`는 `operations/route.ts`의 스키마를 그대로 쓴다. `showId`의 정규식 제약도 유지한다.

### 인증 코드를 두지 않는다

`isAdminApiPath`가 `/api/admin/` 이하를 **모든 메서드에 대해** 게이트하므로 이 라우트는 자동으로 Basic 게이트 뒤에 들어간다.

**`getUserIdFromRequest`로 401을 내지 마라.** 미들웨어의 `withUserIdCookie`는 익명 UUID를 **응답에만** 싣는다. 쿠키를 보관하지 않고 `Authorization: Basic`만 보내는 호출자 — 정확히 n8n의 스케줄 실행 — 는 매번 401을 맞는다. 이것이 ADR-007이 운영 라우트에서 쿠키 검사를 뺀 이유다.

### 레이트리밋을 걸지 않는다

AI 라우트(`/api/ai/description`, `/api/admin/ai-summary`, `/api/admin/agent`)에는 IP당 분당 3회 제한이 있다. 그 근거는 **모델 호출 비용**이다.

이 라우트는 모델을 부르지 않는다. 대신 n8n이 스케줄로 주기 호출하는 것이 정상 동작이므로, 제한을 걸면 그 스케줄을 막는다. 같은 이유로 `/api/admin/operations`에도 제한이 없다 — 그 라우트와 일관되게 둔다.

### TDD 순서

`src/app/api/**/route.ts`는 TDD 가드 구간이다. `src/app/api/admin/alerts/sellout/route.test.ts`를 **반드시 먼저** 작성한다.

테스트 케이스:

1. `threshold` 미지정이면 `SELLOUT_RISK_THRESHOLD`가 응답의 `threshold`에 실린다
2. 임계값 이상인 회차만 `sessions`에 담기고 판매율 내림차순이다
3. 대상이 없으면 `sessions`가 빈 배열이고 `text`가 빈 문자열이다
4. `threshold`가 숫자가 아니거나 0 미만·100 초과면 400
5. `showId` 필터가 결과에 반영된다
6. 응답 어디에도 `userId`가 없다
7. **쿠키 없이 호출해도 401이 아니다** (n8n 경로)

픽스처는 `src/app/api/admin/operations/route.test.ts`가 `getShowStore().create(...)`와 `getSeatStore().hold(...)`/`confirmSeats(...)`로 좌석 상태를 만드는 방식을 따른다. `vitest.setup.ts`가 Upstash 환경변수를 지우므로 항상 메모리 스토어가 돈다.

임계값을 넘기려면 판매율이 높아야 한다. 픽스처에서 `presetId`가 있는 공연을 만들고 좌석을 충분히 확정하거나, 낮은 `threshold`를 넘겨 검증한다 — **어느 쪽이든 좋으나 테스트가 임계값 경계를 실제로 넘나들게 만들어라.**

## Acceptance Criteria

```bash
npm run test && npm run lint
```

라우트를 새로 추가하므로 프로덕션 컴파일까지 확인한다:

```bash
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트가 `/api/admin/` 아래에 있는가?
   - `getUserIdFromRequest`로 401을 내는 코드가 없는가?
   - 레이트리밋을 걸지 않았는가?
   - 임계값 기본값이 `SELLOUT_RISK_THRESHOLD`이고 리터럴 `90`이 라우트에 없는가?
   - 판정·문구 생성이 `src/lib/sellout-alert.ts`에 있고 라우트에 복제되지 않았는가?
   - `package.json`이 무수정인가?
3. 결과에 따라 `phases/14-ops-automation/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **엔드포인트 경로, 쿼리 파라미터와 각 제약, 응답 바디의 키 세 개, 기본 임계값**을 적어라. step 2의 워크플로 문서가 이 계약을 그대로 인용한다.

## 금지사항

- `getUserIdFromRequest`로 401을 내지 마라. 이유: `withUserIdCookie`가 익명 UUID를 응답에만 싣기 때문에, 쿠키 없이 Basic 헤더만 보내는 n8n은 매번 401을 맞는다. 신원 확인은 미들웨어 게이트가 전담한다(ADR-007).
- 레이트리밋을 걸지 마라. 이유: 모델 호출이 없어 비용 근거가 없고, n8n의 스케줄 호출이 정상 동작인데 제한이 그것을 막는다. 같은 이유로 `/api/admin/operations`에도 제한이 없다.
- 이 라우트를 `/api/ai/` 아래에 만들지 마라. 이유: 미들웨어가 게이트하는 API는 `/api/admin` 이하와 `/api/shows`의 쓰기뿐이다. `/api/ai/description`이 무인증 공개인 것은 공연 설명 생성이라 감수한 것이고, 매출·재고에는 적용되지 않는다.
- 판정 조건이나 알림 문구를 라우트에 다시 쓰지 마라. 이유: step 0이 그것을 순수 함수로 뽑은 이유가 테스트가 닿게 하려는 것이다. 라우트에 복제하면 두 벌이 되고 한쪽만 고쳐진다.
- `sessions`나 `text` 중 하나만 내보내지 마라. 이유: 문장만 주면 n8n이 수치로 조건을 더 걸 수 없고, 수치만 주면 문구 생성이 저장소 밖으로 새어 테스트가 닿지 않는다.
- 응답에 다른 사용자의 `userId`를 싣지 마라. 이유: 인증이 없는 구조라 익명 UUID가 곧 신원이다. 운영 응답은 집계 수치만 내보낸다.
- `src/lib/sellout-alert.ts`를 고치지 마라. 이유: step 0의 산출물이고 이 step은 조립만 한다. 고쳐야 할 이유가 보이면 그 자체가 설계 모순이므로 `blocked`로 표시하라.
- 이 step에서 n8n 파일이나 Admin 화면을 만들지 마라. 이유: 워크플로는 step 2이고, 이 알림은 애초에 화면이 아니라 Slack으로 간다.
- Slack Webhook URL이나 자격증명을 코드·환경변수 예시에 넣지 마라. 이유: 그 값은 n8n 자격증명 저장소에만 둔다. 저장소에 들어가면 회전 외에는 되돌릴 방법이 없다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
