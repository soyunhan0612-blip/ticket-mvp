# Step 2: n8n-workflow

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — "n8n 자격증명" 절, "키와 렌더링" 절, 그리고 로드맵 아래 "n8n은 저장소 밖 인프라다" 문단
- `/docs/ADR.md` — ADR-007의 트레이드오프 절. n8n이 쓰는 자격증명이 `/admin`·`/seller`와 **같은 단일 Basic 자격증명**이라는 서술
- `/docs/ARCHITECTURE.md` — "데이터 흐름" 절과 "보안 경계" 절. 이 step이 데이터 흐름에 한 블록을 더한다
- `/src/app/api/admin/alerts/sellout/route.ts` — **step 1에서 생성됨.** 쿼리 파라미터와 응답 바디가 워크플로의 계약이다
- `/src/lib/sellout-alert.ts` — **step 0에서 생성됨.** `SELLOUT_RISK_THRESHOLD`의 실제 값
- `/src/lib/mock-data.ts` — 시드 공연 8건. `presetId` 필드가 있는지 확인하라. 아래 "시드 데이터 전제"가 이것에 달려 있다
- `/README.md` — 심사자용 `curl -u` 예시가 있는 절. 문서 톤을 여기에 맞춘다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0이 판정 함수를, step 1이 `GET /api/admin/alerts/sellout`을 만들었다. **호출하는 곳이 없다.**

이 step은 코드를 만들지 않는다. n8n은 저장소 밖 인프라이고, 이 세션은 n8n 인스턴스에 접근할 수 없다. 그래서 산출물은 **재현 가능한 형태의 설정**이다.

계획 문서가 못박은 기준은 하나다 — **"재현할 수 없으면 포트폴리오가 아니다."** 워크플로 JSON export와 재현 절차를 커밋하되, 자격증명은 제외한다.

## 작업

`ops/n8n/` 아래에 두 파일을 만든다. **`docs/` 아래에 두지 마라** — `scripts/execute.py`가 `docs/*.md`를 매 step 프롬프트에 싣기 때문에, 운영 설정 문서가 이후 모든 step의 비용이 된다.

### `ops/n8n/sellout-alert.workflow.json`

n8n 워크플로 export 형식의 JSON. 노드 네 개다.

| 노드 | 역할 |
|---|---|
| Schedule Trigger | 주기 실행. 주기는 재량이되 문서에 적은 값과 일치시킨다 |
| HTTP Request | `GET {BASE_URL}/api/admin/alerts/sellout`. Basic 인증은 **자격증명 참조**로 건다 |
| IF | 응답의 `text`가 비어 있지 않을 때만 통과 |
| Slack (또는 HTTP Request) | Webhook으로 `text`를 보낸다 |

**IF 노드가 `text`의 길이를 보는 이유**: step 0이 "대상이 없으면 빈 문자열"로 정한 것이 이 분기를 위해서다. 판정은 이미 서버에서 끝났으므로 n8n이 판매율을 다시 비교하지 않는다.

JSON 안에 다음이 들어가면 안 된다. 대신 플레이스홀더를 쓰고 무엇을 채워야 하는지 README에 적는다.

- Basic 자격증명의 사용자명·비밀번호 (n8n의 credential 참조만 남긴다)
- Slack Webhook URL
- 실제 배포 도메인 — `{{BASE_URL}}` 같은 자리표시자로 둔다
- n8n 인스턴스 고유 id·실행 이력·`versionId` 등 재현에 불필요한 값

손으로 쓴 JSON이 n8n에 그대로 import되지 않을 수 있다. **그 가능성을 README에 명시하고, import 후 노드 파라미터를 확인하라고 적어라.** 검증되지 않은 것을 검증된 것처럼 쓰지 마라.

### `ops/n8n/README.md`

재현 절차. 아래를 담는다.

1. **무엇을 하는 워크플로인가** — 한 문단
2. **사전 준비** — n8n 인스턴스, 앱의 공개 URL, Basic 자격증명, Slack Webhook
3. **자격증명 설정** — n8n의 credential로 등록하는 절차. 값은 적지 않는다
4. **워크플로 가져오기** — JSON import와 그 뒤 확인할 것
5. **검증 방법** — 아래 "시드 데이터 전제"를 반드시 포함한다
6. **단일 자격증명의 위험** — ADR-007의 트레이드오프를 한 문단으로 옮긴다. n8n이 쓰는 값이 `/seller` 공연 등록까지 여는 같은 자격증명이며, 유출 시 회전이 유일한 대응이라는 사실

`curl` 예시를 하나 넣는다. n8n 없이도 엔드포인트가 사는지 확인할 수 있어야 한다. 형태는 `README.md`의 심사자용 예시를 따른다.

### 시드 데이터 전제 — 반드시 적는다

`docs/AI_OPERATIONS_EXPANSION_PLAN.md`가 경고한 지점이다. `src/lib/mock-data.ts`의 시드 공연에 `presetId`가 없으면 `total`이 항상 `TOTAL_SEATS`(2000)로 잡혀 **판매율이 1%도 나오지 않는다.** 기본 임계값 90으로는 시드 데이터에서 알림이 **영원히 발화하지 않는다.**

먼저 `mock-data.ts`를 읽어 이 전제가 지금도 참인지 확인하라. 참이라면 README의 검증 절차에 이렇게 적는다.

- 파이프라인이 도는지 확인할 때는 `?threshold=` 를 낮춰 호출한다
- **90은 실제 운영 값이고, 낮춘 값은 배선 확인용이다.** 둘을 섞어 쓰지 않는다
- 시드 판매율을 포트폴리오 서사의 수치로 인용하지 않는다

전제가 더는 참이 아니라면(시드에 `presetId`가 생겼다면) 그 사실을 적고 임계값을 낮추라는 안내는 빼라.

### `docs/ARCHITECTURE.md` 갱신

"데이터 흐름" 절에 n8n 경로를 **한 블록** 더한다. 기존 흐름도들과 같은 형식으로, 스케줄 → 알림 API → 집계 함수 → Slack까지가 드러나면 된다.

이 문서는 매 step 프롬프트에 실린다. **문장을 늘리지 말고 블록 하나만 더한다.**

## Acceptance Criteria

```bash
node -e "JSON.parse(require('fs').readFileSync('ops/n8n/sellout-alert.workflow.json','utf8'));console.log('workflow json ok')"
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트를 확인한다:
   - `ops/n8n/` 아래에 있고 `docs/` 아래가 아닌가?
   - JSON에 자격증명·Webhook URL·실제 도메인이 없는가? (`grep -riE "https://hooks|password|token" ops/n8n/` 로 확인하라)
   - README에 시드 데이터 전제와 임계값 구분이 적혀 있는가?
   - README에 단일 Basic 자격증명의 위험이 적혀 있는가?
   - `docs/ARCHITECTURE.md`에 블록 하나만 추가했고 기존 서술을 늘리지 않았는가?
   - `src/` 아래를 수정하지 않았는가?
   - `package.json`이 무수정인가?
3. 결과에 따라 `phases/14-ops-automation/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **생성한 파일 경로와 워크플로의 노드 구성, 그리고 사용자가 직접 해야 하는 일**을 적어라. 이 phase는 사람이 n8n에서 import·검증해야 끝난다.

## 금지사항

- 자격증명·Slack Webhook URL·실제 배포 도메인을 파일에 넣지 마라. 이유: 저장소에 들어간 비밀은 회전 외에 되돌릴 방법이 없고, 이 자격증명은 `/seller` 공연 등록까지 여는 값이다.
- `ops/n8n/`의 문서를 `docs/` 아래에 두지 마라. 이유: `scripts/execute.py`가 `docs/*.md`를 매 step 프롬프트에 싣는다. 운영 설정 문서가 이후 모든 step의 비용이 된다.
- 판매율 비교를 n8n의 IF 노드에 넣지 마라. 이유: 판정은 step 0의 순수 함수가 하고 테스트가 그것을 고정한다. n8n 안의 조건은 저장소의 어떤 검증도 받지 못한다.
- `src/` 아래를 수정하지 마라. 이유: 이 step은 저장소 밖 인프라의 설정을 다룬다. 앱 코드를 고쳐야 할 이유가 보이면 그 자체가 step 1과의 계약 불일치이므로 `blocked`로 표시하라.
- import되는 것을 확인했다고 쓰지 마라. 이유: 이 세션은 n8n 인스턴스에 접근할 수 없다. 검증하지 않은 것을 검증했다고 적으면 재현 절차 전체의 신뢰가 무너진다.
- 시드 데이터의 판매율을 성과 수치처럼 적지 마라. 이유: 시드 공연에 `presetId`가 없어 분모가 2000으로 고정된 값이다. 실측이 아니다.
- 새 의존성을 추가하지 마라. n8n은 저장소 밖에서 돈다.
- 기존 테스트를 깨뜨리지 마라.
