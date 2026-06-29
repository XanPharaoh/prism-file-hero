import pLimit from 'p-limit';
import type { ToolID } from '../types';

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

const TOOL_PROMPTS: Record<string, string> = {
  'pdf-to-excel': `Extract ALL data from these images into a clean spreadsheet structure. 
  Ensure verbatim accuracy, language agnostic extraction, and strict column fidelity. 
  Return a valid JSON object with 'document_metadata' and 'rows' array. 
  DO NOT attempt to calculate, verify, or reconcile mathematical balances. Focus solely on accurate text and number transcription.`,
  'pdf-to-word': `Perform high-fidelity document reconstruction as structured Markdown. Preserve headings, lists, and tables.`,
  'ocr': `Provide a COMPLETE, exhaustive, word-for-word transcript of the text in these images. Do not summarize.`,
  'compare': `Compare the two provided documents thoroughly and list all differences, additions, and deletions.`,
  'redact': `Analyze these document pages and identify EVERY SINGLE instance of PII (names, IDs, account numbers, addresses). Return bounding boxes.`,
  'grammar-check': `Perform a comprehensive grammar, spelling, and style check. Return corrected text with explanations.`,
};

const MAX_IMAGES_PER_REQUEST = 3;
const MAX_CONCURRENCY = 2;
const limit = pLimit(MAX_CONCURRENCY);

interface ImageInput {
  base64: string;
  pageNumber: number;
  docLabel?: string;
}

/**
 * Process images through AI with concurrent batch processing.
 * Uses p-limit to control concurrency (max 2 concurrent requests).
 * Batches images into groups of MAX_IMAGES_PER_REQUEST (3) per API call.
 * Gracefully handles partial batch failures by merging successful results.
 */
export async function processWithAI(
  toolId: ToolID,
  images: ImageInput[],
  options?: Record<string, unknown>
): Promise<any> {
  const batches: ImageInput[][] = [];
  for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
    batches.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
  }

  const results = await Promise.allSettled(
    batches.map(batch => limit(() => callGroqAPI(toolId, batch, options)))
  );

  const succeeded = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);

  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn(`[AI] ${failed.length}/${batches.length} batch(es) failed.`, failed.map(f => f.reason));
  }

  if (succeeded.length === 0) {
    throw new Error('All AI batches failed. Check network and API keys.');
  }

  return mergeResults(toolId, succeeded);
}

async function callGroqAPI(
  toolId: ToolID,
  images: ImageInput[],
  options?: Record<string, unknown>,
  retryCount = 0
): Promise<any> {
  try {
    const systemPrompt = TOOL_PROMPTS[toolId] || 'Extract data accurately.';

    const content: Array<Record<string, unknown>> = images.map(img => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${img.base64}` },
    }));
    content.push({ type: 'text', text: 'Process the images according to the system prompt.' });

    const response = await fetch(`${WORKER_BASE_URL}/api/proxy-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        options,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error((errData as Record<string, unknown>).error as string || `API request failed with status ${response.status}`);
    }

    const data = await response.json();
    return parseAIResponse(data, toolId);
  } catch (err: any) {
    if (retryCount < 2 && isRetryableError(err)) {
      const delay = 1000 * Math.pow(2, retryCount);
      await new Promise(r => setTimeout(r, delay));
      return callGroqAPI(toolId, images, options, retryCount + 1);
    }
    throw err;
  }
}

function isRetryableError(err: any): boolean {
  return (
    err?.status >= 500 ||
    err?.message?.toLowerCase().includes('rate limit') ||
    err?.message?.toLowerCase().includes('timeout') ||
    err?.message?.toLowerCase().includes('network')
  );
}

function parseAIResponse(data: any, toolId: ToolID): any {
  const text = data.choices?.[0]?.message?.content || data.data || data;

  if (toolId === 'pdf-to-excel' || toolId === 'redact') {
    try {
      const jsonMatch = typeof text === 'string' ? text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) : null;
      const jsonString = jsonMatch ? jsonMatch[1] : text;
      return JSON.parse(typeof jsonString === 'string' ? jsonString : JSON.stringify(jsonString));
    } catch (e) {
      console.warn('Failed to parse JSON from AI response, returning raw text', e);
      return { rawText: text };
    }
  }
  return text;
}

function mergeResults(toolId: ToolID, results: any[]): any {
  if (toolId === 'pdf-to-excel') {
    const allRows: any[] = [];
    let metadata: Record<string, any> = {};
    results.forEach(res => {
      if (res.rows) allRows.push(...res.rows);
      if (res.document_metadata && Object.keys(metadata).length === 0) {
        metadata = res.document_metadata;
      }
    });
    return { rows: allRows, document_metadata: metadata };
  }

  if (toolId === 'redact') {
    const allRegions: any[] = [];
    results.forEach(res => {
      if (res.regions) allRegions.push(...res.regions);
    });
    return { regions: allRegions };
  }

  return { text: results.map(r => typeof r === 'string' ? r : r.rawText || JSON.stringify(r)).join('\n\n---\n\n') };
}