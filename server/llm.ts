/**
 * LLM client: Groq's OpenAI-compatible chat completions API, the same provider and models as
 * the Wealth Intelligence Copilot. `openai/gpt-oss-120b` handles the coach, planner and
 * reviewer; the faster `openai/gpt-oss-20b` handles buddy lines and safety checks.
 *
 * complete()      one chat completion (with optional tools); short rate-limit waits are retried
 * completeJson()  asks for a JSON object, validates it with a Zod schema, and retries once with a
 *                 bigger budget (these are reasoning models whose hidden reasoning shares the
 *                 token budget, so a truncated or empty answer usually just needs more room)
 */
import { z } from "zod";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const MODEL_LARGE = "openai/gpt-oss-120b";
export const MODEL_SMALL = "openai/gpt-oss-20b";
// Groq's free tier allows about 8,000 tokens a minute per model. Short waits are absorbed by
// retrying; longer ones switch to the request's fallback model (its own limit), if it has one.
const MAX_RATE_LIMIT_WAIT_SECONDS = 10;
const TIMEOUT_MS = 60_000;

// ── OpenAI-format message and tool types ─────────────────────────────────────

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  json?: boolean;
  /** Model to try if `model` is rate-limited (each Groq model has its own limit). */
  fallbackModel?: string;
}

export interface CompletionResult {
  message: { content: string | null; tool_calls?: ToolCall[] };
  finishReason: string;
}

/** Anything that can run a chat completion. The real one calls Groq; tests pass a scripted fake. */
export interface LlmClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** The provider failed or returned something unusable. `status` is the HTTP status to report. */
export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Groq client ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds Groq asks us to wait after a 429, from Retry-After or the error text. */
function rateLimitWait(res: Response, text: string): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  const m = /try again in ([0-9.]+)(ms|s)/.exec(text);
  if (m) return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
  return MAX_RATE_LIMIT_WAIT_SECONDS + 1;
}

export function createGroqClient(apiKey: string): LlmClient {
  const client: LlmClient = {
    async complete(req) {
      const body = {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.3,
        reasoning_effort: req.reasoningEffort ?? "low",
        ...(req.tools?.length ? { tools: req.tools, tool_choice: "auto" } : {}),
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      };

      let res: Response | null = null;
      let text = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(GROQ_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch {
          throw new LlmError(502, "Couldn't reach the AI service. Check the internet connection.");
        }
        text = await res.text();
        if (res.status === 429 && attempt < 2) {
          const wait = rateLimitWait(res, text);
          if (wait <= MAX_RATE_LIMIT_WAIT_SECONDS) {
            await sleep((wait + 0.2) * 1000);
            continue;
          }
        }
        break;
      }

      if (res?.status === 429 && req.fallbackModel) {
        console.warn(`[llm] ${req.model} rate-limited; retrying on ${req.fallbackModel}`);
        return client.complete({ ...req, model: req.fallbackModel, fallbackModel: undefined });
      }
      if (!res || !res.ok) {
        const status = res?.status ?? 502;
        console.warn(`[llm] Groq HTTP ${status}: ${text.slice(0, 300)}`);
        if (status === 401) throw new LlmError(503, "AI helpers aren't set up: the Groq API key was rejected. Check GROQ_API_KEY in .env.");
        if (status === 429) throw new LlmError(429, "The AI helpers are busy (rate limit reached). Try again in a minute.");
        const detail = safeErrorMessage(text);
        throw new LlmError(502, detail ? `AI service: ${detail}` : `The AI service returned an error (HTTP ${status}).`);
      }

      try {
        const data = JSON.parse(text);
        const choice = data.choices[0];
        return {
          message: { content: choice.message.content ?? null, tool_calls: choice.message.tool_calls },
          finishReason: choice.finish_reason ?? "stop",
        };
      } catch {
        throw new LlmError(502, "The AI service returned a malformed response.");
      }
    },
  };
  return client;
}

function safeErrorMessage(text: string): string | null {
  try {
    const msg = JSON.parse(text)?.error?.message;
    return typeof msg === "string" ? msg.slice(0, 300) : null;
  } catch {
    return null;
  }
}

// ── JSON answers ──────────────────────────────────────────────────────────────

/** Extracts the JSON object from a model answer, tolerating code fences and surrounding prose. */
export function parseJsonObject(text: string): unknown {
  const clean = text.replace(/```(?:json)?/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in the answer.");
  return JSON.parse(clean.slice(start, end + 1));
}

/**
 * Asks for a JSON object matching `schema` (described to the model as JSON Schema) and
 * validates it. Retries once with double the token budget on an empty, truncated or
 * invalid answer.
 */
export async function completeJson<T>(
  client: LlmClient,
  schema: z.ZodType<T>,
  opts: { model: string; fallbackModel?: string; system: string; user: string; maxTokens: number; reasoningEffort?: "low" | "medium" | "high" },
): Promise<T> {
  const shape = JSON.stringify(z.toJSONSchema(schema));
  const system = `${opts.system}\n\nReply with only a JSON object (no markdown) that matches this JSON Schema:\n${shape}`;
  let lastError = "no answer";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { message } = await client.complete({
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      messages: [{ role: "system", content: system }, { role: "user", content: opts.user }],
      maxTokens: opts.maxTokens * 2 ** attempt,
      reasoningEffort: opts.reasoningEffort,
      temperature: 0.1,
      json: true,
    });
    try {
      const parsed = schema.safeParse(parseJsonObject(message.content ?? ""));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues[0]?.message ?? "invalid shape";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    console.warn(`[llm] Unusable JSON answer (attempt ${attempt + 1}): ${lastError}`);
  }
  throw new LlmError(502, "The AI helper gave an answer we couldn't use. Please try again.");
}
