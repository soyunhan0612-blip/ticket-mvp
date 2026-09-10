---
name: live-ai-check
description: AI 라우트를 실제 Anthropic API로 검증한다. "라이브 검증", "Agent 실제로 돌려봐", "AI 라우트 수동 확인", phase 완료 후 모델 행동 확인에 사용.
---

# AI 라우트 라이브 검증

이 저장소는 **의도적으로 `@anthropic-ai/sdk`를 목킹하지 않는다**. AI 라우트 테스트는
`ANTHROPIC_API_KEY`를 지워 폴백 경로만 검증한다(`src/app/api/admin/agent/route.test.ts`).

그래서 `toolRunner` → `betaZodTool` → 모델 → Tool 실행으로 이어지는 줄기는 자동 커버리지가
**구조적으로 0**이다. 라이브 검증은 선택이 아니라 그 설계의 짝이다. 테스트가 전부 통과해도
이 구간은 한 번도 실행되지 않은 상태로 남는다.

## 무엇을 검증하지 "말" 것인가

자동 테스트가 이미 덮은 것을 다시 하면 비용만 든다. **아래는 하지 마라.**

| 이미 덮인 것 | 어디에 |
|---|---|
| 키 없을 때 200 + 폴백 문장 | `agent/route.test.ts` |
| `question` 누락·상한 초과 시 400 | 〃 |
| 레이트리밋 429 + `Retry-After` | 〃 |
| `showId === ""`일 때 바디에서 생략 | `OpsAgentPanel.test.tsx` |
| 0바이트 스트림 실패 처리, 401 문구 | 〃 |
| 중화·구분자 래핑의 **구조** | `ai-prompt.test.ts`, `ops-agent-tools.test.ts` |

`.env.local`을 고쳐 폴백을 재현하지 마라. 사용자 파일이고, 그 경로는 이미 덮여 있다.

**남는 것이 검증 대상이다** — 모델이 Tool을 고르는가, 필터가 Tool 인자까지 가는가,
조회 전용·인젝션 방어가 **행동으로** 먹히는가, 상한에 걸렸을 때 무슨 일이 일어나는가.

## 준비

### 1. 키가 유효한지 먼저 확인한다

dev 서버를 띄우고 Opus를 부르기 전에 키부터 본다. 만료된 키로 시작하면 서버 재시작까지
왕복이 한 번 더 든다. 형식이 맞아도 폐기된 키일 수 있으니 실제로 호출한다.

```bash
K=$(grep -m1 '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2- | tr -d '\r"')
curl -s -o /dev/null -w "%{http_code}\n" --max-time 60 https://api.anthropic.com/v1/messages \
  -H "x-api-key: $K" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
```

200이 아니면 사용자에게 키 교체를 요청한다. 키 값은 대화에 출력하지 마라.

### 2. 포트를 확인한다

Next는 포트가 점유돼 있으면 조용히 다음 포트로 옮긴다. 3000이라고 가정하지 마라.

```bash
grep -E "Local:|Port .* is in use" <dev 서버 출력 파일>
```

`TaskStop`은 npm 래퍼만 죽이고 next 자식 프로세스는 살아남는다. 이전 서버가 남아 있으면
포트가 밀리고 **구 환경변수를 든 서버가 계속 응답한다**. 확인하고 정리한다.

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

dev 서버 두 개가 동시에 뜨면 메모리가 터진다. 하나만 유지한다.

### 3. 자격증명을 읽는다

`/api/admin/**`는 미들웨어 Basic 게이트 뒤다. 값은 출력하지 않는다.

```bash
U=$(grep -m1 '^BASIC_AUTH_USER=' .env.local | cut -d= -f2- | tr -d '\r"')
P=$(grep -m1 '^BASIC_AUTH_PASS=' .env.local | cut -d= -f2- | tr -d '\r"')
```

`curl -v`를 자격증명과 함께 쓰지 마라 — base64 헤더가 그대로 찍힌다.

## 함정

### 한글은 파일로 보낸다

Git Bash에서 `-d '{"question":"한글"}'`은 인코딩이 깨진다. **앱 버그로 오진하기 쉽다** —
시드 데이터의 한글은 멀쩡한데 보낸 것만 깨지는 것이 단서다.

```bash
python - <<'PY'
import io, json
io.open("body.json","w",encoding="utf-8").write(
    json.dumps({"question":"가장 많이 팔린 공연이 뭐야?"}, ensure_ascii=False))
PY
curl -s --data-binary @body.json -H 'Content-Type: application/json; charset=utf-8' ...
```

### `/api/shows` POST는 Basic만으로 401이다

라우트 자체가 `getUserIdFromRequest`로 `userId` 쿠키를 검사한다(`src/app/api/shows/route.ts:19`).
미들웨어는 그 쿠키를 **응답에만** 싣기 때문에 같은 요청의 라우트는 보지 못한다. 쿠키를 실어야 한다.

```bash
curl -u "$U:$P" -b "userId=11111111-2222-3333-4444-555555555555" -X POST .../api/shows
```

`/api/admin/**`는 이 검사가 없으므로(ADR-007) Basic만으로 통과한다.

### 공연 등록 바디의 함정

- `posterUrl`은 URL이 아니라 **preset id** — `concert` / `musical` / `theater`
- `title`은 100자 상한. 인젝션 페이로드를 넣으면 쉽게 넘긴다
- `sessions`는 ISO 8601 필수(`z.iso.datetime()`). `2026-12-01` 같은 날짜만으로는 400

### 레이트리밋 예산

AI 라우트는 IP당 **60초 3회**다. 질문을 세면서 진행한다. 인메모리 리미터라 dev 서버
재시작이 기다리는 것보다 빠르다.

## 실행

질문 하나가 모델 호출 + Tool 루프다. **비용이 든다.** 진행 전에 몇 번 부를지 사용자와 합의한다.

가장 값어치 있는 첫 질문은 **Tool을 고르게 만드는 것**이다. 여기서 500이 나면 SDK 조립이 틀린 것이고,
그 사실 하나로 나머지 질문을 아낄 수 있다. 서버 로그를 반드시 함께 본다 — 클라이언트에는
빈 응답만 오고 원인은 로그에만 남는다.

```bash
time curl -s -o ans.txt -w "status=%{http_code} bytes=%{size_download}\n" --max-time 240 \
  -u "$U:$P" -X POST "http://localhost:<PORT>/api/admin/agent" \
  -H 'Content-Type: application/json; charset=utf-8' --data-binary @body.json
```

인젝션을 검증하려면 제목에 구분자를 심은 공연을 **먼저 등록**해 둔다. 그러면 아무 질문이나
해도 Tool 결과에 그 제목이 실려 방어가 함께 드러난다.

## 답변을 읽는 법

모델의 답변에는 검증 대상이 아닌 정보까지 들어 있다. 놓치지 마라.

- "제목에 지시문처럼 보이는 문구가 있었으나 데이터로만 취급했다" → **인젝션 방어 실증**
- "N개 회차가 누락돼 개별 조회해 보완했다" → 행 수 상한과 `omittedRows` 고지가 의도대로 작동
- 문장 중간에서 끝남 → `max_tokens` 상한에 걸린 것. 응답 바이트 수를 함께 본다
- 묻지 않았는데 "조회만 가능하다"고 덧붙임 → 시스템 프롬프트가 먹히고 있음

## 정리

- 검증용으로 만든 데이터는 지운다. 공연 삭제 API가 없으므로 Upstash REST로 직접 지운다 —
  `shows` / `show-sessions` / `sessions` / `session-shows` 해시 필드와
  `session:<id>:seats` / `:version` 키. **시드 공연과 사용자가 만든 공연을 건드리지 않도록
  삭제 전에 id를 확인한다**
- 저장소 루트에 만든 임시 파일(`body.json`, `ans.txt` 등)을 지우고 `git status`로 확인한다
- dev 서버를 계속 둘지 사용자에게 묻는다
