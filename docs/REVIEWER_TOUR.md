# 심사자용 3분 투어

배포본(https://ticket-mvp-eight.vercel.app)에서 바로 확인할 수 있는 순서입니다. 좌석 경합은 **창 2개**가 있어야 보이므로 5번을 건너뛰지 마세요. 창을 두 개 열기 어렵다면 [좌석 경합 GIF](DEMO.md#좌석-경합--두-사용자가-같은-좌석을-노릴-때)로 같은 장면을 볼 수 있습니다.

1. **[/](https://ticket-mvp-eight.vercel.app/)** — 랜딩. 히어로 캐러셀과 추천 공연 3개(RSC). 여기서 `공연 둘러보기`로 넘어갑니다.
2. **[/shows](https://ticket-mvp-eight.vercel.app/shows)** — 공연 목록(RSC). 카드를 눌러 상세로 들어가 회차를 고릅니다.
3. **좌석 선택** — 2,000석 SVG. wheel로 줌, 드래그로 팬, `전체 보기`로 복귀합니다.
4. **4석 상한** — 5번째 좌석을 눌러 보세요. 클라이언트뿐 아니라 `POST /api/holds`에서도 거절합니다 (`../src/lib/seat-rules.ts`를 route handler가 재사용).
5. **좌석 경합** — 같은 좌석 URL을 **시크릿 창**으로 하나 더 엽니다(익명 쿠키가 분리돼 다른 사용자가 됩니다). 한쪽에서 좌석을 잡으면 반대쪽은 3초 안에 회색으로 바뀌고, 같은 좌석을 동시에 잡으면 한쪽만 성공하고 나머지는 **선택 묶음 전체가** 롤백됩니다.
6. **[/reservations](https://ticket-mvp-eight.vercel.app/reservations)** — 예매 확정 후 내역과 취소. 취소하면 좌석이 다시 예매 가능으로 돌아옵니다.
7. **문의하기 위젯** — 관람객 화면 오른쪽 아래의 말풍선 `문의하기` 버튼. 공연·회차 잔여석·본인 예매·환불 안내를 조회 툴로만 답합니다(`POST /api/chat`, 로그인 게이트 밖 공개). 예매나 취소를 대신 하지는 않습니다. 패널 안의 `상담원에게 직접 문의하기`를 누르면 모델의 판단을 기다리지 않고 바로 Slack 스레드가 열리고, 그 뒤 보내는 메시지는 모델을 거치지 않고 스레드 답글로 갑니다. 상담원이 Slack에서 답하면 3초 안에 위젯에 뜹니다. AI 키가 없으면 고정 안내 문구로 폴백하고, Slack 자격 증명이 없으면 상담원 버튼 자체가 뜨지 않으며, `/admin`·`/seller`에서는 위젯이 뜨지 않습니다.
8. **[/admin](https://ticket-mvp-eight.vercel.app/admin)** — 회차를 고르기 전에 **회차별 운영 표**(전체·예매가능·홀드·판매완료·판매율), **AI 운영 요약** 버튼, **운영 질문**(Agent)이 먼저 보입니다. 요약은 버튼을 누를 때만 호출하고, 질문은 Agent가 조회할 Tool을 스스로 골라 답합니다. AI 키가 없으면 둘 다 같은 집계를 읽어 주는 고정 문장으로 폴백합니다. 회차를 고르면 4개 카드와 읽기 전용 좌석맵이 붙고, 위에서 잡은 좌석이 여기 반영됩니다. (로그인 필요)
9. **[/seller/new](https://ticket-mvp-eight.vercel.app/seller/new)** — 공연 등록과 AI 설명 스트리밍. (로그인 필요)

## 심사자용 계정

`/admin`·`/seller` 이하 경로, `/api/admin` API, 그리고 `/api/shows`의 **쓰기**(공연 등록)는 미들웨어의 환경변수 기반 인증 뒤에 있습니다. 공연 목록 조회(`GET /api/shows`)는 공개라 경로가 아니라 메서드로 갈립니다. 미인증 상태로 들어가면 **주소는 그대로 둔 채 로그인 모달**이 뜹니다.

- 사용자명: `<BASIC_AUTH_USER 값>`
- 비밀번호: `<BASIC_AUTH_PASS 값>`

`.env.example`을 복사만 하고 두 값을 채우지 않으면 `/admin`·`/seller`는 닫힙니다. 빈 값은 인증 통과가 아니라 거부로 처리됩니다 — [그렇지 않았던 시절의 결함과 수정](AI_COLLABORATION.md#1-빈-문자열-자격증명으로-basic-auth가-뚫리던-결함)이 따로 기록돼 있습니다.

CLI로 확인할 때는 Basic 헤더가 그대로 통합니다. 브라우저에 네이티브 로그인 프롬프트를 띄우는 `WWW-Authenticate` 응답만 걷어냈고, 헤더 검증 자체는 남아 있습니다.

```bash
# 페이지는 자격증명만으로 열립니다
curl -u '<user>:<pass>' http://localhost:3000/admin

# /api/admin/stats는 익명 userId 쿠키도 함께 봅니다(좌석 스냅샷의 mine 판정에 쓰입니다).
# 브라우저는 미들웨어가 발급한 쿠키를 자동으로 싣지만 curl은 직접 넣어야 합니다.
curl -u '<user>:<pass>' -b 'userId=local-check' \
  'http://localhost:3000/api/admin/stats?sessionId=<회차 id>'
```

배포본 수동 검증 시나리오와 PRD 대비 알려진 차이는 [Test Scenarios](TEST_SCENARIOS.md)에 있습니다.
