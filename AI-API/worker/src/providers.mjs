/**
 * Provider adapters.
 *
 *  • Workers AI  — called through the `AI` binding (no API token, no account id,
 *                  no billed third party). Native responses are translated into
 *                  OpenAI `chat.completion` / `chat.completion.chunk` shapes.
 *  • Groq        — called with the *user's own* key (BYOK). The upstream API is
 *                  already OpenAI-compatible, so the body is forwarded and the
 *                  response is streamed back almost verbatim.
 *
 * No other provider is reachable and there is no fallback path: if Workers AI is
 * over budget the request fails with a documented 429 instead of being billed.
 */

import { estimateMessageTokens, estimateTokens, nowSec } from './util.mjs';

export const GROQ_BASE = 'https://api.groq.com/openai/v1';

/* ── request validation / normalisation ───────────────────────────────────── */

const MAX_MESSAGES = 40;
const MAX_TOOLS = 16;
const MAX_TOOL_CHARS = 24_000;
const MAX_STRING_PART = 32_000;

function normalizeContent(content) {
  if (typeof content === 'string') return { ok: true, value: content };
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') return { ok: false, message: 'Invalid message content part.' };
      if (part.type === 'text') {
        if (typeof part.text !== 'string') return { ok: false, message: 'Text content parts need a string `text`.' };
        parts.push({ type: 'text', text: part.text });
      } else {
        return {
          ok: false,
          message: `Content type "${String(part.type).slice(0, 40)}" is not supported by this gateway. Send text only.`,
          code: 'unsupported_content',
        };
      }
    }
    return { ok: true, value: parts };
  }
  return { ok: false, message: 'Message `content` must be a string or an array of text parts.' };
}

/**
 * Validate + clamp an OpenAI chat request. Returns `{ok, error}` on rejection and
 * `{ok:true, value}` with a normalised request otherwise.
 */
export function normalizeChatRequest(body, model) {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: '`messages` must be a non-empty array.' };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, message: `At most ${MAX_MESSAGES} messages per request.` };
  }

  const normalized = [];
  let totalChars = 0;
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') return { ok: false, message: 'Each message must be an object.' };
    let role = String(raw.role || '');
    if (role === 'developer') role = 'system';
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
      return { ok: false, message: `Unsupported message role "${role.slice(0, 24)}".`, code: 'invalid_message' };
    }
    const content = normalizeContent(raw.content ?? '');
    if (!content.ok) return { ok: false, message: content.message, code: content.code || 'invalid_message' };

    const message = { role, content: content.value };
    if (role === 'tool') {
      if (typeof raw.tool_call_id !== 'string' || !raw.tool_call_id) {
        return { ok: false, message: 'Tool messages need a `tool_call_id`.' };
      }
      message.tool_call_id = raw.tool_call_id.slice(0, 64);
    }
    if (role === 'assistant' && Array.isArray(raw.tool_calls)) {
      if (!model.supportsTools) {
        return { ok: false, message: `Model ${model.id} does not support tool calling on this gateway.`, code: 'unsupported_feature' };
      }
      message.tool_calls = raw.tool_calls.slice(0, MAX_TOOLS).map(call => ({
        id: String(call?.id || '').slice(0, 64),
        type: 'function',
        function: {
          name: String(call?.function?.name || '').slice(0, 64),
          arguments: typeof call?.function?.arguments === 'string' ? call.function.arguments.slice(0, MAX_STRING_PART) : '{}',
        },
      }));
    }
    if (typeof raw.name === 'string') message.name = raw.name.slice(0, 64);

    totalChars += typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content).length;
    totalChars += JSON.stringify(message.tool_calls || '').length;
    normalized.push(message);
  }

  const contextCap = model.contextChars || 48_000;
  if (totalChars > contextCap) {
    return {
      ok: false,
      message: `Conversation is ${totalChars} characters; ${model.id} accepts about ${contextCap} on this gateway. Trim the history or start a new thread.`,
      code: 'context_length_exceeded',
    };
  }

  let streams = false;
  if (body.stream !== undefined) {
    if (typeof body.stream !== 'boolean') return { ok: false, message: '`stream` must be a boolean.' };
    streams = body.stream;
  }

  let tools;
  if (body.tools !== undefined && body.tools !== null) {
    if (!model.supportsTools) {
      return { ok: false, message: `Model ${model.id} does not support tool calling on this gateway.`, code: 'unsupported_feature', param: 'tools' };
    }
    if (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS) {
      return { ok: false, message: `\`tools\` must be an array of at most ${MAX_TOOLS} functions.`, param: 'tools' };
    }
    const serialized = JSON.stringify(body.tools);
    if (serialized.length > MAX_TOOL_CHARS) {
      return { ok: false, message: 'Tool schemas are too large.', code: 'request_too_large', param: 'tools' };
    }
    tools = body.tools.map(tool => ({
      type: 'function',
      function: {
        name: String(tool?.function?.name || '').slice(0, 64),
        description: tool?.function?.description ? String(tool.function.description).slice(0, 1024) : undefined,
        parameters: tool?.function?.parameters && typeof tool.function.parameters === 'object' ? tool.function.parameters : { type: 'object', properties: {} },
      },
    }));
    if (tools.some(t => !/^[A-Za-z0-9_-]{1,64}$/.test(t.function.name))) {
      return { ok: false, message: 'Tool function names must match [A-Za-z0-9_-]{1,64}.', param: 'tools' };
    }
  }

  const requestedMax = body.max_completion_tokens ?? body.max_tokens;
  let maxTokens = Number.isFinite(Number(requestedMax)) ? Math.floor(Number(requestedMax)) : Math.min(512, model.maxOutput);
  maxTokens = Math.min(model.maxOutput, Math.max(1, maxTokens));

  if (body.n !== undefined && Number(body.n) !== 1) {
    return { ok: false, message: 'This gateway only supports n = 1.', code: 'unsupported_parameter', param: 'n' };
  }
  if (body.logprobs === true || body.top_logprobs) {
    return { ok: false, message: 'logprobs are not supported by this gateway.', code: 'unsupported_parameter', param: 'logprobs' };
  }
  if (body.audio || body.modalities) {
    return { ok: false, message: 'Audio and non-text modalities are not supported.', code: 'unsupported_feature' };
  }

  let stop;
  if (typeof body.stop === 'string') stop = [body.stop.slice(0, 64)];
  else if (Array.isArray(body.stop)) stop = body.stop.slice(0, 4).map(s => String(s).slice(0, 64));

  const temperature = Number.isFinite(Number(body.temperature))
    ? Math.min(2, Math.max(0, Number(body.temperature)))
    : 0.7;
  const topP = Number.isFinite(Number(body.top_p))
    ? Math.min(1, Math.max(0, Number(body.top_p)))
    : undefined;

  let responseFormat;
  if (body.response_format && typeof body.response_format === 'object') {
    if (body.response_format.type === 'text') responseFormat = { type: 'text' };
    else if (body.response_format.type === 'json_object') responseFormat = { type: 'json_object' };
    else return { ok: false, message: 'Only response_format text and json_object are supported.', code: 'unsupported_parameter', param: 'response_format' };
  }

  return {
    ok: true,
    value: {
      messages: normalized,
      stream: streams,
      tools,
      toolChoice: typeof body.tool_choice === 'string' || (body.tool_choice && typeof body.tool_choice === 'object') ? body.tool_choice : undefined,
      maxTokens,
      temperature,
      topP,
      stop,
      responseFormat,
      frequencyPenalty: Number.isFinite(Number(body.frequency_penalty)) ? Math.min(2, Math.max(-2, Number(body.frequency_penalty))) : undefined,
      presencePenalty: Number.isFinite(Number(body.presence_penalty)) ? Math.min(2, Math.max(-2, Number(body.presence_penalty))) : undefined,
      seed: Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : undefined,
      includeUsage: body?.stream_options?.include_usage === true,
      inputTokens: estimateMessageTokens(normalized) + estimateTokens(JSON.stringify(tools || '')),
    },
  };
}

/* ── Workers AI ───────────────────────────────────────────────────────────── */

function chunkId() {
  return 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

function sseHeaders(requestId) {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-request-id': requestId,
  };
}

export function sseResponse(stream, requestId) {
  return new Response(stream, { status: 200, headers: { ...sseHeaders(requestId) } });
}

/** Convert the Workers AI chunk stream into OpenAI `chat.completion.chunk` events. */
function translateWorkersStream(rawStream, modelId, requestId, onUsage, inputTokens) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = chunkId();
  const created = nowSec();
  let buffer = '';
  let started = false;
  let finished = false;
  let outputChars = 0;
  let toolIndex = 0;
  let usageFromProvider = null;

  const frame = payload => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const emit = (controller, delta, finishReason = null) => {
    controller.enqueue(frame({
      id,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }));
  };

  const start = controller => {
    if (started) return;
    started = true;
    emit(controller, { role: 'assistant', content: '' });
  };

  const handleObject = (controller, object) => {
    if (!object || typeof object !== 'object') return;
    start(controller);

    // Some models already return OpenAI-shaped chunks; forward their deltas.
    const choice = Array.isArray(object.choices) ? object.choices[0] : null;
    if (choice) {
      const delta = choice.delta || choice.message || {};
      const out = {};
      if (typeof delta.content === 'string' && delta.content) {
        out.content = delta.content;
        outputChars += delta.content.length;
      }
      if (Array.isArray(delta.tool_calls)) out.tool_calls = delta.tool_calls;
      if (Object.keys(out).length) emit(controller, out);
      if (choice.finish_reason) {
        emit(controller, {}, choice.finish_reason);
        finished = true;
      }
      if (object.usage) usageFromProvider = object.usage;
      return;
    }

    if (typeof object.response === 'string' && object.response) {
      outputChars += object.response.length;
      emit(controller, { content: object.response });
    }
    if (Array.isArray(object.tool_calls) && object.tool_calls.length) {
      emit(controller, {
        tool_calls: object.tool_calls.map(call => ({
          index: toolIndex++,
          id: String(call.id || crypto.randomUUID()).slice(0, 64),
          type: 'function',
          function: {
            name: String(call.name || call.function?.name || '').slice(0, 64),
            arguments: typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments ?? call.function?.arguments ?? {}),
          },
        })),
      });
    }
    if (object.usage) usageFromProvider = object.usage;
  };

  return new ReadableStream({
    async start(controller) {
      const reader = rawStream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line || line.startsWith(':')) continue;
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                handleObject(controller, JSON.parse(data));
              } catch {
                // Ignore unparsable provider chatter rather than breaking the stream.
              }
            }
          }
        }
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
          const data = tail.slice(5).trim();
          if (data && data !== '[DONE]') {
            try { handleObject(controller, JSON.parse(data)); } catch { /* ignore */ }
          }
        }
        start(controller);
        if (!finished) emit(controller, {}, 'stop');
        if (usageFromProvider) {
          const usage = normalizeUsage(usageFromProvider, modelId, outputChars);
          controller.enqueue(frame({ id, object: 'chat.completion.chunk', created, model: modelId, choices: [], usage }));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        try {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ error: { message: 'The provider stream ended unexpectedly.', type: 'upstream_error', code: 'stream_failed' } })}\n\n`,
          ));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch { /* controller already closed */ }
        controller.close();
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        onUsage?.({
          inputTokens: usageFromProvider ? Number(usageFromProvider.prompt_tokens) || inputTokens : inputTokens,
          outputTokens: usageFromProvider ? Number(usageFromProvider.completion_tokens) || 0 : Math.ceil(outputChars / 4),
          providerUsage: Boolean(usageFromProvider),
        });
      }
    },
  });
}

function normalizeUsage(usage, modelId, outputChars = 0) {
  if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
    return {
      prompt_tokens: Number(usage.prompt_tokens) || 0,
      completion_tokens: Number(usage.completion_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0),
    };
  }
  const completion = Math.max(0, Math.ceil(outputChars / 4));
  return {
    prompt_tokens: Number(usage?.input_tokens) || 0,
    completion_tokens: completion,
    total_tokens: (Number(usage?.input_tokens) || 0) + completion,
  };
}

function normalizeToolCalls(calls) {
  return calls.slice(0, MAX_TOOLS).map(call => ({
    id: String(call.id || crypto.randomUUID()).slice(0, 64),
    type: 'function',
    function: {
      name: String(call.name || call.function?.name || '').slice(0, 64),
      arguments: typeof call.arguments === 'string'
        ? call.arguments
        : JSON.stringify(call.arguments ?? call.function?.arguments ?? {}),
    },
  }));
}

export async function callWorkersAI(env, model, request, options = {}) {
  const requestId = options.requestId || 'req_local';
  const input = {
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    stream: request.stream,
  };
  if (request.topP !== undefined) input.top_p = request.topP;
  if (request.stop) input.stop = request.stop;
  if (request.responseFormat) input.response_format = request.responseFormat;
  if (request.tools) {
    input.tools = request.tools;
    if (request.toolChoice) input.tool_choice = request.toolChoice;
  }

  if (request.stream) {
    let usagePromise;
    const usage = new Promise(resolve => { usagePromise = resolve; });
    const raw = await env.AI.run(model.id, input);
    if (!raw || typeof raw.getReader !== 'function') {
      // Some models ignore `stream` and answer with a JSON object.
      const body = normalizeWorkersResult(raw, model.id, request);
      const text = JSON.stringify(body);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: body.id, object: 'chat.completion.chunk', created: body.created, model: body.model,
            choices: [{ index: 0, delta: { role: 'assistant', content: body.choices[0].message.content || '' }, finish_reason: null }],
          })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: body.id, object: 'chat.completion.chunk', created: body.created, model: body.model,
            choices: [{ index: 0, delta: {}, finish_reason: body.choices[0].finish_reason }],
          })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          usagePromise({ inputTokens: request.inputTokens, outputTokens: estimateTokens(text), providerUsage: false });
        },
      });
      return { response: sseResponse(stream, requestId), usage, streamed: true };
    }
    const stream = translateWorkersStream(raw, model.id, requestId, usagePromise, request.inputTokens);
    return { response: sseResponse(stream, requestId), usage, streamed: true };
  }

  const result = await env.AI.run(model.id, input);
  const body = normalizeWorkersResult(result, model.id, request);
  const usage = {
    inputTokens: body.usage.prompt_tokens || request.inputTokens,
    outputTokens: body.usage.completion_tokens,
    providerUsage: Boolean(result?.usage),
  };
  return { response: Response.json(body, { headers: { 'x-request-id': requestId } }), usage, streamed: false };
}

export function normalizeWorkersResult(result, modelId, request) {
  if (!result || typeof result !== 'object') {
    throw Object.assign(new Error('The model returned an empty response.'), { code: 'upstream_error' });
  }
  if (result.choices && Array.isArray(result.choices)) {
    // Already OpenAI-shaped (some Workers AI models return this).
    const message = result.choices[0]?.message || { role: 'assistant', content: '' };
    const outputChars = typeof message.content === 'string' ? message.content.length : 0;
    return {
      id: result.id || chunkId(),
      object: 'chat.completion',
      created: result.created || nowSec(),
      model: modelId,
      choices: [{
        index: 0,
        message,
        finish_reason: result.choices[0]?.finish_reason || (message.tool_calls ? 'tool_calls' : 'stop'),
      }],
      usage: normalizeUsage(result.usage, modelId, outputChars),
    };
  }

  let text = result.response;
  if (typeof text !== 'string') {
    text = typeof result.output_text === 'string' ? result.output_text : '';
  }
  const toolCalls = Array.isArray(result.tool_calls) && result.tool_calls.length
    ? normalizeToolCalls(result.tool_calls)
    : undefined;
  const message = { role: 'assistant', content: text || (toolCalls ? null : '') };
  if (toolCalls) message.tool_calls = toolCalls;
  const finish = toolCalls ? 'tool_calls' : (typeof result.finish_reason === 'string' ? result.finish_reason : 'stop');
  return {
    id: result.id || chunkId(),
    object: 'chat.completion',
    created: result.created || nowSec(),
    model: modelId,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: result.usage
      ? normalizeUsage(result.usage, modelId, text.length)
      : {
        prompt_tokens: request.inputTokens,
        completion_tokens: Math.max(1, estimateTokens(text)),
        total_tokens: request.inputTokens + Math.max(1, estimateTokens(text)),
      },
  };
}

/* ── Groq (BYOK) ──────────────────────────────────────────────────────────── */

export async function callGroq(env, model, request, apiKey, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const requestId = options.requestId || 'req_local';
  const payload = {
    model: model.id,
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    stream: request.stream,
  };
  if (request.topP !== undefined) payload.top_p = request.topP;
  if (request.stop) payload.stop = request.stop;
  if (request.tools) payload.tools = request.tools;
  if (request.toolChoice) payload.tool_choice = request.toolChoice;
  if (request.responseFormat) payload.response_format = request.responseFormat;
  if (request.frequencyPenalty !== undefined) payload.frequency_penalty = request.frequencyPenalty;
  if (request.presencePenalty !== undefined) payload.presence_penalty = request.presencePenalty;
  if (request.seed !== undefined) payload.seed = request.seed;
  if (request.stream) payload.stream_options = { include_usage: true };

  const upstream = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: request.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    let message = `Groq rejected the request (${upstream.status}).`;
    let code = 'provider_error';
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) message = String(parsed.error.message).slice(0, 300);
      if (parsed?.error?.code) code = String(parsed.error.code).slice(0, 60);
    } catch { /* keep default */ }
    const error = new Error(message);
    error.code = code;
    error.status = upstream.status === 429 ? 429 : 502;
    error.retryAfter = upstream.headers.get('retry-after');
    error.provider = 'groq';
    throw error;
  }

  if (request.stream) {
    let resolveUsage;
    const usage = new Promise(resolve => { resolveUsage = resolve; });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let chars = 0;
    let providerUsage = null;
    let buffer = '';

    const counted = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) providerUsage = parsed.usage;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') chars += delta.length;
          } catch { /* ignore */ }
        }
      },
      flush() {
        resolveUsage({
          inputTokens: providerUsage ? Number(providerUsage.prompt_tokens) || request.inputTokens : request.inputTokens,
          outputTokens: providerUsage ? Number(providerUsage.completion_tokens) || 0 : Math.ceil(chars / 4),
          providerUsage: Boolean(providerUsage),
        });
      },
    });

    return {
      response: new Response(upstream.body.pipeThrough(counted), { status: 200, headers: sseHeaders(requestId) }),
      usage,
      streamed: true,
    };
  }

  const body = await upstream.json();
  const outputChars = typeof body?.choices?.[0]?.message?.content === 'string'
    ? body.choices[0].message.content.length
    : 0;
  if (body && typeof body === 'object') body.model = body.model || model.id;
  const usage = {
    inputTokens: body?.usage?.prompt_tokens ?? request.inputTokens,
    outputTokens: body?.usage?.completion_tokens ?? Math.ceil(outputChars / 4),
    providerUsage: Boolean(body?.usage),
  };
  return {
    response: Response.json(body, { headers: { 'x-request-id': requestId } }),
    usage,
    streamed: false,
  };
}

/** Verify a Groq key with a cheap, non-inference call. */
export async function verifyGroqKey(apiKey, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !/^gsk_[A-Za-z0-9_-]{16,200}$/.test(apiKey)) {
    return { ok: false, message: 'That does not look like a Groq API key (expected gsk_…).' };
  }
  const res = await fetchImpl(`${GROQ_BASE}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'Groq rejected that key.' };
  if (!res.ok) return { ok: false, message: `Groq returned ${res.status} while checking the key.` };
  return { ok: true };
}
