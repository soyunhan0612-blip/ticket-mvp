# 로컬 실행과 운영

## 요구사항

- Node.js 22 이상 (jsdom/undici 의존성이 `webidl.util.markAsUncloneable` 요구)
- pnpm 10 (`package.json`의 `packageManager` 필드에 버전이 고정돼 있습니다)

## 설치 & 실행

```bash
corepack enable pnpm         # 또는 npm i -g pnpm
pnpm install --frozen-lockfile
cp .env.example .env.local   # 값은 비워 둬도 됩니다 (아래 참조)
pnpm dev                     # http://localhost:3000
```

**환경변수 없이도 관람객 여정 전체가 동작합니다.** Upstash 토큰이 없으면 인메모리 Store로, `ANTHROPIC_API_KEY`가 없으면 AI 설명이 고정 문구 fallback으로 대체됩니다. 다만 `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`는 **비어 있으면 열리지 않고 닫힙니다** — `/admin`·`/seller`를 로컬에서 보려면 두 값을 채워야 합니다.

`.env.local`은 커밋되지 않습니다 (`.gitignore` 참조). 필요한 변수와 설명은 `.env.example`에서 확인할 수 있습니다.

## 스크립트

| 명령 | 용도 |
|---|---|
| `pnpm dev` | 개발 서버 |
| `pnpm build` | 프로덕션 빌드 (배포 직전 수동) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest 전체 테스트 (93개 파일 · 847개 테스트) |
| `pnpm test:watch` | Vitest 워치 모드 |
| `pnpm test:hooks` | 훅 스크립트 테스트 |
| `python -m pytest scripts/test_execute.py` | 하네스 테스트 |

실행 중인 dev 서버와 `pnpm build`는 `.next`를 공유합니다. 개발 중에 빌드를 돌리면 열려 있던 dev 서버가 hydration 오류로 죽으므로, 측정이나 빌드 확인은 별도 worktree에서 합니다 ([Perf Measurement 3절](PERF_MEASUREMENT.md#3-재현-절차) 참조).

## 데이터 영속성

Day 9에 인메모리 저장소를 **Upstash Redis**로 교체했습니다. 좌석·공연·회차·예약이 모두 Redis에 저장되므로 **재배포하거나 서버가 재시작돼도 예매 내역과 셀러가 등록한 공연이 그대로 남습니다.** 인메모리였다면 배포마다 전부 사라집니다.

- `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`이 **둘 다** 설정되면 Redis로, 아니면 인메모리로 동작합니다 (`src/services/index.ts`의 팩토리 한 지점에서 분기).
- 두 토큰은 서버에서만 읽습니다. `NEXT_PUBLIC_` 접두사를 붙이지 않으므로 브라우저 번들에 포함되지 않습니다.
- 좌석 상태 전환(hold/확정/취소)은 Lua 스크립트로 원자 처리해 여러 좌석이 부분만 잡히는 경우가 없습니다.

### 시드 공연 데이터를 바꿨을 때

`src/lib/mock-data.ts`의 `MOCK_SHOWS`를 수정해도 **이미 시드된 Redis에는 반영되지 않습니다.** `show-store-redis.ts`의 `seed()`가 `show-01`의 존재를 마커로 보고 건너뛰기 때문입니다 — 콜드 스타트마다 같은 해시를 다시 쓰지 않으려는 의도적 설계입니다.

반영하려면 Upstash 콘솔에서 `shows` 키를 삭제한 뒤 아무 페이지나 요청하면 됩니다. 셀러가 등록한 공연도 같은 해시에 있으므로 함께 사라집니다.

`.env.local`에 Upstash 토큰이 없으면 로컬은 인메모리로 동작해 수정이 즉시 반영됩니다. 두 경로의 동작이 다르므로, 시드를 바꾼 뒤에는 **실제로 어느 저장소에 붙어 있는지 확인하고 검증**하세요. `curl localhost:3000/api/shows`로 응답을 보면 바로 알 수 있습니다.

## 배포

- 프로덕션: https://ticket-mvp-eight.vercel.app
- Redis 환경변수를 적용해 배포 완료. 프로덕션에서 좌석 hold를 실행하면 Upstash에 `session:<id>:seats`와 `session:<id>:version` 키가 생성되는 것으로 Redis 연결을 확인했습니다.
- 로그인 게이트(`/admin`·`/seller/new`), AI 설명 생성도 프로덕션에서 동작을 확인했습니다.
