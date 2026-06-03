/**
 * Thin client for a local Ollama server. Used by the offline military-data
 * pipeline (scripts/military.ts) to turn messy Wikipedia tables into clean,
 * map-keyed JSON. This is NOT used on the live request path — production has
 * no Ollama; the pipeline runs on the dev machine and commits its output.
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3-coder:latest';

export interface OllamaOpts {
  model?: string;
  /** Context window. Default 8192 — bump for very large prompts. */
  numCtx?: number;
  /** Sampling temperature. Default 0 for deterministic extraction. */
  temperature?: number;
}

/**
 * Send `prompt` to Ollama with `format: "json"` so the model is constrained to
 * emit a single valid JSON document, then parse and return it. Throws on a
 * non-200 response or unparseable body.
 */
export async function ollamaGenerateJSON<T>(prompt: string, opts: OllamaOpts = {}): Promise<T> {
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? OLLAMA_MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: opts.temperature ?? 0,
        num_ctx: opts.numCtx ?? 8192,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { response?: string };
  const raw = (data.response ?? '').trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    // format:json should prevent this, but guard against a stray prose wrapper.
    const start = raw.search(/[[{]/);
    const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T;
    throw new Error(`Ollama returned non-JSON: ${raw.slice(0, 200)}`);
  }
}

/** Quick reachability probe so the pipeline can fail with a friendly message. */
export async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

export const ollamaConfig = { host: OLLAMA_HOST, model: OLLAMA_MODEL };
