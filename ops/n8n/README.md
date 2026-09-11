# n8n 매진 임박 알림

이 워크플로는 5분마다 Ticket MVP의 `GET /api/admin/alerts/sellout`을 호출하고, 서버가 만든 `text`가 비어 있지 않을 때만 Slack Incoming Webhook으로 전송합니다. 판매율과 임계값 판정은 앱의 `src/lib/sellout-alert.ts`에서 끝나며, n8n의 IF 노드는 `text` 길이만 확인합니다.

## 사전 준비

- 워크플로를 가져올 n8n 인스턴스
- 외부에서 접근 가능한 Ticket MVP의 기본 URL
- 앱의 `BASIC_AUTH_USER`와 `BASIC_AUTH_PASS` 값
- 메시지를 받을 Slack Incoming Webhook

## 자격증명 설정

1. n8n에서 **Basic Auth** credential을 만들고 이름을 `Ticket MVP Basic Auth`로 지정합니다.
2. 사용자명과 비밀번호에는 앱에 설정한 `BASIC_AUTH_USER`와 `BASIC_AUTH_PASS` 값을 각각 입력합니다. 값은 이 저장소나 워크플로 export에 넣지 않습니다.
3. 가져오기 후 `Fetch sellout alerts` 노드에서 이 credential을 다시 선택합니다. JSON의 credential id는 실제 인스턴스 값이 아닌 자리표시자입니다.
4. Slack Incoming Webhook URL도 자격 정보로 취급합니다. JSON에는 `{{SLACK_WEBHOOK_URL}}`만 두었으므로, 실제 값은 가져오기 후 n8n 안에서 `Send Slack webhook` 노드에 설정하고 재export한 파일을 저장소에 커밋하지 않습니다.

## 워크플로 가져오기

1. n8n에서 **Import from File**을 선택해 `sellout-alert.workflow.json`을 가져옵니다.
2. `Fetch sellout alerts`의 `{{BASE_URL}}`을 실제 앱 기본 URL로 바꾸고, 요청 메서드가 GET이며 `Ticket MVP Basic Auth` credential이 선택됐는지 확인합니다.
3. `Schedule Trigger`가 5분 간격인지 확인합니다.
4. `Has alert text`가 `text.length > 0`만 검사하고, 판매율을 다시 비교하지 않는지 확인합니다.
5. `Send Slack webhook`에 실제 Webhook URL을 입력하고, POST 본문이 JSON `{"text": $json.text}` 형태인지 확인합니다. 이 노드는 IF의 true 출력에만 연결돼야 합니다.

이 JSON은 저장소에서 손으로 작성했으며 실제 n8n 인스턴스 import를 확인하지 못했습니다. n8n 버전에 따라 노드 파라미터가 달라질 수 있으므로 가져오기 실패 시 같은 네 노드를 UI에서 만들고, 가져오기에 성공해도 위 파라미터와 연결을 반드시 확인합니다. 수동 실행이 성공하기 전에는 워크플로를 활성화하지 않습니다.

## 검증

n8n 없이 엔드포인트와 Basic 게이트부터 확인할 수 있습니다.

```bash
curl -u '<user>:<pass>' \
  '{{BASE_URL}}/api/admin/alerts/sellout?threshold=0'
```

현재 `src/lib/mock-data.ts`의 시드 공연 8건에는 `presetId`가 없습니다. 따라서 시드의 `total`은 항상 `TOTAL_SEATS`(2,000)로 계산되고 판매율이 1%에도 미치지 않아, 기본 임계값 90에서는 시드 데이터만으로 알림이 발화하지 않습니다.

배선 확인 때만 `Fetch sellout alerts` URL 끝에 `?threshold=0`을 임시로 붙여 수동 실행하고 Slack 수신을 확인한 뒤 제거합니다. **90은 실제 운영 기본값이고 0은 배선 확인용 값**이므로 운영 활성화 전에 반드시 기본 URL로 되돌립니다. 이 전제에서 계산된 시드 판매율은 실측 성과가 아니며 포트폴리오 수치로 인용하지 않습니다.

## 단일 자격증명의 위험

n8n이 쓰는 Basic 자격증명은 `/api/admin`만을 위한 별도 계정이 아니라 `/admin`과 `/seller`가 함께 쓰는 단일 자격증명입니다. 역할 분리가 없으므로 유출되면 셀러 공연 등록까지 열립니다. 값은 n8n credential 저장소에만 두고, 노출이 의심되면 앱의 `BASIC_AUTH_USER`와 `BASIC_AUTH_PASS`를 회전한 뒤 n8n credential도 같은 값으로 갱신해야 합니다. 이 MVP에서 회전 외의 복구 수단은 없습니다.
