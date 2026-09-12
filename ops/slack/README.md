# Slack 상담원 연결

관람객 챗봇이 조회로 답할 수 없는 문의를 Slack 채널로 보내고, 상담원이 해당 메시지의 스레드에 남긴 답장을 손님 화면으로 돌려주는 연동입니다. 앱은 봇 메시지의 `ts`를 대화에 저장하고 Slack Events API 콜백의 `thread_ts`로 대화를 찾습니다.

## Slack 앱 만들기와 권한

1. Slack에서 새 앱을 만들고 연동할 워크스페이스를 선택합니다.
2. **OAuth & Permissions**의 Bot Token Scopes에 메시지 전송용 `chat:write`를 추가합니다.
3. 상담 채널이 공개 채널이면 `channels:history`, 비공개 채널이면 `groups:history`를 추가합니다. **`chat:write`만으로는 상담원 답장 이벤트가 들어오지 않습니다.**
4. 앱을 워크스페이스에 설치하거나 권한 변경 후 다시 설치합니다.
5. 봇을 상담 채널에 초대합니다. 비공개 채널도 봇이 채널 구성원이어야 합니다.

## Event Subscriptions

1. **Event Subscriptions**를 켜고 Request URL에 `{{BASE_URL}}/api/chat/slack/events`를 입력합니다.
2. URL 등록 과정에서 Slack이 한 번 보내는 `url_verification` 요청에 라우트가 `challenge`를 응답하는지 확인합니다.
3. **Subscribe to bot events**에서 공개 채널은 `message.channels`, 비공개 채널은 `message.groups`를 구독합니다.
4. 이벤트나 스코프 변경 후 앱 재설치가 요구되면 다시 설치합니다.

## 환경변수

앱의 서버 환경에 다음 키를 설정합니다. 실제 값은 저장소에 기록하지 않습니다.

```dotenv
SLACK_BOT_TOKEN={{SLACK_BOT_TOKEN}}
SLACK_SIGNING_SECRET={{SLACK_SIGNING_SECRET}}
SLACK_CHANNEL_ID={{SLACK_CHANNEL_ID}}
```

세 값은 모두 서버 전용입니다. `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

## 검증 방법

이 세션에서는 Slack 워크스페이스에 접근할 수 없어 실제 연동을 검증하지 못했습니다. 설정을 마친 뒤 다음 순서로 확인합니다.

1. 챗봇에 공연·회차·좌석·내 예매·환불 안내 조회로 답할 수 없는 질문을 보냅니다.
2. 대상 Slack 채널에 상담 요청 메시지가 생겼는지 확인합니다.
3. 그 메시지에 **스레드로** 답장합니다.
4. 손님이 챗봇 창을 열어 둔 상태에서 답장이 다음 3초 폴링 안에 `상담원` 턴으로 나타나는지 확인합니다.

스레드가 아닌 채널의 새 메시지는 대화와 연결되지 않습니다.

## 1분 자동 안내

1분 자동 안내는 서버 타이머가 아니라 대화 GET 폴링 시점에 판정합니다. 손님이 창을 닫아 폴링이 멈추면 다시 열어 조회할 때까지 안내도 늦게 나타납니다.

## n8n 매진 알림도 함께 설정

phase 14의 매진 임박 알림은 [`ops/n8n/README.md`](../n8n/README.md)의 절차를 따릅니다. Slack 워크스페이스에 들어가 앱 권한과 채널을 설정할 때 Incoming Webhook과 n8n 워크플로 설정도 함께 마치는 편이 좋습니다.

## 위험과 회전

`SLACK_SIGNING_SECRET`이 비어 있으면 콜백은 모두 거부되는 fail-closed 동작입니다. 봇 토큰이나 서명 비밀이 유출되면 Slack에서 해당 값을 회전하고 앱의 서버 환경변수를 즉시 갱신해야 하며, 이 MVP에는 회전 외의 복구 수단이 없습니다.
