# 성능 측정 절차와 결과

이 문서는 측정 방법, 재현 절차, 그리고 실제로 나온 값을 기록한다. 추정값은 적지 않는다. 값이 없는 항목은 없다고 적는다.

## 1. 측정 항목과 방식

| 측정 항목 | 방식 | 근거 위치 |
|---|---|---|
| 좌석 클릭당 React 리렌더 수(before/after) | 자동 | `pnpm test` — `src/components/seat/__tests__/naive-render-count.test.tsx`, `src/components/seat/__tests__/seat-render-count.test.tsx` |
| 파생 atom 재계산 수 | 자동 | `pnpm test` — `src/components/seat/__tests__/seat-render-count.test.tsx` |
| 초기 마운트 시간 · 클릭 커밋 시간 | 브라우저 실측 | `node scripts/perf/measure-initial-mount.mjs` — 아래 2·3·4절 |
| 폴링 1회당 Upstash 커맨드 수 | **미측정** | Upstash 콘솔 확인 필요 — 아래 6절 |

자동 항목은 예상 규모를 문서에 옮긴 추정값이 아니다. 테스트가 실행 중 렌더와 atom read를 직접 계측하고 assertion으로 검증한 결과다. 브라우저 실측 항목은 jsdom에 레이아웃·페인트 비용이 없어 실제 브라우저에서 재야 하는 값이고, 3절의 스크립트가 그 일을 한다.

## 2. 실측 결과 (2026-09-13)

프로덕션 프로파일링 빌드(`next build --profile`) 두 개를 각각 띄우고 5회 측정한 중앙값이다. 원본 데이터는 [`assets/perf/initial-mount-before.json`](assets/perf/initial-mount-before.json)과 [`assets/perf/initial-mount-after.json`](assets/perf/initial-mount-after.json)에 그대로 들어 있다(회차별 값·환경 정보 포함).

| 측정 | before (Day 3 순진한 구현) | after (현재 구현) |
|---|---|---|
| 좌석 1회 클릭 시 커밋 시간 | **27.1 ms** | **0.7 ms** |
| 초기 마운트 — 좌석 컴포넌트 2,000개 렌더 합계 | **43.4 ms** | **142.5 ms** |
| 초기 마운트 — 페이지 하이드레이션 커밋 전체 | 96.6 ms | 218.1 ms |
| First Contentful Paint (참고) | 336 ms | 620 ms |

- 측정 환경: Intel Core i5-8250U(4C/8T) · Windows 11 · headless Chromium 1440×900 · localhost · 인메모리 Store · Next.js 15.5.22 / React 19.
- before는 커밋 `cad06ec`(Day 3 `2-seat-v0` 완료 시점), after는 `e27ae6d`.
- 두 페이지 모두 `<svg>` 안에 `<rect>` 좌석 2,000개를 렌더한다(스크립트가 매 회차 확인한다).

### 이 값이 말하는 것

**클릭은 39배 빨라졌다.** 27.1 ms → 0.7 ms. 순진한 구현은 클릭 한 번에 `SeatMap`의 `useState`가 바뀌면서 좌석 컴포넌트 2,000개가 전부 리렌더된다. 현재 구현은 `atomFamily`로 좌석마다 구독을 나눠 클릭한 좌석 1개만 리렌더된다. 자동 계측 테스트의 "200회 → 1회"(200석 기준)가 브라우저에서 시간으로 나타난 값이다.

**초기 마운트는 개선되지 않았다. 오히려 3.3배 느려졌다.** 좌석 컴포넌트 합계 43.4 ms → 142.5 ms, 좌석 하나당 약 21.7 µs → 71.3 µs. `atomFamily`는 좌석마다 파생 atom을 하나씩 만들고, 각 `Seat`는 `useAtomValue` 두 개로 store에 구독을 등록한다. 그 비용이 마운트 시점에 2,000번 발생한다. **업데이트 비용을 마운트 비용과 맞바꾼 것이고, 이 프로젝트의 좌석 화면은 한 번 열고 여러 번 클릭하는 화면이라 그 교환이 맞는 방향이라고 판단했다.** 근거는 [ADR-002](ADR.md#adr-002-atomfamily로-좌석-구독-격리--beforeafter-측정)에 있다.

**파생 atom 2,000회 재계산은 클릭당 0.7 ms 안에 들어 있다.** 현재 구현에서 `seatVisualStateAtomFamily`는 전역 `selectedSeatIdsAtom`을 구독하므로 클릭 한 번에 좌석 수만큼 파생 read가 다시 실행된다. 그 재계산 전체와 좌석 1개 리렌더, 선택 바 갱신을 합친 커밋이 0.7 ms다. 이 수치가 "재계산을 더 줄일 것인가"라는 질문의 답을 정한다 — [ADR-002의 `selectAtom` 항목](ADR.md#adr-002-atomfamily로-좌석-구독-격리--beforeafter-측정)을 참조.

### 같은 조건이 아닌 부분

페이지 하이드레이션 커밋 전체(96.6 ms → 218.1 ms)는 **동일 조건 비교가 아니다.** 현재 좌석 페이지에는 Day 3에 없던 `ZoomPanSvg`, 3초 스냅샷 폴링, `ConfirmBar`·`HoldTimer`, 문의 위젯이 함께 마운트된다. 좌석에 귀속되는 비교값은 좌석 컴포넌트 2,000개의 렌더 합계(43.4 ms → 142.5 ms)이며, 이 값은 양쪽 모두 "좌석 하나당 컴포넌트 하나" 구조가 같아 그대로 비교된다.

`--profile` 빌드는 프로파일러 타이머가 켜진 `react-dom`을 쓰므로 절대값이 일반 프로덕션 빌드보다 크다. 두 빌드에 같은 방향으로 걸리는 오버헤드라 비교에는 영향이 없지만, 이 표의 숫자를 "실사용자가 겪는 시간"으로 읽으면 안 된다.

## 3. 재현 절차

### 3.1 두 빌드 준비

현재 작업 트리에서 `next build`를 실행하면 실행 중인 dev 서버와 `.next`를 공유해 dev 서버가 깨진다. 양쪽 모두 **별도 worktree**에서 빌드한다.

```bash
# before — Day 3 순진한 구현 (좌석 페이지가 처음 붙은 시점)
git worktree add ../ticket-mvp-day3 cad06ec
cd ../ticket-mvp-day3
npm ci                          # 이 커밋에는 pnpm-lock.yaml이 없고 package-lock.json이 있다
npx next build --profile
npx next start -p 3101

# after — 현재 구현
git worktree add ../ticket-mvp-perf HEAD
cd ../ticket-mvp-perf
corepack pnpm install --frozen-lockfile
corepack pnpm exec next start -p 3100    # 그 전에 corepack pnpm exec next build --profile
```

두 worktree에는 `.env.local`이 복사되지 않으므로 Upstash 토큰 없이 **인메모리 Store**로 뜬다. 네트워크 왕복이 측정에서 빠지고, 운영 Redis에 측정용 hold가 남지 않는다.

`next start`를 백그라운드로 띄울 때 출력 파이프(`| tail` 등)를 물리면 기동 직후 `SyntaxError: Unexpected end of JSON input`으로 죽는다. 파일로 리다이렉트한다.

### 3.2 측정 실행

```bash
node scripts/perf/measure-initial-mount.mjs \
  --url http://localhost:3101/sessions/session-01/seats \
  --runs 5 --label before --out docs/assets/perf/initial-mount-before.json

node scripts/perf/measure-initial-mount.mjs \
  --url http://localhost:3100/sessions/session-01/seats \
  --runs 5 --label after --out docs/assets/perf/initial-mount-after.json
```

`session-01`은 `src/lib/mock-data.ts`의 시드 회차다. 첫 회차는 서버 캐시와 JIT가 식은 상태라 워밍업으로 버리고, 나머지 5회의 중앙값을 쓴다. Playwright는 이 저장소의 의존성이 아니므로 전역 설치본을 쓰거나 `PLAYWRIGHT_PATH`로 경로를 넘긴다.

측정이 끝나면 worktree를 정리한다.

```bash
git worktree remove ../ticket-mvp-day3
git worktree remove ../ticket-mvp-perf
```

## 4. 측정 방법 상세

[`scripts/perf/measure-initial-mount.mjs`](../scripts/perf/measure-initial-mount.mjs)가 하는 일은 세 가지다.

1. **React 커밋 시간 수집.** 페이지의 어떤 스크립트보다 먼저 `__REACT_DEVTOOLS_GLOBAL_HOOK__`의 최소 구현을 주입한다. React는 이 훅이 있으면 커밋마다 `onCommitFiberRoot`를 호출하고, 프로파일러 타이머가 켜진 빌드에서는 루트 fiber의 `actualDuration`에 그 커밋에서 실제로 렌더된 시간이 누적돼 있다. React DevTools Profiler가 커밋 막대에 표시하는 값과 같은 출처이므로, 확장을 설치하고 손으로 Record를 누르는 절차를 스크립트로 대체할 수 있다.
2. **좌석에 귀속되는 몫 분리.** 커밋 시점의 fiber 트리를 훑어 컴포넌트 타입별로 `actualDuration`을 합친다. 프로덕션 번들은 함수 이름이 minify되므로 이름이 아니라 타입 동일성으로 묶고, **인스턴스가 가장 많은 타입(2,000개)** 을 좌석 컴포넌트로 본다. before/after 모두 좌석 하나당 컴포넌트 하나라 같은 기준이 적용된다.
3. **클릭 커밋 측정.** 마운트가 끝난 뒤 화면에 실제로 보이는 좌석 하나를 클릭하고, 그 직후 커밋의 루트 `actualDuration`을 읽는다. 현재 구현은 `ZoomPanSvg`가 확대된 상태로 시작해 좌석 대부분이 뷰포트 밖에 있으므로, `elementFromPoint`로 클릭이 실제로 좌석에 닿는지 확인한 뒤 클릭한다.

클릭 커밋에서는 타입별 합계를 쓰지 않고 루트 값만 읽는다. 직전 커밋에서 bailout된 fiber는 이전 커밋의 `actualDuration`을 그대로 들고 있어 타입별 합계가 오염되기 때문이다. 루트 값은 이번 커밋에 실제로 렌더된 작업만 누적한다.

## 5. 자동 측정 재현

```bash
pnpm test src/components/seat/__tests__
```

before와 현재 구현의 계측 테스트를 함께 실행한다. 통과 결과는 추정치가 아니라 각 테스트가 직접 수집한 렌더·atom read 계측값을 검증한 결과다. jsdom 부하를 줄이기 위해 200석으로 실행하며 3초 폴링은 제외한다.

## 6. 폴링 1회당 Upstash 커맨드 수 (미측정)

ADR-004는 코드 경로를 세어 스냅샷 폴링 1회를 2커맨드로 계산했다. 이 값이 Upstash 콘솔의 실제 과금 단위와 일치하는지는 **아직 확인하지 못했다.** 남은 항목은 이것 하나다.

### 확인 대상

`src/services/seat-store-redis.ts`의 `getSnapshot`은 227~260줄에 있다. 코드 경로는 다음 두 갈래다.

1. 230줄의 `HGETALL session:{id}:seats`는 항상 1회 실행된다.
2. 만료된 hold 좌석이 없으면 246줄의 `GET session:{id}:version`이 실행된다. 만료 좌석이 있으면 242줄의 `CLEANUP_EXPIRED_SCRIPT` Lua `EVAL`이 대신 실행된다.

따라서 콘솔에서 확인할 것은 두 가지다.

- 만료 좌석이 없는 평상시 스냅샷 경로가 실제로 2커맨드로 집계되는가
- `EVAL` 1회가 콘솔에서 1커맨드로 집계되는가, 아니면 스크립트 내부의 `redis.call`까지 각각 집계되는가. cleanup 스크립트는 같은 파일 147~167줄에서 `HGET`·`HDEL`·`INCR`·`GET`을 호출한다.

### 사전 조건과 트래픽 격리

1. `.env.local`에 `.env.example` 5·8줄과 글자 단위로 같은 `UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN`을 설정한다. 둘 다 있어야 `src/services/index.ts` 19줄의 `hasRedisConfig()` 결과로 Redis 구현이 선택된다. 하나라도 없으면 인메모리 Store가 선택되어 Upstash 커맨드가 조용히 0으로 나온다. 환경변수를 바꿨다면 개발 서버를 다시 시작한다.
2. 좌석 페이지는 한 탭만 열고 Admin, 다른 좌석 탭, 다른 브라우저를 모두 닫는다. 로컬 `pnpm dev`에서 측정하는 편이 트래픽을 통제하기 쉽다. 단, 로컬과 배포본이 같은 Upstash DB를 사용하면 배포본 방문자의 폴링도 같은 카운터에 섞이므로 사용자가 없는 DB나 시간대를 선택한다.
3. 측정 중 좌석 탭을 전면에 둔다. 백그라운드 탭에서는 폴링이 중단될 수 있다.

### 평상시 폴링 경로 측정

1. `http://localhost:3000/sessions/session-01/seats`를 열고 초기 로드와 기존 만료 좌석 정리가 끝날 때까지 기다린다.
2. 좌석 탭을 백그라운드로 보내 예약된 폴링을 멈추고, 초기 로드 커맨드가 Upstash 콘솔에 반영될 때까지 기다린다. 카운터 반영이 늦으면 몇 분 기다린 뒤 기준값을 적는다. 브라우저 Network 패널도 비우고 `snapshot`으로 필터링한다.
3. 좌석 탭을 다시 전면에 둔 시점부터 정확히 60초 동안 추가 조작 없이 유지하고, 그 구간의 `/api/sessions/session-01/snapshot` 요청 수를 센다. `SNAPSHOT_REFETCH_INTERVAL`은 `src/hooks/use-seat-snapshot.ts` 11줄의 3,000ms이므로 예정된 폴링 횟수는 `60,000ms ÷ 3,000ms = 20회`다. 탭 복귀 시 즉시 재조회가 있으면 그 요청도 Network 패널에서 센 실제 요청 수에 포함한다.
4. 60초가 끝나면 좌석 탭을 바로 닫아 추가 폴링을 멈춘다. 콘솔 지표가 즉시 갱신되지 않으면 몇 분 기다린 뒤 최종 카운터를 읽는다.
5. `최종 카운터 - 기준 카운터`로 증가분을 구하고, `증가분 ÷ Network 패널에서 센 스냅샷 요청 수`로 폴링 1회당 커맨드 수를 계산한다.

### `EVAL` 과금 단위 측정

만료 정리 경로를 그대로 재현하려면 좌석을 hold한 뒤 `src/lib/hold.ts` 1줄의 `HOLD_TTL_MS = 300_000`, 즉 5분을 기다려야 한다. 다음 스냅샷에서 만료 좌석을 발견하면 cleanup `EVAL` 경로가 실행된다. 이 방법을 쓰면 대기 중 평상시 폴링 커맨드가 함께 발생하므로 Network 요청 수와 평상시 측정 결과를 분리해 계산한다.

더 짧게는 `HOLD_SCRIPT`의 `EVAL` 1회를 별도 측정한다. `src/services/seat-store-redis.ts` 199~205줄의 `hold` 구현은 유효한 hold 요청마다 204줄에서 `HOLD_SCRIPT`를 한 번 실행한다. 좌석 화면의 `선택 완료`는 성공 후 스냅샷을 즉시 재조회하므로 단순 카운터 증가분에 그 조회까지 섞인다. `EVAL`만 격리하려면 다음 순서를 사용한다.

1. 좌석 폴링이 없는 `http://localhost:3000/shows`를 열어 익명 사용자 쿠키를 받은 뒤 Upstash 콘솔 기준값을 적는다.
2. 브라우저 Console에서 다음 요청을 한 번만 실행한다. 요청 본문에는 `userId`를 넣지 않으며 기존 HTTP-only 쿠키가 요청에 자동 포함된다.

   ```js
   await fetch("/api/holds", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       sessionId: "session-01",
       seatIds: ["A-1-1"],
     }),
   });
   ```

3. 다른 요청이 없었는지 Network 패널에서 확인한다. 콘솔 반영이 늦으면 몇 분 기다린 뒤 증가분을 읽는다. 좌석 충돌 응답이어도 Redis의 `HOLD_SCRIPT` `EVAL` 자체는 실행된다.
4. 성공한 hold를 정리하려면 결과 기록을 끝낸 뒤 같은 endpoint에 같은 본문으로 `DELETE`를 한 번 보낸다. 이 정리 요청의 커맨드는 측정 구간 밖으로 분리한다.

### 결과 기록

실측 결과는 `docs/ADR.md` ADR-004의 “Upstash 콘솔 실측은 아직 못 했다” 문단에 기록한다. 실측이 코드로 센 값과 다르면 원래 추정이 틀렸다는 이력을 지우지 않고 두 결과를 함께 남긴다. ADR은 최종 결과만 남기는 문서가 아니라 결정과 근거의 이력이다. 폴링 1회당 커맨드 수가 바뀌면 ADR-004의 Free 한도 비율 표도 함께 갱신한다.

## 7. 값 기록 위치

줄 번호는 문서를 고칠 때마다 어긋나므로 검색으로 찾는다.

- 이 문서 2절 — 실측 결과 표와 해석 (원본 JSON은 `docs/assets/perf/`)
- `README.md` — "성능 before / after" 요약 표
- `docs/PROGRESS.md` — Day 3 "before 측정", Day 4 "after 측정"
- `docs/ADR.md` — ADR-002(좌석 구독 격리의 트레이드오프), ADR-004(Upstash 커맨드 수)
