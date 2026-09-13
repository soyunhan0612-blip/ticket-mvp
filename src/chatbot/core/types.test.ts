import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { expectTypeOf, expect, it } from "vitest";
import { z } from "zod";

import type {
  ChatEngineConfig,
  ChatHistoryTurn,
  ChatToolDescriptor,
} from "./types";

it("limits model history roles to user and assistant", () => {
  expectTypeOf<ChatHistoryTurn["role"]>().toEqualTypeOf<
    "user" | "assistant"
  >();
});

it("creates descriptors that are structurally compatible with betaZodTool", async () => {
  const inputSchema = z.object({ count: z.number().int() });
  const descriptor = {
    name: "echo_count",
    description: "Returns the parsed count.",
    inputSchema,
    async run(args) {
      return String(args.count);
    },
  } satisfies ChatToolDescriptor<typeof inputSchema>;
  const tools = [descriptor].map(betaZodTool);

  expect(tools).toHaveLength(1);
  await expect(descriptor.run({ count: 3 })).resolves.toBe("3");
});

it("keeps the engine configuration typed around portable primitives", () => {
  expectTypeOf<ChatEngineConfig>().toHaveProperty("apiKey");
  expectTypeOf<ChatEngineConfig>().toHaveProperty("tools");
  expectTypeOf<ChatEngineConfig>().toHaveProperty("history");
});
