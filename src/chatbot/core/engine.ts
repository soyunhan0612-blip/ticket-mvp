import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { EMPTY_ANSWER_NOTICE, TRUNCATED_ANSWER_NOTICE } from "./fallback";
import { normalizeHistory } from "./history";
import type { ChatEngineConfig } from "./types";

export function createChatStream(
  config: ChatEngineConfig,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      if (config.apiKey.trim().length === 0) {
        controller.error(new Error("Anthropic API key is required."));
        return;
      }

      try {
        const client = new Anthropic({ apiKey: config.apiKey });
        const messages: Anthropic.Beta.BetaMessageParam[] = normalizeHistory(
          config.history,
        );
        const runner = client.beta.messages.toolRunner({
          model: config.model,
          max_tokens: config.maxTokens,
          max_iterations: config.maxIterations,
          system: config.systemPrompt,
          messages,
          tools: config.tools.map(betaZodTool),
          stream: true,
        });
        let emittedText = false;
        let lastStopReason: Anthropic.Beta.BetaStopReason | null = null;

        for await (const stream of runner) {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta" &&
              event.delta.text.length > 0
            ) {
              emittedText = true;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          const message = await stream.finalMessage();
          lastStopReason = message.stop_reason;
        }

        if (!emittedText) {
          controller.enqueue(encoder.encode(EMPTY_ANSWER_NOTICE));
        }
        if (lastStopReason === "max_tokens") {
          controller.enqueue(
            encoder.encode(`\n\n${TRUNCATED_ANSWER_NOTICE}`),
          );
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
