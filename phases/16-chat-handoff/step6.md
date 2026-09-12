# Step 6: handoff-ui-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 흐름" 절의 ASCII 블록들. 이 step이 **한 블록**을 더한다
- `/docs/ADR.md` — **ADR-008이 이미 있다.** 새로 쓰지 말고 근거가 필요하면 참조만 하라
- `/ops/n8n/README.md` — **전문.** 저장소 밖 인프라의 재현 절차를 쓰는 이 저장소의 형식. 자격증명을 적지 않고 플레이스홀더를 쓰는 방식
- `/README.md` — "진행 상황" 표의 형식. Day 열 이름과 자연어 상태 문자열
- `/phases/15-chatbot/index.json`, `/phases/16-chat-handoff/index.json` — **진행 상태의 단일 출처.** README 표를 여기와 어긋나게 쓰지 마라
- `/src/chatbot/ui/use-chat.ts` — **phase 15 step 8에서 생성됨.** 폴링을 더한다. `@/` import가 0건이어야 한다는 제약이 그대로 유지된다
- `/src/chatbot/ui/__tests__/no-domain-imports.test.ts` — **phase 15 step 8에서 생성됨.** 이 파일의 화이트리스트를 넘지 마라
- `/src/chatbot/ui/ChatWidget.tsx` — **phase 15 step 8에서 생성됨.** `operator`·`notice` 렌더 분기가 비어 있다
- `/src/hooks/use-seat-snapshot.ts` — 폴링 관용구와 간격 상수(`SNAPSHOT_REFETCH_INTERVAL = 3_000`)
- `/src/app/api/chat/[conversationId]/route.ts` — **step 4에서 확장됨.** 응답의 `awaitingOperator`
- `/src/components/seller/AiDescriptionGenerator.tsx:86` — **주석에 `dangerouslySetInnerHTML`이라는 단어가 있다.** 순진한 grep으로 검사를 짜면 거짓 실패한다
- `/docs/UI_GUIDE.md` — 배지를 만들지 않는다는 규칙

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 5까지로 서버 쪽은 끝났다. 상담원이 답장하면 대화에 붙는다. **그런데 손님 화면이
그것을 가져오지 않는다.**

phase 15 step 8의 `useChat`은 마운트 시와 스트림 종료 후에만 `GET`을 부른다. 상담원 답장은
그 뒤 임의의 시점에 도착하므로, 기다리는 동안 주기적으로 확인해야 한다.

**기다리는 동안에만 켠다.** 모든 손님이 항상 3초마다 요청을 보내면 비용이 대화 수에 비례해
늘어난다. `awaitingOperator`가 `true`인 동안만 폴링하고, 답이 오면 끈다.

슬랙 연동의 실제 설정은 저장소 밖에서 사람이 한다. 그 절차를 `ops/slack/README.md`에 남긴다.
**`docs/` 아래에 두지 마라** — `scripts/execute.py`가 `docs/*.md`를 매 step 프롬프트에 전문으로
싣는다. phase 14가 같은 이유로 n8n 문서를 `ops/n8n/`에 두었다.

`src/chatbot/ui/`는 TDD 가드 대상이 아니다. 그래도 테스트는 반드시 남겨라.

## 작업

### `src/chatbot/ui/use-chat.ts` 수정

- 응답의 `awaitingOperator`를 그대로 반환값에 싣는다. **판정을 클라이언트에서 다시 하지 마라** —
  `core/escalation.ts`를 import하면 `../`가 되어 아키텍처 테스트가 깨진다
- `awaitingOperator`가 `true`인 동안 `GET`을 **3초 간격**으로 반복한다. `false`가 되면 멈춘다.
  간격은 좌석 스냅샷 폴링과 같은 값이다
- 폴링 결과의 턴 목록이 로컬 상태를 덮어쓴다. **서버가 단일 출처다**
- 언마운트 시 폴링을 정리한다
- `@/`로 시작하는 import를 넣지 마라. 새 의존성이 필요하면 기존 화이트리스트 안에서 해결하라

### `src/chatbot/ui/ChatWidget.tsx` 수정

- `operator` 턴에 **"상담원" 텍스트 라벨**을 붙인다. `docs/UI_GUIDE.md`가 배지를 금지하므로
  배지 컴포넌트를 만들지 마라
- `notice` 턴을 안내 문구 스타일로 보여준다
- 상담원을 기다리는 동안 그 사실을 화면에 알린다
- 여전히 `whitespace-pre-wrap` plain text다. **상담원이 쓴 문장도 사용자 입력이다**

### `ops/slack/README.md` (새 파일)

`ops/n8n/README.md`와 같은 형식. 담을 것:

1. 무엇을 하는 연동인가 — 한 문단
2. **슬랙 앱 만들기와 스코프** — 봇 토큰에 필요한 스코프가 둘 이상이다.
   보내기에 `chat:write`, 상담원 답장을 이벤트로 받기 위해 채널 종류에 맞는 history 스코프
   (공개 채널 `channels:history`, 비공개 채널 `groups:history`).
   **`chat:write`만으로는 답장이 들어오지 않는다**는 것을 굵게 적어라. 봇을 대상 채널에 초대한다
3. **Event Subscriptions** — Request URL은 `{{BASE_URL}}/api/chat/slack/events`,
   구독할 이벤트는 채널 종류에 맞춰 `message.channels` 또는 `message.groups`.
   URL 등록 시 `url_verification`이 한 번 온다
4. **환경변수** — `SLACK_BOT_TOKEN`·`SLACK_SIGNING_SECRET`·`SLACK_CHANNEL_ID`.
   **값은 적지 않는다.** `NEXT_PUBLIC_` 금지를 명시한다
5. **검증 방법** — 챗봇에 조회로 답할 수 없는 질문을 하고, 슬랙에 뜬 메시지에 **스레드로**
   답장해 손님 화면에 뜨는지 본다. 스레드가 아닌 새 메시지는 연결되지 않는다
6. **1분 자동 안내** — 타이머가 아니라 폴링 시점 판정이므로, 창을 닫아 두면 안내도 늦게 뜬다
7. **phase 14가 남긴 n8n 매진 알림 설정도 여기서 함께 끝낸다** — `ops/n8n/README.md`의
   절차를 가리키고, 슬랙 워크스페이스에 한 번 들어갈 때 같이 처리하라고 적는다
8. **위험** — 서명 비밀이 비면 콜백이 전부 거부된다(fail-closed). 유출 시 회전이 유일한 대응이다

**슬랙에서 실제로 동작하는 것을 확인했다고 쓰지 마라.** 이 세션은 슬랙 워크스페이스에
접근할 수 없다. 검증하지 않은 것을 검증했다고 적으면 재현 절차 전체의 신뢰가 무너진다.

### `docs/ARCHITECTURE.md` 갱신

"데이터 흐름" 절에 챗봇 경로 **한 블록**을 기존 형식으로 더한다. 손님 질문 → AI 스트림 →
에스컬레이션 → 슬랙 → 콜백 → 폴링까지가 드러나면 된다.

**이 문서는 매 step 프롬프트에 실린다. 문장을 늘리지 말고 블록만 더한다.**
"AI 엔드포인트" 절은 이미 갱신돼 있으니 건드리지 마라.

### `README.md` 진행표 갱신

"Day" 표에 두 행을 기존 형식으로 더한다. `phases/*/index.json`이 진행 상태의 단일 출처이므로
거기 값과 어긋나게 쓰지 마라.

### 테스트

- `use-chat.test.tsx`에 추가 — `awaitingOperator`가 `true`면 폴링이 돌고, `false`가 되면
  멈추는지. 가짜 타이머로 결정적으로 만들어라
- `ChatWidget.test.tsx`에 추가 — `operator` 턴이 "상담원" 라벨과 함께 보이는지,
  `notice` 턴이 보이는지, 대기 중 표시가 뜨는지

`dangerouslySetInnerHTML`이 없다는 것을 검사하는 테스트를 새로 만든다면, **주석을 걸러라.**
`AiDescriptionGenerator.tsx:86`의 주석에 그 단어가 있어 순진한 grep은 거짓 실패한다.

## Acceptance Criteria

```bash
npm run test && npm run lint
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트를 확인한다:
   - `use-chat.ts`에 `@/`나 `../`로 시작하는 import가 여전히 0건인가?
   - 폴링이 `awaitingOperator`가 `true`인 동안에만 도는가?
   - `operator` 턴이 배지가 아니라 텍스트 라벨로 구분되는가?
   - 답변이 `whitespace-pre-wrap`인가? `dangerouslySetInnerHTML`이 없는가?
   - `ops/slack/README.md`에 실제 토큰·비밀·도메인이 없는가?
     (`grep -riE "xoxb-|xapp-|https://hooks" ops/slack/`로 확인하라)
   - README에 history 스코프가 적혀 있는가? `chat:write`만 적지 않았는가?
   - `docs/ARCHITECTURE.md`에 블록만 더하고 기존 서술을 늘리지 않았는가?
   - `docs/ADR.md`를 건드리지 않았는가? (ADR-008은 이미 있다)
   - README 진행표가 `phases/*/index.json`과 일치하는가?
3. 결과에 따라 `phases/16-chat-handoff/index.json`의 해당 step을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

`summary`에는 **사용자가 직접 해야 하는 일**을 적어라. 이 phase는 사람이 슬랙 앱을 만들고
Request URL을 등록해야 끝난다.

## 금지사항

- 상담원을 기다리지 않는 동안에도 폴링하지 마라. 이유: 모든 손님이 3초마다 요청을 보내면 비용이 대화 수에 비례해 늘어난다.
- `use-chat.ts`에서 `core/escalation.ts`를 import하지 마라. 이유: `../`가 되어 아키텍처 테스트가 깨진다. 판정은 서버가 하고 `awaitingOperator` 불리언으로 내려온다.
- 슬랙 답장을 HTML로 렌더하지 마라. 이유: 상담원이 쓴 문장도 사용자 입력이다. `whitespace-pre-wrap` plain text가 저장형 XSS의 방어선이다.
- 배지 컴포넌트를 만들지 마라. 이유: `docs/UI_GUIDE.md`가 배지를 만들지 않는다고 정했다. 턴 구분은 텍스트 라벨로 한다.
- `ops/slack/README.md`를 `docs/` 아래에 두지 마라. 이유: `scripts/execute.py`가 `docs/*.md`를 매 step 프롬프트에 전문으로 싣는다. 운영 설정 문서가 이후 모든 step의 비용이 된다.
- 필요한 스코프를 `chat:write`만 적지 마라. 이유: 그것은 보내기 전용이다. history 스코프가 없으면 Event Subscriptions에 이벤트를 추가할 수 없고 답장이 영영 들어오지 않는다. 사용자가 문서대로 따라 해도 설정이 끝나지 않는다.
- 실제 토큰·서명 비밀·배포 도메인을 문서에 적지 마라. 이유: 저장소에 들어간 비밀은 회전 외에 되돌릴 방법이 없다. 플레이스홀더를 쓴다.
- 슬랙에서 동작을 확인했다고 쓰지 마라. 이유: 이 세션은 슬랙 워크스페이스에 접근할 수 없다. 검증하지 않은 것을 검증했다고 적으면 재현 절차의 신뢰가 무너진다.
- ADR-008을 새로 쓰지 마라. 이유: `docs/ADR.md`에 이미 있다. 중복되면 어느 쪽이 최신인지 알 수 없다.
- `docs/ARCHITECTURE.md`의 "AI 엔드포인트" 절을 고치지 마라. 이유: 이미 챗봇을 포함해 갱신돼 있다.
- `dangerouslySetInnerHTML` 검사를 순진한 문자열 매칭으로 짜지 마라. 이유: `AiDescriptionGenerator.tsx:86`의 주석에 그 단어가 있어 거짓 실패한다.
- 새 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
