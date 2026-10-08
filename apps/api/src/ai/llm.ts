/**
 * Phase 11 — OpenAI-compatible chat client (DeepSeek / OpenAI / Claude-via-proxy).
 * Never log apiKey, request bodies, or Authorization headers.
 */
import { AppError } from "@adlinklab/shared";

export class AiError extends AppError {
  constructor(message: string, statusCode = 502) {
    super(message, { code: "AI_ERROR", statusCode });
    this.name = "AiError";
  }
}

export interface ChatJsonArgs {
  baseUrl: string;
  model: string;
  /** Plaintext key — caller's responsibility to source from encrypted storage. */
  apiKey: string;
  system: string;
  user: string;
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Call chatJson and validate the result, retrying ONCE with targeted feedback
 * when validation fails. Smaller models often need the nudge; the retry tells
 * them exactly which field was wrong.
 */
export async function chatJsonValidated<T>(
  args: ChatJsonArgs,
  validate: (obj: unknown) => T,
  impl: typeof chatJson = chatJson,
): Promise<T> {
  const raw = await impl(args);
  try {
    return validate(raw);
  } catch (e) {
    const reason = e instanceof AiError ? e.message : "invalid shape";
    const retry = await impl({
      ...args,
      system:
        `${args.system}\n\nIMPORTANT: your previous response was rejected (${reason}). ` +
        `Return ONLY the corrected STRICT JSON object matching the spec — no markdown fences, no commentary, no extra text.`,
    });
    return validate(retry);
  }
}

/**
 * POST {baseUrl}/chat/completions with response_format json_object.
 * Returns the parsed JSON body. Throws AiError (safe messages only) on
 * network failure, non-2xx status, or invalid JSON.
 */
export async function chatJson(args: ChatJsonArgs): Promise<unknown> {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // apiKey intentionally not logged anywhere on this path.
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AiError("LLM request failed: network error");
  }
  if (!res.ok) {
    throw new AiError(`LLM request failed (status ${res.status})`);
  }
  const text = await res.text();
  let envelope: unknown;
  try {
    envelope = JSON.parse(text) as unknown;
  } catch {
    throw new AiError("LLM returned invalid JSON");
  }
  return JSON.parse(extractJson(extractContent(envelope))) as unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Unwrap the OpenAI-compatible chat-completion envelope:
 * { choices: [{ message: { content: "<model JSON>" } }] }.
 */
function extractContent(envelope: unknown): string {
  if (isRecord(envelope)) {
    const choices = envelope["choices"];
    if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])) {
      const message = (choices[0] as Record<string, unknown>)["message"];
      if (isRecord(message) && typeof message["content"] === "string") {
        return message["content"];
      }
    }
  }
  throw new AiError("LLM returned an unexpected response envelope");
}

/**
 * Models sometimes wrap the JSON in markdown code fences despite being asked
 * not to (or when response_format is not honored). Strip them defensively.
 */
function extractJson(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return fence[1].trim();
  return t;
}
