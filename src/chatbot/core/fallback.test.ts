import { describe, expect, it } from "vitest";

import {
  EMPTY_ANSWER_NOTICE,
  TRUNCATED_ANSWER_NOTICE,
  createTextStream,
} from "./fallback";

describe("fallback notices", () => {
  it("provides explicit notices for empty and truncated streamed answers", () => {
    expect(EMPTY_ANSWER_NOTICE).toBe(
      "요청을 처리했지만 답변 텍스트를 생성하지 못했습니다.",
    );
    expect(TRUNCATED_ANSWER_NOTICE).toBe(
      "(답변이 길어 상한에서 잘렸습니다. 질문을 좁혀 다시 물어보세요.)",
    );
  });
});

describe("createTextStream", () => {
  it("encodes the supplied text as one readable byte stream", async () => {
    const stream = createTextStream("안내 문구");

    expect(stream).toBeInstanceOf(ReadableStream);
    await expect(new Response(stream).text()).resolves.toBe("안내 문구");
  });
});
