/**
 * Ollama Vision Client
 * Thin wrapper around the local Ollama API for vision + chat completions.
 * Handles retries, timeouts, and streaming.
 */

export const OLLAMA_BASE = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || 'http://100.75.214.23:11434';
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:4b';
export const TEXT_MODEL   = process.env.OLLAMA_TEXT_MODEL   || 'k2-horizon:3.7b';
export const EMBED_MODEL  = process.env.OLLAMA_EMBED_MODEL  || 'nomic-embed-text:latest';

const DEFAULT_TIMEOUT_MS = 120_000; // vision calls can take ~30-60s on CPU
const MAX_RETRIES = 2;

/**
 * Call Ollama vision API with one or more base64 images.
 * Returns the model's text response.
 *
 * @param {string} prompt      - The instruction for the model
 * @param {string[]} images    - Array of base64-encoded PNG/JPEG images (no data: prefix)
 * @param {object} opts
 * @param {string} [opts.model]   - Override model (default: qwen3-vl:4b)
 * @param {number} [opts.timeout] - Override timeout in ms
 * @param {object} [opts.options] - Ollama sampling options
 */
export async function ollamaVision(prompt, images = [], opts = {}) {
  const model   = opts.model   ?? VISION_MODEL;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;

  const body = JSON.stringify({
    model,
    prompt,
    images,
    stream: false,
    options: {
      temperature: 0,           // deterministic extraction
      num_ctx: 8192,            // enough for a full bank statement page
      repeat_penalty: 1.05,
      ...opts.options,
    },
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const content = data.response && data.response.trim().length > 0 ? data.response : (data.thinking ?? '');
      return content;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`[ollamaVision] attempt ${attempt + 1} failed: ${err.message}, retrying…`);
      await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Call Ollama chat API (no images). Used for rule reasoning and categorization.
 * Defaults to K2 Horizon 3.7B for fast, accurate text/GL reasoning.
 */
export async function ollamaChat(systemPrompt, userMessage, opts = {}) {
  const model   = opts.model   ?? TEXT_MODEL;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;

  const bodyObj = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
    stream: false,
    options: {
      temperature: 0,
      num_ctx: 8192,
      ...opts.options,
    },
  };
  if (opts.format) {
    bodyObj.format = opts.format;
  }
  const body = JSON.stringify(bodyObj);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Ollama chat HTTP ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const rawContent = data.message?.content?.trim();
      if (rawContent && rawContent.length > 0) return rawContent;
      return data.message?.thinking ?? '';
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`[ollamaChat] attempt ${attempt + 1} failed: ${err.message}, retrying…`);
      await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Check if Ollama is reachable and the model is available. */
export async function checkOllamaReady(model = VISION_MODEL) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ready: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    const modelClean = model.split(':')[0];
    const hasModel = models.some((m) => m === model || m.startsWith(`${modelClean}:`));
    if (!hasModel) {
      return { ready: false, reason: `Model "${model}" not pulled. Run: ollama pull ${model}` };
    }
    return { ready: true, models };
  } catch (err) {
    return { ready: false, reason: err.message };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
