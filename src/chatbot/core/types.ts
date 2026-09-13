import type { z } from "zod";

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatToolDescriptor<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  run: (args: z.infer<Schema>) => Promise<string>;
}

export interface ChatEngineConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxIterations: number;
  systemPrompt: string;
  tools: ChatToolDescriptor[];
  history: ChatHistoryTurn[];
}
