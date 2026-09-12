export const EMPTY_ANSWER_NOTICE =
  "요청을 처리했지만 답변 텍스트를 생성하지 못했습니다.";

export const TRUNCATED_ANSWER_NOTICE =
  "(답변이 길어 상한에서 잘렸습니다. 질문을 좁혀 다시 물어보세요.)";

/*
 * 응답 헤더가 이미 나간 뒤에는 상태 코드로 빈 답이나 토큰 상한 도달을 알릴 수
 * 없다. 잘린 답을 온전한 답으로 오해하는 쪽이 명시적인 실패 안내보다 위험하므로
 * 호출자는 위 문구를 스트림 본문으로 전달한다.
 */
export function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
