import { describe, expect, it } from "vitest";

import { createChatStream } from "./engine";
import type { ChatEngineConfig } from "./types";

function createConfig(apiKey: string): ChatEngineConfig {
  return {
    apiKey,
    model: "claude-opus-5",
    maxTokens: 2_000,
    maxIterations: 4,
    systemPrompt: "Answer in plain text.",
    tools: [],
    history: [{ role: "user", content: "안녕하세요" }],
  };
}

describe("createChatStream", () => {
  it.each(["", "   \t\n"])(
    "errors the stream when apiKey is empty or whitespace-only",
    async (apiKey) => {
      const stream = createChatStream(createConfig(apiKey));

      await expect(stream.getReader().read()).rejects.toThrow();
    },
  );

  it("returns a ReadableStream", () => {
    expect(createChatStream(createConfig("test-api-key"))).toBeInstanceOf(
      ReadableStream,
    );
  });
});
