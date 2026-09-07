# Step 0: seat-stats

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/AI_OPERATIONS_EXPANSION_PLAN.md` — 이 phase 전체의 경계 규약
- `/docs/ARCHITECTURE.md` — 데이터 흐름, Store 인터페이스, 폴링 페이로드
- `/src/app/api/admin/stats/route.ts` — 추출 대상. 집계가 라우트 안에 인라인으로 들어 있다
- `/src/app/api/admin/stats/route.test.ts` — 그 동작을 고정하고 있는 기존 테스트 10개
- `/src/lib/seat-preset.ts` — `getPreset`, `SeatPresetId`, 프리셋별 `totalSeats`/`sections`
- `/src/lib/seat-map.ts` — `parseSeatId`, `SECTIONS`, `TOTAL_SEATS`
- `/src/types/index.ts` — `SeatSnapshot`, `SeatSnapshotEntry`

## 작업

`src/app/api/admin/stats/route.ts`가 라우트 안에서 직접 수행하는 좌석 집계를 `src/lib/seat-stats.ts`의 순수 함수로 추출하고, 기존 라우트가 그 함수를 호출하도록 바꾼다.

**이 step은 순수 리팩터링이다. `/api/admin/stats`의 응답은 한 필드도 달라지지 않아야 한다.**

### export할 시그니처

```ts
import type { SeatSnapshot } from "@/types";
import type { SeatPresetId } from "@/lib/seat-preset";

export interface SeatStats {
  total: number;
  available: number;
  held: number;
  sold: number;
}

export function computeSeatStats(
  seats: SeatSnapshot["seats"],
  presetId?: SeatPresetId,
): SeatStats;
```

동작은 현재 라우트와 동일해야 한다:

- `presetId`가 있으면 `getPreset(presetId).totalSeats`가 `total`, 없으면 `TOTAL_SEATS`
- 집계 대상 섹션은 프리셋의 `sections`, 프리셋이 없으면 `SECTIONS` 전체
- `parseSeatId`로 파싱되지 않거나 대상 섹션 밖인 좌석 ID는 **건너뛴다**. 좌석 ID는 전역 A~D 맵으로 검증되므로 한 세션이 자기 프리셋 밖 좌석을 가질 수 있고, 그것을 프리셋 크기의 `total`에서 빼면 `available`이 음수로 내려간다
- `available = total - held - sold`

`SeatSnapshot.seats`는 held/sold만 담는 sparse map이다. available 좌석은 키 자체가 없으므로 뺄셈으로 구한다.

I/O를 하지 않는다. Store도 `next/*`도 import하지 않는다.

### TDD 순서

`src/lib/seat-stats.test.ts`를 **반드시 먼저** 작성한다. `src/lib/`은 TDD 가드 구간이라 테스트 없이는 편집이 차단된다.

테스트 케이스:

1. 빈 스냅샷이면 `held = 0`, `sold = 0`, `available = total`
2. held 좌석을 세고 available에서 뺀다
3. sold 좌석을 센다
4. 프리셋 밖 섹션의 좌석은 세지 않는다
5. 프리셋 밖 좌석이 held여도 `available`이 음수가 되지 않는다
6. `presetId`가 없으면 `TOTAL_SEATS`와 전체 섹션을 기준으로 센다
7. 파싱되지 않는 좌석 ID는 무시한다

그다음 `computeSeatStats`를 구현하고, 마지막에 `src/app/api/admin/stats/route.ts`를 이 함수 호출로 교체한다.

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `seat-stats.ts`가 순수 함수만 export하는가? Store나 `next/*`를 import하지 않는가?
   - `route.ts`에 집계 루프가 남아 있지 않은가?
   - `/api/admin/stats` 응답 필드가 `total`/`available`/`held`/`sold`/`version`/`serverNow` 그대로인가?
   - 기존 `route.test.ts` 10개가 **수정 없이** 통과하는가?
3. 결과에 따라 `phases/12-ai-operations/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 새 `*Service` 계층을 만들지 마라. 이유: 이 저장소의 영속성은 `src/services/`의 Store 인터페이스와 `get*Store()` 팩토리다. 병행 계층을 두면 같은 수치의 출처가 둘로 갈라진다.
- `/api/admin/stats`의 응답 필드를 추가하거나 이름을 바꾸지 마라. 이유: 이 step은 리팩터링이다. `salesRate`는 Step 1에서 별도 함수로 더한다.
- `src/app/api/admin/stats/route.test.ts`를 수정하지 마라. 이유: 그 테스트가 리팩터링이 동작을 바꾸지 않았다는 유일한 증거다. 통과하지 않으면 구현이 틀린 것이다.
- `computeSeatStats` 안에서 Store를 호출하지 마라. 이유: 순수해야 `lib/`에 있을 자격이 있고, 스토어 목킹 없이 테스트가 돈다.
- 기존 테스트를 깨뜨리지 마라.
