/**
 * Minimal provider-agnostic LLM client for KG enrichment.
 * Supports OpenAI, OpenRouter (OpenAI-compatible) and Anthropic. No SDK — just
 * fetch — so it adds no dependencies. JSON-only responses.
 */

export interface LlmConfig {
  provider: 'openai' | 'openrouter' | 'anthropic';
  model: string;
  apiKey: string;
}

/** Resolve provider/model/key from env, or null when no key is configured. */
export function resolveLlmConfig(): LlmConfig | null {
  const provider = (process.env.KG_LLM_PROVIDER || 'openai').toLowerCase() as LlmConfig['provider'];
  const apiKey =
    provider === 'openrouter'
      ? process.env.OPENROUTER_API_KEY
      : provider === 'anthropic'
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model =
    process.env.KG_LLM_MODEL ||
    // Anthropic default: Haiku 4.5 (claude-3-5-haiku was retired Feb 2026).
    (provider === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-4o-mini');
  return { provider, model, apiKey };
}

export interface LlmResult {
  json: any;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Call the model and parse its reply as JSON. Throws on transport/parse error. */
export async function chatJson(
  cfg: LlmConfig,
  system: string,
  user: string,
  maxTokens = 1500,
): Promise<LlmResult> {
  if (cfg.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        temperature: 0,
        // System prompt as a cacheable block: the instructions are identical
        // across calls, so prompt caching serves them at ~0.1x on repeats.
        // (Only kicks in once the prefix passes the model's cache minimum;
        // harmless otherwise.) OpenAI/OpenRouter cache automatically.
        system: [
          {
            type: 'text',
            text: system + '\nRespond with a single JSON object and nothing else.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = j.content?.[0]?.text ?? '{}';
    return {
      json: JSON.parse(stripFences(text)),
      usage: { inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens },
    };
  }

  const base =
    cfg.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content ?? '{}';
  return {
    json: JSON.parse(stripFences(text)),
    usage: { inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens },
  };
}

function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  return t;
}
