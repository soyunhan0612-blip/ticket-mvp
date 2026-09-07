# PRD: 티켓 예매 MVP

## 배경
채용 지원용 포트폴리오. 티켓링크형 예매 서비스의 핵심 여정(공연 목록 → 회차 → 좌석 선택 → 예매/취소, 셀러 공연 등록 + AI 설명 생성)을 작은 MVP로 구현한다. 공고 스택(Next.js·TypeScript·Tailwind·Tanstack Query·Jotai)을 그대로 쓰되, **평가받고 싶은 건 프론트엔드 실력**이므로 좌석 선택 화면을 시각적·기술적 시그니처로 삼는다.

핵심 판단: mock만으로는 "예매 서비스"가 아니라 "좌석 셀렉터"가 되고, 면접 첫 질문("동시에 두 명이 같은 좌석을 고르면?")에 답할 게 없다. 서버 hold를 넣는 순간 Tanstack Query(낙관적 업데이트·롤백·폴링)와 Jotai(atomFamily 구독 격리)를 **쓸 이유가 실제로 생긴다** — 스택 흉내가 아니라 근거 있는 선택.

## 목표
관람객이 실제 좌석 경합을 겪는 예매 흐름을 완성한다. 면접에서 "동시에 두 명이 같은 좌석을 고르면?"에 답할 수 있어야 한다.

## 사용자
- **관람객** — 공연 탐색, 좌석 선택, 예매/취소 (익명 UUID 쿠키)
- **셀러** — 공연 등록, AI 설명 생성 (Basic Auth)
- **Admin** — 실시간 점유 현황 관찰 (Basic Auth)
- **심사자** — 위 모두를 시크릿 창에서 검증

## 핵심 기능
1. 공연 목록 / 상세 (RSC, SEO)
2. 회차별 좌석 선택 (2000석 SVG + 줌/팬 + 서버 hold + 3초 폴링 + 낙관적 업데이트/롤백)
3. 예매 확정 / 내역 조회 / 취소
4. 셀러 공연 등록 (좌석 배치 프리셋 3개 중 선택)
5. AI 공연 설명 생성 (Haiku 4.5, 스트리밍, key 없을 때 fallback)
6. Admin 실시간 점유 현황 (좌석맵 컴포넌트 재사용)
7. AI 운영 조회 — 운영 현황 API, AI 요약, 조회 전용 Ticket Operations Agent, n8n 매진 임박 알림 (초기 6개 기능이 완성된 뒤의 확장 범위. Agent UI는 **텍스트 전용**이며 차트를 넣지 않는다 — 아래 3대 함정 2번은 그대로 유효하다. 경계와 단계는 `docs/AI_OPERATIONS_EXPANSION_PLAN.md`)

## MVP 제외 사항
기간상 제외하되 README에 이유와 함께 적는다. 모르고 안 한 것과 알고 안 한 것은 다르게 읽힌다.
- 좌석 키보드 내비게이션 / 스크린리더 (2000석 SVG에서 제대로 하려면 별도 설계 필요)
- E2E (Playwright)
- 모바일 터치 제스처 정밀 튜닝 — 줌/팬은 데스크톱 기준으로만 검증
- 실사용자 인증·결제 (관람객은 익명 쿠키 UUID, `/admin`·`/seller`는 Basic Auth)
- CSRF 토큰 (`sameSite: 'lax'` 쿠키로 대체. 실서비스라면 별도 토큰 필요 — README 명시)
- 좌석 배치 에디터

## 3대 함정 (유혹이 와도 손대지 않는다)
이 일정에서 프로젝트를 죽이는 것들.
1. **좌석 배치 에디터** — 드래그로 좌석을 배치하는 툴. 2주가 날아간다. 프리셋 3개로 끝낸다
2. **차트 라이브러리** — Admin에 매출 그래프. 번들만 키우고 아무도 감탄하지 않는다. 좌석맵 재사용이 훨씬 세다
3. **SSE / WebSocket** — 3초 폴링으로 충분. Vercel에서 함수 수명·연결 유지 문제로 반드시 시간을 잡아먹는다

## 디자인 방향
- **도구처럼 보인다** — 티켓 서비스 실사용 UX, 마케팅 페이지가 아님
- 좌석 상태는 색으로 즉시 구분 (available / held-mine / held-other / sold)
- 미니멀. AI 슬롭 안티패턴 준수 (원칙은 `UX_PRINCIPLES.md`, 스타일은 `UI_GUIDE.md`)

---

## 일정 (10일 · 약 80h, Day 10은 통합 검증과 버그 수정 버퍼)

각 단계는 검증 기준을 통과해야 다음으로 넘어간다.

### Day 1 — 기반 + 사고 방지
- **`.gitignore`에 `.env*` 추가**, `.env.example` 생성
- **Stop 훅에서 `build` 제거** (`lint && test`만)
- `CLAUDE.md`의 프로젝트명·스택·아키텍처 규칙 템플릿 채우기
- `tdd-guard.sh`의 차단 범위를 계획과 일치시키기 — `lib/`, `services/`, `app/api/**/route.ts`만 강제. `atoms/`, provider, middleware/proxy 같은 연결 코드까지 우발적으로 막지 않도록 수정
- Next.js 15 + TS strict + Tailwind + Tanstack Query + Jotai + vitest 셋업
- `types/index.ts`: `Show / Session / Seat / SeatStatus / Hold / Reservation / SeatSnapshot`
- `lib/mock-data.ts`: 2000석 생성기(구역·열·번), 공연 8개 · 회차 24개
- `lib/seat-map.ts`(좌석 ID ↔ 좌표), `lib/seat-rules.ts`(최대 매수·선택 가능 판정) — **테스트 먼저**
- `next.config`에 보안 헤더 3종 (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`)
- 검증: `npm run test` 통과, `npm run build` 성공

### Day 2 — 목록/상세 (RSC) + 조기 배포
- `/shows`, `/shows/[id]` RSC로 구현, `app/api/shows` route
- **개발 전용 플래그가 켜진 경우에만** 목록·상세 조회에 인위적 지연 200~600ms + 5% 실패율 (로딩·에러 UI 검증용). 공개 데모와 좌석 폴링에는 절대 X
- `docs/UI_GUIDE.md`의 색·간격 값 확정 (원칙은 `UX_PRINCIPLES.md`, AI 슬롭 안티패턴 준수)
- **빈 껍데기 상태로 Vercel 1회 배포** — 배포 리스크를 마지막 날로 미루지 않는다
- 검증: 배포 URL에서 목록·상세가 뜨고, 페이지 소스 HTML에 공연 데이터가 들어있음

### Day 3 — 좌석맵 v0 (순진한 구현) + before 측정 + 줌/팬 착수
- SVG 2000석 렌더, 클릭 선택, 전역 배열 상태
- 초기 렌더 시간 / 클릭당 리렌더 수 측정 → **before 캡처 + 커밋**
- 시간이 남으면 `ZoomPanSvg` 착수
- 검증: 2000석이 그려지고 선택된다. before 숫자가 기록됐다

### Day 4 — 최적화 + 줌/팬 완성 (after 측정)
- `atoms/seat.ts`의 `atomFamily` + `memo`로 구독 격리
- `ZoomPanSvg` 완성: `viewBox` 기반 줌/팬, 초기 뷰는 무대 앞 중앙부
- 검증: 같은 측정에서 클릭당 리렌더가 1~2개로 떨어짐. 두 숫자를 README 초안에 기록

### Day 5 — 서버 hold (인메모리)
- `lib/hold.ts` (만료 판정) — 테스트 먼저
- `services/seat-store-memory.ts` — 테스트 먼저 (다중 좌석 전체 성공/전체 실패, 만료 재hold 포함)
- `app/api/holds/route.ts` (POST/DELETE) + **`route.test.ts`**: 핸들러에 `Request`를 직접 넘기는 얇은 통합테스트. 다중 hold 성공 → 하나가 충돌하면 전체 409이고 부분 hold 없음 → 만료 후 전체 재hold 성공
- middleware/proxy에서 최초 요청의 익명 `userId` 쿠키 발급 — `httpOnly` + `sameSite:'lax'` + `secure`(프로덕션)
- 서버 검증: zod로 `sessionId`·`seatIds` 검증(`lib/seat-map.ts` 재사용), `lib/seat-rules.ts`의 최대 매수 판정을 **서버에서도** 호출, `release`/`confirm`은 소유자 불일치 시 403
- 검증: `npm run test` 통과. 소유권 위반(남의 hold를 release 시도 → 403) 테스트 포함

### Day 6 — 폴링 + 낙관적 업데이트 + 롤백
- `refetchInterval: 3000`으로 좌석 스냅샷 폴링, `dynamic = 'force-dynamic'` 설정
- 좌석 클릭은 로컬 선택만 변경. `선택 완료` 시 선택 좌석 전체를 하나의 hold 요청으로 전송 → 낙관적 업데이트 → 409 수신 시 전체 롤백 + 충돌 좌석 회색 전환 + 토스트
- `HoldTimer`: 서버가 준 `serverNow`·`expiresAt` 기준 남은 시간 카운트다운, 만료 시 선택 해제하고 다음 폴링에서 보정
- 스냅샷의 `version`이 이전과 같으면 atom 갱신 생략, 달라진 경우에도 좌석 상태 diff만 반영
- 검증: **탭 2개로 같은 회차를 열고, 한쪽에서 좌석을 잡으면 다음 폴링 주기(통상 3~4초) 안에 반대편이 회색으로 바뀐다.** 동시에 같은 좌석을 노리면 한쪽만 성공하고 실패한 요청은 어떤 좌석도 부분 hold하지 않는다

### Day 7 — 예매 확정 / 내역 / 취소
- `ReservationStore` 구현, 사용자별 예매 조회와 소유권 검증
- `ReservationStore.create()` → `SeatStore.confirmSeats()`(소유권·만료 확인 + sold 전환) → 예약 레코드 생성을 하나의 원자적 작업으로 처리
- `/reservations` 목록, 취소 시 좌석 반환. 중복 취소는 409, 타인의 예약 접근은 403
- 검증: 예매 후 새로고침해도 내역 유지, 취소하면 좌석맵에서 다시 선택 가능. 중간 실패에도 sold 좌석만 남거나 예약만 생성되는 불일치가 없다

### Day 8 — 셀러 등록 + AI
- `ShowStore` 구현 — 공연 생성 시 선택한 프리셋으로 회차·좌석 세션까지 함께 생성. 등록한 공연이 목록·상세에 실제로 나타나야 함
- 등록 폼: 필드 5개 이내 + **좌석 배치는 프리셋 3개 중 선택**. 에디터 X
- `app/api/ai/description/route.ts`: 스트리밍, `max_tokens` 600, IP당 분당 3회 rate limit, 입력 길이 상한(공연명 100자 등), 사용자 입력을 구분자로 감싸 전달
- API 키 없을 때 fallback 목업 응답
- **설명은 plain text + `whitespace-pre-wrap`**. `dangerouslySetInnerHTML` 금지 (저장형 XSS 실경로). AI에게도 마크다운 없이 문단만 쓰도록 지시
- **middleware Basic Auth**로 `/admin`·`/seller` 보호. 환경변수 계정 1개, README에 심사자용 계정 명시
- 포스터 이미지는 프리셋 중 선택 (임의 URL 금지)
- 검증: 키를 지운 상태로도 셀러 플로우가 끝까지 동작. 등록한 공연이 `/shows`에 나타남. 시크릿 창 `/admin` 접근 시 인증 요구

### Day 9 — Admin + Redis 교체 + 배포
- `/admin`: 좌석맵 컴포넌트를 **재사용**한 실시간 점유 현황 + 숫자 카드 4개. 차트 라이브러리 X
- `seat-store-redis.ts`, `show-store-redis.ts`, `reservation-store-redis.ts` 작성 → 공연·회차·좌석·예약을 모두 Redis에 영속화하고 팩토리 교체 (**단일 커밋**)
- hold/release/confirm/cancel은 Lua 스크립트로 소유권·만료·다중 좌석 변경·`version` 증가를 원자적으로 처리
- Vercel 환경변수 설정 후 재배포
- 검증: 배포본에서 좌석을 잡고 예매를 생성한 뒤 **재배포해도** 공연·회차·hold·예매 내역이 일관되게 남는다. Admin 숫자가 관람객 탭 조작에 다음 폴링 주기 내 반응

### Day 10 — 문서 + 버퍼
- `docs/PRD.md`, `ARCHITECTURE.md`, `ADR.md` 최종 검토
- README: 데모 GIF(탭 2개 충돌 장면), 성능 before/after 표, **"알고도 제외한 것"** 명시
- 남은 시간은 전부 버그 수습

---

## 검증

```
npm run test    # lib/·services/ 로직 + api route 통합테스트
npm run build   # TS strict 통과 (배포 직전 수동)
npm run lint
```

수동 시나리오 (배포본에서):

1. 목록 → 상세 → 회차 → 좌석. 페이지 소스에 공연 데이터가 들어있는지 확인 (RSC 검증)
2. 탭 2개로 같은 회차 열기 → A에서 좌석 3개 선택 후 `선택 완료` → 다음 폴링 주기(통상 3~4초) 안에 B에서 회색화
3. B에서 겹치는 좌석을 포함해 여러 좌석 hold → 409 → 전체 롤백 + 토스트, 겹치지 않은 좌석도 부분 hold되지 않았는지 확인
4. A에서 타이머 만료까지 대기 → 좌석 자동 반환 확인
5. 예매 확정 → 내역 확인 → 새로고침 → 여전히 존재 → 취소 → 좌석맵 복구
6. 셀러 등록 → AI 스트리밍(키 있음/없음 둘 다) → 등록한 공연이 목록에 나타남
7. Admin에서 1~5 조작이 다음 폴링 주기 안에 반영
8. **Upstash 콘솔에서 커맨드 사용량 확인** — 스냅샷 폴링 1회가 `HGETALL` 1회인지, Lua 내부 명령을 포함한 실제 과금 단위가 예상과 맞는지
9. **보안 점검**
   - 폴링 응답을 네트워크 탭에서 열어 **남의 `userId`가 없는지** 확인
   - `curl`로 좌석 10개를 한 번에 hold 시도 → 서버가 4석 상한으로 거절
   - 다른 브라우저(다른 쿠키)에서 남의 hold를 release 시도 → 403
   - 배포본 JS 번들을 `ANTHROPIC` / `UPSTASH`로 검색 → 아무것도 안 나와야 함
   - 시크릿 창에서 `/admin` 접근 → 인증 요구

성능 증거: Day 3과 Day 4의 캡처 2장 (초기 렌더 시간, 클릭당 리렌더 컴포넌트 수).

---

## 비용

| 항목 | 요금제 | 예상 사용량 | 비용 |
|---|---|---|---|
| Vercel | Hobby | 개인 포트폴리오 무료 범위 | **0원** |
| Upstash Redis | Free | Hash 설계 기준 월 3만 커맨드 이하 | **0원** |
| AI API | 종량제 | 개발 50회 + 심사자 20회 | **수백 원** |
| 도메인 | — | `*.vercel.app` 사용 | **0원** |

- 개발 기간 내내 Redis에 붙어 있으면 폴링만으로 커맨드를 갉아먹는다. **Day 9까지 인메모리로 가는 계획이 비용 면에서도 옳다.**
- AI 엔드포인트는 공개 URL이므로 최소 방어: `max_tokens` 600, IP당 분당 3회 rate limit, 모델은 **Haiku 4.5**(설명 초안에 충분하고 훨씬 저렴)
