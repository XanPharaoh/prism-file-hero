import { z } from 'zod';
import { getUsageSummary, checkServerLimit, reportAndSummarize, reserveUsage, settleUsage } from './usageTracker';
import { isAiTool, isFreeTool } from '../../services/usageConfig';
import { activationCodeMatches, issueDeviceToken, revokeDeviceToken, sha256Base64Url, verifyDeviceToken } from './deviceTokens';
import { validateClerkClaims } from './jwtValidation';
import { verifyPaddleSignature } from './billing/paddleVerify';
import { createCustomer, createTransaction, createPortalSession, BillingNotConfigured, type PaddleEnv } from './billing/paddleApi';

interface Env {
  NVIDIA_API_KEY: string;
  GROQ_API_KEY_1?: string;
  GROQ_API_KEY_2?: string;
  MISTRAL_API_KEY_1?: string;
  MISTRAL_API_KEY_2?: string;
  MISTRAL_API_KEY_3?: string;
  /** Comma-separated explicit CORS origins. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated trusted HTTPS host suffixes for one-label preview subdomains. */
  ALLOWED_ORIGIN_SUFFIXES?: string;
  /** Legacy single-origin CORS setting, retained for existing deployments. */
  ALLOWED_ORIGIN?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Paddle webhook shared secret (sandbox or prod). Absent => webhook signature always fails. */
  PADDLE_WEBHOOK_SECRET?: string;
  /** Server-side Paddle API key for checkout/portal. Absent => billing routes return 503 (never a browser key). */
  PADDLE_API_KEY?: string;
  /** 'true' => Paddle sandbox host; else production host. */
  PADDLE_SANDBOX?: string;
  /** Allowlisted Paddle price IDs; the browser cannot supply an arbitrary price id. */
  PADDLE_PRICE_PRO?: string;
  PADDLE_PRICE_BUSINESS?: string;
  CLERK_JWKS_URL: string;
  /** Optional explicit claim configuration; issuer defaults to the JWKS origin. */
  CLERK_JWT_ISSUER?: string;
  /** Configure only when the Clerk session token/template includes aud. */
  CLERK_JWT_AUDIENCE?: string;
  /** Secret set with `wrangler secret put INTERNAL_ACTIVATION_CODE`. */
  INTERNAL_ACTIVATION_CODE?: string;
  /** Optional non-secret configuration; defaults to 90 days. */
  INTERNAL_DEVICE_TOKEN_TTL_DAYS?: string;
  /** Optional non-secret cap, constrained to 1-25 and defaulting to 10. */
  INTERNAL_MAX_ACTIVE_DEVICES?: string;
  KV: KVNamespace;
}

export function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
}

export function parseAllowedOriginSuffixes(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((suffix) => suffix.trim().toLowerCase()).filter(Boolean));
}

function allowedOrigins(env: Env): Set<string> {
  // ALLOWED_ORIGIN remains supported so existing deployed environments do not lose CORS access.
  return new Set([...parseAllowedOrigins(env.ALLOWED_ORIGINS), ...parseAllowedOrigins(env.ALLOWED_ORIGIN)]);
}

function getClientIp(request: Request): string {
  // Cloudflare sets this header at the edge; forwarded headers are client-spoofable.
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function securityHeaders(): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://integrate.api.nvidia.com https://*.cloudflare.com;",
  };
}

export function isOriginAllowed(origin: string | null, origins: ReadonlySet<string>, suffixes: ReadonlySet<string> = new Set()): boolean {
  if (origin === null || origins.has(origin)) return origin !== null;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !url.port && [...suffixes].some((suffix) => {
      const prefix = url.hostname.slice(0, -(suffix.length + 1));
      return url.hostname.endsWith(`.${suffix}`) && Boolean(prefix) && !prefix.includes(".");
    });
  } catch { return false; }
}

/** Strict CORS: only return ACAO header for known origins, block unknown origins for non-OPTIONS */
function corsHeaders(origin: string | null, origins: ReadonlySet<string>, suffixes: ReadonlySet<string>): { cors: HeadersInit; isAllowed: boolean } {
  const isAllowed = isOriginAllowed(origin, origins, suffixes);
  const headers: Record<string, string> = {
    ...securityHeaders(),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (isAllowed) headers['Access-Control-Allow-Origin'] = origin!;
  return { cors: headers, isAllowed };
}

function base64urlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

// ── Clerk RS256 JWT verification ─────────────────────────────────
// Clerk signs JWTs with RS256. We fetch the JWKS from Clerk's well-known endpoint,
// cache it in memory, and verify the signature using crypto.subtle.

interface JwkSet {
  keys: JsonWebKey[];
}

let _jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchJwks(jwksUrl: string): Promise<JsonWebKey[]> {
  if (_jwksCache && Date.now() - _jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return _jwksCache.keys;
  }
  const resp = await fetch(jwksUrl);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const jwks: JwkSet = await resp.json();
  _jwksCache = { keys: jwks.keys, fetchedAt: Date.now() };
  return jwks.keys;
}

function clerkIssuerFromJwksUrl(jwksUrl: string): string | null {
  try { return new URL(jwksUrl).origin; } catch { return null; }
}

async function verifyClerkJWT(token: string, env: Env): Promise<{ sub: string } | null> {
  const issuer = env.CLERK_JWT_ISSUER ?? clerkIssuerFromJwksUrl(env.CLERK_JWKS_URL);
  if (!issuer) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    // Parse header to get kid and verify algorithm
    const headerBytes = base64urlDecode(headerB64!);
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256') return null;
    if (!header.kid) return null;

    // Fetch JWKS and find matching key
    const keys = await fetchJwks(env.CLERK_JWKS_URL);
    const jwk = keys.find(k => (k as JsonWebKey & { kid?: string }).kid === header.kid);
    if (!jwk) return null;

    // Import the RSA public key
    const publicKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    // Verify signature
    const signingInput = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const signature = base64urlDecode(sigB64!);
    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      publicKey,
      signature as BufferSource,
      signingInput
    );
    if (!valid) return null;

    // Parse and validate payload
    const payloadBytes = base64urlDecode(payloadB64!);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    return validateClerkClaims(payload, { issuer, audience: env.CLERK_JWT_AUDIENCE });
  } catch {
    return null;
  }
}

async function verifyJWT(token: string, env: Env): Promise<{ sub: string } | null> {
  return verifyClerkJWT(token, env);
}

async function allowCounter(env: Env, key: string, limit: number, ttlSeconds: number): Promise<boolean> {
  // KV is eventually consistent: this is a conservative edge throttle, not a distributed lock.
  const existing = await env.KV.get(key, 'json') as { count?: number } | null;
  const count = (existing?.count ?? 0) + 1;
  if (count > limit) return false;
  await env.KV.put(key, JSON.stringify({ count }), { expirationTtl: ttlSeconds });
  return true;
}

async function allowActivationAttempt(env: Env, ipAddress: string): Promise<boolean> {
  return allowCounter(env, `internal-activation-rate:${await sha256Base64Url(ipAddress)}`, 10, 600);
}

async function allowGlobalIssuance(env: Env): Promise<boolean> {
  return allowCounter(env, 'internal-device-issuance-rate:v1', 10, 300);
}

async function allowDeviceRequest(env: Env, deviceId: string): Promise<boolean> {
  return allowCounter(env, `internal-device-rate:${await sha256Base64Url(deviceId)}`, 20, 60);
}

function internalMaxActiveDevices(env: Env): number {
  const configured = Number(env.INTERNAL_MAX_ACTIVE_DEVICES ?? 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 25 ? configured : 10;
}

function internalTokenTtlDays(env: Env): number {
  const configured = Number(env.INTERNAL_DEVICE_TOKEN_TTL_DAYS ?? 90);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 90;
}

function pgHeaders(env: Env): Record<string, string> {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
}
/** service-role RPC (bypasses RLS; only the Worker holds this key). */
async function pgRpc(env: Env, fn: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: pgHeaders(env), body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${String(t).slice(0, 200)}`);
  return j;
}
async function pgSelectOne(env: Env, table: string, qs: string): Promise<any> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: pgHeaders(env) });
  if (!r.ok) throw new Error(`${table} ${r.status}`);
  const rows = await r.json(); return Array.isArray(rows) ? rows[0] : null;
}
function bearer(request: Request): string {
  const h = request.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

async function proxyInternalAiRequest(env: Env, toolId: string, messages: NvidiaMessage[], cors: HeadersInit): Promise<Response> {
  try {
    const providers = getProviderChain(env, toolId);
    if (!providers.length) throw new Error('No provider configured');
    let failure = { error: 'AI processing failed. Please try again later.', status: 502 };
    for (const provider of providers) {
      const response = await callAiProvider(provider, toolId, messages);
      if (response.ok) {
        return new Response(await response.text(), { status: 200, headers: { ...(cors as Record<string, string>), 'Content-Type': 'application/json' } });
      }
      failure = mapProviderError(response.status);
      if (!shouldTryNextProvider(response.status)) break;
    }
    return Response.json({ error: failure.error }, { status: failure.status, headers: cors });
  } catch (error) {
    console.error('[Internal AI] Provider request failed:', error);
    return Response.json({ error: 'AI processing failed. Please try again later.' }, { status: 502, headers: cors });
  }
}

function currentMonth(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

type NvidiaMessage = { role: string; content: any };
type ProviderName = 'nvidia' | 'groq' | 'mistral';

interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  endpoint: string;
  model: string;
}

function getNvidiaModel(toolId: string): string {
  switch (toolId) {
    case 'redact': return 'nvidia/gliner-pii';
    case 'pdf-to-excel': return 'stockmark/stockmark-2-100b-instruct';
    case 'ocr':
    case 'ocr-to-md':
    case 'pdf-to-word':
    case 'compare':
      return 'microsoft/phi-4-multimodal-instruct';
    default:
      return 'microsoft/phi-4-mini-instruct';
  }
}

function getGroqModel(toolId: string): string {
  switch (toolId) {
    case 'pdf-to-excel':
    case 'pdf-to-word':
    case 'ocr':
    case 'ocr-to-md':
    case 'compare':
    case 'redact':
      return 'meta-llama/llama-4-scout-17b-16e-instruct';
    default:
      return 'llama-3.3-70b-versatile';
  }
}

function getMistralModel(toolId: string): string {
  switch (toolId) {
    case 'pdf-to-excel':
    case 'pdf-to-word':
    case 'ocr':
    case 'ocr-to-md':
    case 'compare':
    case 'redact':
      return 'pixtral-large-latest';
    default:
      return 'mistral-large-latest';
  }
}

// Server-owned system prompts (Batch 03). The prompt and model selection are the
// SERVER's responsibility: any client-supplied system message is stripped and the
// authoritative instruction for the tool is injected here, so a stale or hostile
// client cannot change what the model is told to do.
const SYSTEM_PROMPTS: Record<string, string> = {
  'pdf-to-excel': 'You are a financial document extraction engine. Extract tables into strict JSON: { "rows": [{ "Date": "", "Description": "", "Debit": 0, "Credit": 0, "Balance": 0 }], "document_metadata": {} }. No markdown, no commentary.',
  'redact': 'You are a PII detection engine. Return ONLY a JSON object { "regions": [{ page, x, y, width, height, text, category }] }. No markdown, no explanation.',
  'pdf-to-word': 'Reconstruct the document as structured Markdown preserving headings, lists and tables. Output Markdown only.',
  'ocr': 'Provide a COMPLETE, exhaustive, word-for-word transcript of the text. Do not summarize.',
  'ocr-to-md': 'Provide a COMPLETE, exhaustive, word-for-word transcript of the text as Markdown. Do not summarize.',
  'compare': 'Two versions of the SAME document are attached (A then B). List every change, addition and deletion as concise Markdown.',
  'grammar-check': 'Perform a grammar, spelling and style check. Return corrected text with brief explanations in Markdown.',
  'pdf-qa': 'Answer the user question with absolute fidelity using ONLY the provided document pages. Be concise and cite the page.',
  'pdf-summary': 'Write a structured executive summary: key takeaways, main topics, critical dates/numbers, action items.',
};

// Models that cannot read images must never receive image parts — reject early.
function toolNeedsVision(toolId: string): boolean {
  return toolId !== 'grammar-check';
}

function normalizeToServerOwnedMessages(toolId: string, messages: NvidiaMessage[]): NvidiaMessage[] {
  // Drop any client system message; keep the user turn(s).
  const userOnly = messages.filter(m => m.role !== 'system');
  const system = SYSTEM_PROMPTS[toolId] || 'Extract data accurately and return the result.';
  return [{ role: 'system', content: system } as NvidiaMessage, ...userOnly];
}

function buildNvidiaPayload(toolId: string, messages: NvidiaMessage[]) {
  const model = getNvidiaModel(toolId);
  const owned = normalizeToServerOwnedMessages(toolId, messages);

  const temperature = toolId === 'pdf-to-excel' || toolId === 'redact' ? 0.0 : 0.1;
  return {
    model,
    messages: owned,
    temperature,
    max_tokens: 4096,
  };
}

function buildOpenAiCompatPayload(toolId: string, model: string, messages: NvidiaMessage[]) {
  const nvidiaPayload = buildNvidiaPayload(toolId, messages);
  return { ...nvidiaPayload, model };
}

function getProviderChain(env: Env, toolId: string): ProviderConfig[] {
  const providers: ProviderConfig[] = [
    {
      name: 'nvidia',
      apiKey: env.NVIDIA_API_KEY,
      endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: getNvidiaModel(toolId),
    },
    {
      name: 'groq',
      apiKey: env.GROQ_API_KEY_1,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: getGroqModel(toolId),
    },
    {
      name: 'groq',
      apiKey: env.GROQ_API_KEY_2,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: getGroqModel(toolId),
    },
    {
      name: 'mistral',
      apiKey: env.MISTRAL_API_KEY_1,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: getMistralModel(toolId),
    },
    {
      name: 'mistral',
      apiKey: env.MISTRAL_API_KEY_2,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: getMistralModel(toolId),
    },
    {
      name: 'mistral',
      apiKey: env.MISTRAL_API_KEY_3,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: getMistralModel(toolId),
    },
  ];

  return providers.filter((provider) => Boolean(provider.apiKey));
}

function mapProviderError(status: number): { error: string; status: number } {
  if (status === 400 || status === 422) return { error: 'ERR_INVALID_FILE', status: 400 };
  if (status === 413) return { error: 'ERR_FILE_TOO_LARGE', status: 413 };
  if (status === 429) return { error: 'ERR_AI_RATE_LIMIT', status: 429 };
  return { error: 'AI processing failed. Please try again later.', status: 502 };
}

function shouldTryNextProvider(status: number): boolean {
  return status === 400 || status === 413 || status === 422 || status === 429 || status >= 500;
}

async function callAiProvider(provider: ProviderConfig, toolId: string, messages: NvidiaMessage[]) {
  const payload = buildOpenAiCompatPayload(toolId, provider.model, messages);
  const response = await fetch(provider.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  return response;
}

// ---- Zod schemas ----
const AiRequestSchema = z.object({
  toolId: z.string().min(1).max(64),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.union([z.string().max(40_000), z.array(z.unknown()).max(20)]),
  })).min(1).max(12),
  response_format: z.unknown().optional(),
  options: z.unknown().optional(),
}).strict();

const ExecuteCheckSchema = z.object({
  toolId: z.string().min(1).max(64),
  pageCount: z.number().int().positive().max(500),
}).strict();

const DeviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);

const RevokeDeviceSchema = z.object({
  activationCode: z.string().min(32).max(256),
  deviceId: DeviceIdSchema,
}).strict();

const ActivationSchema = z.object({
  activationCode: z.string().min(32).max(256),
  deviceLabel: z.string().trim().min(1).max(80),
}).strict();

const UsageReportSchema = z.object({
  toolId: z.string().min(1).max(64),
  pagesProcessed: z.number().int().positive().max(500),
  fileSizeBytes: z.number().int().nonnegative().max(100 * 1024 * 1024).optional(),
  fileName: z.string().max(255).optional(),
  status: z.enum(['SUCCESS', 'ERROR']),
  error: z.string().max(1_000).optional(),
}).strict();

function countImagePages(messages: Array<{ content: string | unknown[] }>): number | null {
  let imageCount = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== 'object') return null;
      const record = part as Record<string, unknown>;
      if (record.type !== 'image_url') continue;
      const imageUrl = record.image_url;
      const url = typeof imageUrl === 'string'
        ? imageUrl
        : imageUrl && typeof imageUrl === 'object' && typeof (imageUrl as Record<string, unknown>).url === 'string'
          ? (imageUrl as Record<string, string>).url
          : null;
      if (!url || (!url.startsWith('data:image/') && !url.startsWith('https://'))) return null;
      imageCount += 1;
    }
  }
  return imageCount || 1;
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown | null> {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > maxBytes) return null;
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) return null;
  try { return JSON.parse(body); } catch { return null; }
}

export default {
  // --- Cron / Scheduled handler: Supabase keep-alive ---
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      if (resp.ok) {
        console.log(`[Keepalive] Supabase ping successful at ${new Date().toISOString()}`);
      } else {
        console.error(`[Keepalive] Supabase ping failed with status ${resp.status}`);
      }
    } catch (err) {
      console.error('[Keepalive] Scheduled ping failed:', err);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const { cors, isAllowed } = corsHeaders(origin, allowedOrigins(env), parseAllowedOriginSuffixes(env.ALLOWED_ORIGIN_SUFFIXES));

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }

      // Block requests from unknown origins
      if (!isAllowed && origin !== null) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors });
      }

      const url = new URL(request.url);

      // Health check
      if (url.pathname === '/api/health' && (request.method === 'GET' || request.method === 'HEAD')) {
        return Response.json({ status: 'ok' }, { headers: cors });
      }

      // --- POST /api/paddle/webhook (public; authenticated by raw-body signature) ---
      // Paddle sends no Origin, so it passes the CORS gate above. The RAW body is verified
      // before any JSON handling; a failed signature is 401 and never mutates state. Applying
      // goes through the Postgres `apply_billing_event` RPC (event_id PK) so dedup + ordering
      // survive process restarts. A browser checkout completion never hits this path, so it can
      // never grant entitlement on its own — only a verified webhook projects subscription state.
      if (url.pathname === '/api/paddle/webhook' && request.method === 'POST') {
        const raw = await request.text();
        const sig = request.headers.get('Paddle-Signature') ?? request.headers.get('Webhook-Signature');
        const ok = await verifyPaddleSignature(raw, sig, env.PADDLE_WEBHOOK_SECRET || '');
        if (!ok) return Response.json({ error: 'invalid signature' }, { status: 401 });

        let evt: { event_id?: string; event_type?: string; occurred_at?: string; data?: { id?: string; customer_id?: string; subscription_id?: string; metadata?: { plan?: string } } };
        try { evt = JSON.parse(raw); } catch { return Response.json({ error: 'malformed body' }, { status: 400 }); }
        const eventId = String(evt.event_id ?? '');
        const subId = String(evt.data?.id ?? evt.data?.subscription_id ?? '') || null;
        if (!eventId || !evt.event_type) return Response.json({ error: 'missing event_id/type' }, { status: 400 });

        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/apply_billing_event`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_event_id: eventId,
            p_event_type: evt.event_type,
            p_occurred_at: evt.occurred_at ?? new Date().toISOString(),
            p_subscription_id: subId,
            p_customer_id: evt.data?.customer_id ?? null,
            p_payload: evt,
          }),
        });
        if (!res.ok) {
          console.error('[billing] apply_billing_event failed', res.status, await res.text());
          return Response.json({ error: 'projection failed' }, { status: 502 });
        }
        return Response.json({ status: 'ok' }); // 200 ack for applied / duplicate / out_of_order
      }

      // --- Billing (R2/R3). Identity is ALWAYS the server-verified Clerk sub; the browser never
      // supplies user_id/customer_id/price_id as authority. Paddle calls are gated on PADDLE_API_KEY.

      // POST /api/billing/checkout — create a server-side transaction for an allowlisted plan.
      if (url.pathname === '/api/billing/checkout' && request.method === 'POST') {
        const token = bearer(request);
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        const body = await readBoundedJson(request, 4096);
        const plan = body && typeof body === 'object' ? (body as any).plan : undefined;
        // Server maps the requested plan to an ALLOWLISTED price id; an arbitrary browser price is never used.
        const priceId = plan === 'business' ? env.PADDLE_PRICE_BUSINESS : plan === 'pro' ? env.PADDLE_PRICE_PRO : undefined;
        if (!priceId) return Response.json({ error: 'Invalid plan (pro|business) or price not configured' }, { status: 400, headers: cors });
        try {
          const existing = await pgSelectOne(env, 'billing_customers', `user_id=eq.${encodeURIComponent(jp.sub)}&select=customer_id`);
          const customerId: string = existing?.customer_id ?? (await createCustomer(env, (body as any)?.email))?.id;
          if (!customerId) return Response.json({ error: 'customer creation failed' }, { status: 502, headers: cors });
          const link = await pgRpc(env, 'ensure_billing_customer', { p_user_id: jp.sub, p_customer_id: customerId });
          if (link !== 'ok') return Response.json({ error: 'customer link conflict', detail: link }, { status: 502, headers: cors });
          const txn = await createTransaction(env, { customerId, priceId, userId: jp.sub });
          return Response.json({ status: 'pending', plan, transactionId: txn?.id, checkoutUrl: txn?.checkout?.url ?? null }, { status: 201, headers: cors });
        } catch (err: any) {
          if (err instanceof BillingNotConfigured) return Response.json({ error: err.message, configured: false }, { status: 503, headers: cors });
          console.error('[billing/checkout]', err);
          return Response.json({ error: 'checkout failed' }, { status: 502, headers: cors });
        }
      }

      // GET /api/billing/entitlement — the SERVER-derived plan for the caller (UI confirms after redirect; refresh/logout see the same).
      if (url.pathname === '/api/billing/entitlement' && request.method === 'GET') {
        const token = bearer(request);
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        const ent = await pgRpc(env, 'get_user_entitlement', { p_user_id: jp.sub });
        const row = Array.isArray(ent) ? ent[0] : ent;
        return Response.json({ userId: jp.sub, source: 'server', ...row }, { headers: cors });
      }

      // POST /api/billing/portal — an authorized customer-portal session for the caller's own linked customer.
      if (url.pathname === '/api/billing/portal' && request.method === 'POST') {
        const token = bearer(request);
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        try {
          const own = await pgSelectOne(env, 'billing_customers', `user_id=eq.${encodeURIComponent(jp.sub)}&select=customer_id`);
          if (!own?.customer_id) return Response.json({ status: 'no_subscription' }, { headers: cors });
          const session = await createPortalSession(env, own.customer_id);
          return Response.json({ url: session?.url ?? null }, { headers: cors });
        } catch (err: any) {
          if (err instanceof BillingNotConfigured) return Response.json({ error: err.message, configured: false }, { status: 503, headers: cors });
          console.error('[billing/portal]', err);
          return Response.json({ error: 'portal failed' }, { status: 502, headers: cors });
        }
      }

      // --- POST /api/internal/activate ---
      if (url.pathname === '/api/internal/activate' && request.method === 'POST') {
        const ipAddress = getClientIp(request);
        if (!env.INTERNAL_ACTIVATION_CODE) {
          return Response.json({ error: 'Activation failed' }, { status: 401, headers: cors });
        }
        if (!(await allowActivationAttempt(env, ipAddress))) {
          return Response.json({ error: 'Activation failed' }, { status: 429, headers: cors });
        }
        const parsed = ActivationSchema.safeParse(await readBoundedJson(request, 2_048));
        const activationCode = parsed.success ? parsed.data.activationCode.trim() : '';
        if (!parsed.success || !(await activationCodeMatches(activationCode, env.INTERNAL_ACTIVATION_CODE))) {
          return Response.json({ error: 'Activation failed' }, { status: 401, headers: cors });
        }
        if (!(await allowGlobalIssuance(env))) {
          return Response.json({ error: 'Activation failed' }, { status: 429, headers: cors });
        }
        const issued = await issueDeviceToken(env, parsed.data.deviceLabel, internalTokenTtlDays(env), internalMaxActiveDevices(env));
        if (!issued) return Response.json({ error: 'Activation failed' }, { status: 429, headers: cors });
        return Response.json({ token: issued.token, deviceLabel: issued.record.label, expiresAt: issued.record.expiresAt }, { status: 201, headers: cors });
      }

      // --- POST /api/internal/revoke ---
      if (url.pathname === '/api/internal/revoke' && request.method === 'POST') {
        const ipAddress = getClientIp(request);
        const parsed = RevokeDeviceSchema.safeParse(await readBoundedJson(request, 2_048));
        if (!env.INTERNAL_ACTIVATION_CODE || !parsed.success || !(await allowActivationAttempt(env, ipAddress)) || !(await activationCodeMatches(parsed.data.activationCode, env.INTERNAL_ACTIVATION_CODE))) {
          return Response.json({ error: 'Request failed' }, { status: 401, headers: cors });
        }
        // Idempotent generic response avoids exposing device inventory.
        await revokeDeviceToken(env, parsed.data.deviceId);
        return Response.json({ ok: true }, { status: 200, headers: cors });
      }

      // --- GET /api/usage ---
      if (url.pathname === '/api/usage' && request.method === 'GET') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        const ipAddress = getClientIp(request);
        const usage = await getUsageSummary(env, jp.sub, ipAddress);
        return Response.json({
          plan: usage.plan,
          pages_used: usage.aiPagesUsed,
          pages_limit: usage.aiPagesLimit,
          by_tool: usage.byTool,
        }, { headers: cors });
      }

      // --- POST /api/execute ---
      if (url.pathname === '/api/execute' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        // CRITICAL: Require authentication - no more free checks for anonymous users
        if (!token) {
          return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        }
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid or expired token' }, { status: 401, headers: cors });

        const body = await readBoundedJson(request, 8_192);
        const parseResult = ExecuteCheckSchema.safeParse(body);
        if (!parseResult.success) return Response.json({ error: 'Invalid payload' }, { status: 400, headers: cors });

        const { toolId, pageCount } = parseResult.data;
        if (!isAiTool(toolId) && !isFreeTool(toolId)) {
          return Response.json({ error: 'Unknown tool' }, { status: 400, headers: cors });
        }
        const ipAddress = getClientIp(request);
        const limit = await checkServerLimit(env, jp.sub, ipAddress, toolId, pageCount);
        if (!limit.allowed) {
          return Response.json({
            allowed: false,
            reason: limit.reason,
            plan: limit.plan,
            pages_used: limit.aiPagesUsed,
            limit: limit.aiPagesLimit,
            next_reset: limit.nextReset,
          }, { status: 402, headers: cors });
        }
        return Response.json({ allowed: true, plan: limit.plan, pages_used: limit.aiPagesUsed, limit: limit.aiPagesLimit }, { headers: cors });
      }

      // --- POST /api/ai ---
      if (url.pathname === '/api/ai' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        // Opaque internal device tokens are accepted only on this AI route; all other
        // endpoints retain their existing Clerk-only authentication contract.
        const device = token.startsWith('pfd_') ? await verifyDeviceToken(env, token) : null;
        const jp = device ? null : await verifyJWT(token, env);
        if (!device && !jp) return Response.json({ error: 'Invalid or expired token' }, { status: 401, headers: cors });
        if (device && !(await allowDeviceRequest(env, device.deviceId))) {
          return Response.json({ error: 'AI request failed. Please try again later.' }, { status: 429, headers: cors });
        }

        const ipAddress = getClientIp(request);
        const body = await readBoundedJson(request, 12 * 1024 * 1024);
        const parseResult = AiRequestSchema.safeParse(body);
        if (!parseResult.success) return Response.json({ error: 'Invalid AI request format' }, { status: 400, headers: cors });
        const { toolId, messages } = parseResult.data;
        if (!isAiTool(toolId)) return Response.json({ error: 'Unknown AI tool' }, { status: 400, headers: cors });
        const pagesRequested = countImagePages(messages);
        if (!pagesRequested || pagesRequested > 20) {
          return Response.json({ error: 'Invalid or excessive image payload' }, { status: 400, headers: cors });
        }
        // Capability verification (Batch 03): a vision tool must actually receive
        // images. Reject before spend when the payload can't satisfy the model.
        if (toolNeedsVision(toolId) && pagesRequested === 0) {
          return Response.json({ error: 'This tool requires document images in the request' }, { status: 400, headers: cors });
        }

        // Internal devices are provisioned outside the public Clerk/Supabase quota system.
        // Their authorization is the revocable KV record validated above.
        if (device) return proxyInternalAiRequest(env, toolId, messages, cors);

        // The reservation is atomic and includes PENDING rows in quota totals.
        const reservation = await reserveUsage(env, jp!.sub, ipAddress, toolId, pagesRequested);
        if (!reservation.limit.allowed) {
          return Response.json({ error: reservation.limit.reason, plan: reservation.limit.plan }, { status: 402, headers: cors });
        }

        let settled = false;
        try {
          const providers = getProviderChain(env, toolId);
          if (providers.length === 0) throw new Error('No AI providers configured');
          let providerData: unknown = null;
          let finalError: { error: string; status: number } = { error: 'AI processing failed. Please try again later.', status: 502 };

          for (const provider of providers) {
            const providerRes = await callAiProvider(provider, toolId, messages);
            if (providerRes.ok) {
              providerData = await providerRes.json();
              break;
            }
            const errText = await providerRes.text();
            console.error(`[AI PROVIDER FAIL] ${provider.name.toUpperCase()} returned ${providerRes.status}:`, errText.substring(0, 500));
            finalError = mapProviderError(providerRes.status);
            if (!shouldTryNextProvider(providerRes.status)) break;
          }

          if (!providerData) {
            await settleUsage(env, reservation.requestId, 'ERROR');
            settled = true;
            return Response.json({ error: finalError.error }, { status: finalError.status, headers: cors });
          }

          // Do not disclose a paid response until authoritative settlement succeeds.
          await settleUsage(env, reservation.requestId, 'SUCCESS');
          settled = true;
          return new Response(JSON.stringify(providerData), {
            status: 200,
            headers: { ...cors as Record<string, string>, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          if (!settled) {
            try {
              await settleUsage(env, reservation.requestId, 'ERROR');
              settled = true;
            } catch (settlementError) {
              console.error('[Billing] Unable to release reservation:', settlementError);
            }
          }
          console.error('[AI] Processing failed:', error);
          return Response.json({ error: 'AI processing failed. Please try again later.' }, { status: 502, headers: cors });
        }
      }

      // --- POST /api/usage/report ---
      if (url.pathname === '/api/usage/report' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        const jwt = await verifyJWT(token, env);
        if (!jwt) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        const parseResult = UsageReportSchema.safeParse(await readBoundedJson(request, 32_768));
        if (!parseResult.success || !isFreeTool(parseResult.data.toolId)) {
          return Response.json({ error: 'Only known local tools may report telemetry' }, { status: 400, headers: cors });
        }
        try {
          const summary = await reportAndSummarize(env, jwt.sub, getClientIp(request), {
            toolId: parseResult.data.toolId,
            pagesProcessed: parseResult.data.pagesProcessed,
            fileSizeBytes: parseResult.data.fileSizeBytes ?? 0,
            fileName: parseResult.data.fileName ?? 'unknown',
            status: parseResult.data.status,
            error: parseResult.data.error,
          });
          return Response.json(summary, {
            status: 200,
            headers: { ...(cors as Record<string, string>), 'Content-Type': 'application/json' },
          });
        } catch (err: any) {
          console.error('[usage/report] error:', err);
          return Response.json({ error: 'Failed to record usage' }, { status: 500, headers: cors });
        }
      }

      // --- GET /api/usage/summary ---
      if (url.pathname === '/api/usage/summary' && request.method === 'GET') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        const jwt = await verifyJWT(token, env);
        if (!jwt) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        try {
          const summary = await getUsageSummary(env, jwt.sub, getClientIp(request));
          return Response.json(summary, {
            status: 200,
            headers: { ...(cors as Record<string, string>), 'Content-Type': 'application/json' },
          });
        } catch (err: any) {
          console.error('[usage/summary] error:', err);
          return Response.json({ error: 'Failed to fetch summary' }, { status: 500, headers: cors });
        }
      }

      return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
    } catch (error) {
      console.error('[Worker] Uncaught error:', error);
      return Response.json(
        { error: 'Internal server error' },
        { status: 500, headers: cors },
      );
    }
  },
};
