/**
 * Explicit provider / model allowlist.
 *
 * Nothing outside these tables can be requested. There is no wildcard, no
 * passthrough of arbitrary model ids and no automatic fallback to a paid account.
 *
 * `neurons.in` / `neurons.out` are ESTIMATES of Cloudflare's published Neuron
 * rates per million tokens, used only to budget the shared free pool. Cloudflare
 * bills the real GPU cost, which can differ; keep a safety margin. Source figures
 * are derived from the Workers AI per-token prices (Neurons = USD/1M ÷ 0.011 ×
 * 1,000 as of October 2026). Re-check them on the Workers AI pricing page and edit
 * this table if you want a tighter budget.
 */

export const FREE_PROVIDER = 'workers-ai';
export const BYOK_PROVIDER = 'groq';

export const WORKERS_AI_MODELS = [
  {
    id: '@cf/meta/llama-3.2-3b-instruct',
    label: 'Llama 3.2 3B Instruct',
    provider: FREE_PROVIDER,
    enabled: true,
    maxOutput: 768,
    contextChars: 48_000,
    supportsStream: true,
    supportsTools: false,
    neurons: { in: 3_000, out: 10_000 },
    note: 'Cheapest free-pool model. Good for short answers, classification and HTSilo.',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B Instruct',
    provider: FREE_PROVIDER,
    enabled: true,
    maxOutput: 1024,
    contextChars: 96_000,
    supportsStream: true,
    supportsTools: true,
    neurons: { in: 4_100, out: 34_900 },
    note: 'Default free-pool general model.',
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B Instruct (FP8 Fast)',
    provider: FREE_PROVIDER,
    enabled: true,
    maxOutput: 1024,
    contextChars: 96_000,
    supportsStream: true,
    supportsTools: true,
    neurons: { in: 26_700, out: 204_800 },
    note: 'Best free-pool quality, roughly 12× the Neuron cost of the 8B model.',
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen2.5 Coder 32B Instruct',
    provider: FREE_PROVIDER,
    enabled: false,
    maxOutput: 1024,
    contextChars: 96_000,
    supportsStream: true,
    supportsTools: false,
    neurons: { in: 20_000, out: 120_000 },
    note: 'Disabled by default: confirm the exact model id exists in your Workers AI catalogue before enabling.',
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    provider: FREE_PROVIDER,
    enabled: false,
    maxOutput: 1024,
    contextChars: 96_000,
    supportsStream: true,
    supportsTools: true,
    neurons: { in: 31_800, out: 68_200 },
    note: 'Disabled by default: highest Neuron cost per request in the catalogue.',
  },
];

export const GROQ_MODELS = [
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant (Groq)',
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 96_000,
    supportsStream: true,
    supportsTools: true,
  },
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B Versatile (Groq)',
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128_000,
    supportsStream: true,
    supportsTools: true,
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B (Groq)',
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128_000,
    supportsStream: true,
    supportsTools: true,
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B (Groq)',
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128_000,
    supportsStream: true,
    supportsTools: true,
  },
  {
    id: 'qwen/qwen3-32b',
    label: 'Qwen3 32B (Groq)',
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128_000,
    supportsStream: true,
    supportsTools: true,
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B (Groq)',
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128_000,
    supportsStream: true,
    supportsTools: true,
  },
];

export const AUTO_MODEL = 'auto';
export const AUTO_FREE_MODEL = '@cf/meta/llama-3.1-8b-instruct';
export const AUTO_BYOK_MODEL = 'llama-3.1-8b-instant';

const BY_ID = new Map([...WORKERS_AI_MODELS, ...GROQ_MODELS].map(m => [m.id, m]));

/** Look up an allowlisted model. Returns null for anything unknown or disabled. */
export function resolveModel(id) {
  if (typeof id !== 'string') return null;
  const model = BY_ID.get(id);
  if (!model) return null;
  if (model.provider === FREE_PROVIDER && model.enabled === false) return null;
  return model;
}

export function isGroqModel(id) {
  return GROQ_MODELS.some(m => m.id === id);
}

/** Free-pool models only, in the order they should be advertised. */
export function freePoolModels() {
  return WORKERS_AI_MODELS.filter(m => m.enabled);
}

/** Estimated Neuron cost of one request, used for reservation and reporting. */
export function estimateNeurons(model, inputTokens, outputTokens) {
  if (!model || model.provider !== FREE_PROVIDER) return 0;
  const rates = model.neurons || { in: 10_000, out: 50_000 };
  return Math.ceil((inputTokens * rates.in + outputTokens * rates.out) / 1_000_000);
}

/** OpenAI `GET /v1/models` payload. `x_ht` carries our own metadata. */
export function modelsPayload(env, { hasByok }) {
  const freeCap = Number(env.FREE_DAILY_NEURONS || 6000);
  return {
    object: 'list',
    data: [
      ...freePoolModels().map(m => ({
        id: m.id,
        object: 'model',
        created: 0,
        owned_by: 'cloudflare-workers-ai',
        x_ht: {
          provider: FREE_PROVIDER,
          label: m.label,
          free_pool: true,
          available: true,
          streaming: m.supportsStream,
          tools: m.supportsTools,
          max_output_tokens: m.maxOutput,
          est_neurons_per_1k_in: Math.ceil(m.neurons.in / 1000),
          daily_pool_neurons: freeCap,
        },
      })),
      ...GROQ_MODELS.map(m => ({
        id: m.id,
        object: 'model',
        created: 0,
        owned_by: 'groq',
        x_ht: {
          provider: BYOK_PROVIDER,
          label: m.label,
          free_pool: false,
          available: Boolean(hasByok),
          requires_byok: true,
          streaming: m.supportsStream,
          tools: m.supportsTools,
          max_output_tokens: m.maxOutput,
        },
      })),
      {
        id: AUTO_MODEL,
        object: 'model',
        created: 0,
        owned_by: 'htmltools',
        x_ht: {
          provider: 'auto',
          label: 'Auto (own Groq key first, then shared free pool)',
          free_pool: true,
          available: true,
          streaming: true,
          tools: false,
        },
      },
    ],
  };
}
