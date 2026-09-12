# Step 4: conversation-store-redis

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — ADR-004. Upstash 커맨드 수를 비용으로 따지는 근거
- `/src/services/conversation-store.ts` — **step 3에서 생성됨.** 구현할 계약과 세 상수
- `/src/services/conversation-store-memory.ts` — **step 3에서 생성됨.** 같은 계약의 참조 구현
- `/src/services/conversation-store-memory.test.ts` — **step 3에서 생성됨.** 같은 시나리오를 Redis에서도 확인한다
- `/src/services/reservation-store-redis.ts:9-14,45-55` — Lua 스크립트와 **`-- operation: <name>` 마커 주석**
- `/src/services/reservation-store-redis.test.ts:5-77` — 가짜 redis 클라이언트와 `vi.mock("./redis-client", ...)`. **Redis 구현을 테스트하는 이 저장소의 유일한 방법이다**
- `/src/services/reservation-store-redis.test.ts:51-52` — `-- operation:` 마커로 스크립트를 구분하는 부분
- `/src/services/seat-store-redis.ts:16,65,87` — 여러 Lua 스크립트를 한 파일에 두는 형태
- `/src/services/index.ts:16-43` — 팩토리. `useRedis`가 **모듈 로드 시 한 번** 평가된다
- `/src/services/index.test.ts:24-61` — `vi.stubEnv` + `vi.resetModules()` + 동적 import
- `/src/services/redis-client.ts:7-27` — `hasRedisConfig()`, `getRedisClient()`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 3이 계약과 메모리 구현을 만들었다. 이 step이 Redis 구현을 더하고 팩토리에 등록한다.

Redis 쪽에 메모리 쪽에는 없는 요구가 하나 있다. **손님의 POST와 (phase 16의) 슬랙 콜백이
같은 대화에 동시에 쓸 수 있다.** 읽고 나서 쓰는 두 번의 호출로 append를 구현하면 그 사이에
낀 쓰기가 조용히 사라진다. `seat-store-redis.ts`가 좌석 홀드에 Lua를 쓰는 것과 같은 이유다.

키 구조에도 제약이 있다. 턴 목록을 JSON 하나에 담으면 append마다 전체를 읽고 다시 쓰게 되어
커맨드 비용이 대화 길이에 비례한다. ADR-004가 Upstash 커맨드 수를 비용으로 따진다.

phase 16이 같은 키 공간에 스레드 인덱스와 이벤트 기록을 더한다. **키 이름이 겹치지 않게
하고 `summary`에 적어라.**

`src/services/`는 TDD 가드 대상이다. 테스트를 먼저 써라.

## 작업

### `src/services/conversation-store-redis.ts`

```ts
export function createConversationStoreRedis(): ConversationStore;
```

`step 3`의 `ConversationStore`를 **같은 계약으로** 구현한다. 같은 입력에 같은 에러
(`NOT_FOUND:`/`FORBIDDEN:`), 같은 상한, 같은 TTL이어야 한다.

키 구조는 재량이되 아래를 지켜라.

- 대화 메타(`userId`·`escalation`·`updatedAt`)와 턴 목록을 **나눠 둔다.** 턴은 리스트로
  두면 append가 밀어 넣기 한 번이고 상한 유지가 자르기 한 번이다
- **소유권 검증·append·턴 상한 유지·TTL 갱신이 한 번의 `eval` 안에서 끝나야 한다**
- Lua 반환값으로 **없음 / 남의 것 / 성공**을 구분해 호출자가 메모리 구현과 같은 에러를
  throw하게 한다
- 모든 Lua 스크립트 첫 줄에 `-- operation: <kebab-name>` 주석을 넣어라.
  가짜 클라이언트가 이 마커로 스크립트를 구분한다. 없으면 테스트가 통째로 불가능해진다
- 만료는 Redis `EXPIRE`에 맡긴다. 애플리케이션에서 다시 계산하지 마라

### `src/services/index.ts`에 등록

```ts
export type { ConversationStore } from "./conversation-store";
export function getConversationStore(): ConversationStore;
```

기존 셋과 같은 지연 싱글톤 + `useRedis` 분기. **`useRedis`를 다시 계산하지 마라** —
모듈 스코프의 기존 상수를 쓴다. 다시 계산하면 `index.test.ts`의 `resetModules` 전제가 깨진다.

### 테스트 (먼저)

- `conversation-store-redis.test.ts` — `reservation-store-redis.test.ts:5-77`의 가짜
  클라이언트 방식. `conversation-store-memory.test.ts`와 **같은 시나리오**를 돌려
  두 구현이 같은 계약을 만족하는지 본다. 동시 append에서 턴이 유실되지 않는 것도 확인하라
- `index.test.ts`에 추가 — `getConversationStore()`가 환경변수에 따라 구현을 고르는지

## Acceptance Criteria

```bash
npm run test && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 소유권 검증과 쓰기가 **한 번의 `eval`** 안에 있는가?
   - 모든 Lua 스크립트에 `-- operation:` 마커가 있는가?
   - 메모리 구현과 같은 에러 prefix·같은 상한·같은 TTL인가?
   - `useRedis`를 다시 계산하지 않고 기존 상수를 쓰는가?
   - 턴 목록이 JSON 문자열 하나가 아닌가?
   - 테스트가 구현보다 먼저 존재하는가?
3. 결과에 따라 `phases/15-chatbot/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **Redis 키 이름 전부와 Lua `operation` 마커 이름 전부**를 적어라.
phase 16이 같은 키 공간에 스레드 인덱스와 이벤트 기록을 추가하므로 겹치면 안 된다.

## 금지사항

- 읽고 나서 쓰는 두 번의 Redis 호출로 append를 구현하지 마라. 이유: phase 16에서 손님 POST와 슬랙 콜백이 같은 대화에 동시에 쓴다. 그 사이에 끼면 턴이 조용히 사라진다.
- 턴 목록을 JSON 문자열 하나로 넣지 마라. 이유: append마다 전체를 읽고 다시 쓰게 되어 커맨드 비용이 대화 길이에 비례한다. ADR-004가 Upstash 커맨드 수를 비용으로 따진다.
- Lua 스크립트에서 `-- operation:` 마커를 빼지 마라. 이유: 가짜 Redis 클라이언트가 그 주석으로 스크립트를 구분한다. 없으면 Redis 구현의 테스트가 통째로 불가능해진다.
- 메모리 구현과 다른 에러 문자열을 쓰지 마라. 이유: 라우트가 prefix로 상태 코드를 고른다. 두 구현이 다르면 Redis 환경에서만 404가 500이 된다.
- `hasRedisConfig()`를 이 파일에서 다시 부르지 마라. 이유: 분기는 `src/services/index.ts` 한 곳의 `useRedis`가 담당한다. 두 곳으로 갈라지면 테스트의 `resetModules` 전제가 깨진다.
- `escalation` 관련 메서드를 추가하지 마라. 이유: phase 16의 범위다. 키 이름과 Lua를 지금 추측으로 만들면 그쪽 설계와 어긋난다.
- 새 의존성을 추가하지 마라. 이유: `@upstash/redis`가 이미 있다.
- 기존 테스트를 깨뜨리지 마라.
