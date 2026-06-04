import OpenAI from 'openai'

/**
 * Generic OpenAI-compatible LLM client. Defaults to Nebius AI Studio; override
 * via env. Used by the `agent` runtime workflows. Callers own their own scripted
 * fallback: complete()/completeJSON() THROW when unconfigured or on error, and
 * the workflow decides what canned content to use instead.
 */

const BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.studio.nebius.ai/v1/'
const API_KEY = process.env.LLM_API_KEY ?? process.env.NEBIUS_API_KEY ?? ''
const MODEL = process.env.LLM_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct'

export function llmConfigured(): boolean {
  return API_KEY.length > 0
}

export function llmInfo(): { baseURL: string; model: string; configured: boolean } {
  return { baseURL: BASE_URL, model: MODEL, configured: llmConfigured() }
}

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!llmConfigured()) throw new Error('LLM not configured (set LLM_API_KEY / NEBIUS_API_KEY)')
  if (!client) client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL, timeout: 45_000, maxRetries: 1 })
  return client
}

export interface CompleteOpts {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}

export async function complete(opts: CompleteOpts): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 1400,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  })
  return res.choices[0]?.message?.content ?? ''
}

/** Best-effort JSON extraction: strips code fences and grabs the outer {...}. */
export function parseJSONLoose<T>(text: string): T {
  let s = text.trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s) as T
}

export async function completeJSON<T>(opts: CompleteOpts): Promise<T> {
  const text = await complete({
    ...opts,
    system: `${opts.system}\n\nRespond with a single valid JSON object and nothing else.`,
  })
  return parseJSONLoose<T>(text)
}
