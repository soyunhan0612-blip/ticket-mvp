import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import {
  AGENT_MAX_ITERATIONS,
  AGENT_MAX_TOKENS,
  AGENT_MODEL,
  AGENT_QUESTION_LIMIT,
  buildOpsAgentFallback,
  buildOpsAgentSystemPrompt,
  buildOpsAgentUserMessage,
  finalizeOpsAgentAnswer,
} from "@/lib/ops-agent";
import { createOpsTools } from "@/lib/ops-agent-tools";
import { collectOperations } from "@/lib/operations";
import { createRateLimiter } from "@/lib/rate-limit";
import { getSeatStore, getShowStore } from "@/services";

const requestBodySchema = z.object({
  question: z.string().trim().min(1).max(AGENT_QUESTION_LIMIT),
  showId: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/).optional(),
  date: z.iso.date().optional(),
});

const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 3,
});

const responseHeaders = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache",
};

type AgentRequest = z.infer<typeof requestBodySchema>;

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function parseRequestBody(request: Request) {
  try {
    return requestBodySchema.safeParse(await request.json());
  } catch {
    return requestBodySchema.safeParse(undefined);
  }
}

function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function createAgentStream(
  apiKey: string,
  input: AgentRequest,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const client = new Anthropic({ apiKey });
        const runner = client.beta.messages.toolRunner({
          model: AGENT_MODEL,
          max_tokens: AGENT_MAX_TOKENS,
          max_iterations: AGENT_MAX_ITERATIONS,
          system: buildOpsAgentSystemPrompt(),
          messages: [
            { role: "user", content: buildOpsAgentUserMessage(input) },
          ],
          tools: createOpsTools({
            showStore: getShowStore(),
            seatStore: getSeatStore(),
          }).map(betaZodTool),
        });
        const message = await runner;
        const answer = message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");

        controller.enqueue(
          encoder.encode(finalizeOpsAgentAnswer(answer, message.stop_reason)),
        );
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const rateLimit = rateLimiter.check(getClientIp(request));
  if (!rateLimit.allowed) {
    return new Response("요청이 너무 많습니다.", {
      status: 429,
      headers: {
        ...responseHeaders,
        "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1) / 1_000)),
      },
    });
  }

  const parsed = await parseRequestBody(request);
  if (!parsed.success) {
    return new Response("잘못된 요청입니다.", {
      status: 400,
      headers: responseHeaders,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return new Response(createAgentStream(apiKey, parsed.data), {
      headers: responseHeaders,
    });
  }

  const rows = await collectOperations(
    { showStore: getShowStore(), seatStore: getSeatStore() },
    { showId: parsed.data.showId, date: parsed.data.date },
  );

  return new Response(createTextStream(buildOpsAgentFallback(rows)), {
    headers: responseHeaders,
  });
}
