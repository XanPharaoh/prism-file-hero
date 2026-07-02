import { z } from 'zod';
import { getComprehensiveUsage, incrementUsage, getExecutionContext } from './db';
import { isWithinLimit, PLAN_LIMITS, type Plan } from './planLimits';

interface Env {
  NVIDIA_API_KEY: string;
  ALLOWED_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  SUPABASE_JWK_PUBLIC_KEY: string;
  KV: KVNamespace;
}

const ALLOWED_ORIGINS = [
  'https://prismfilehero.com',
  'https://www.prismfilehero.com',
  'https://prismfilehero.free.nf',
  'https://app.prismfilehero.free.nf',
  'https://prism-file-hero.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
];

// Per-tool page cost mapping
const TOOL_PAGE_COSTS: Record<string, number> = {
  'merge': 0, 'split': 0, 'compress': 0, 'jpg-to-pdf': 0, 'protect': 0, 'watermark': 0, 'rotate': 0,
  'pdf-to-excel': 1, 'pdf-to-word': 1, 'pdf-to-jpg': 1,
  'ocr': 1, 'ocr-to-pdf': 1, 'ocr-to-md': 1,
  'compare': 2, 'redact': 1, 'grammar-check': 1,
};

// Global IP limit decoupled from user plan — prevents multi-account abuse
const GLOBAL_IP_MONTHLY_LIMIT = 50;

function getToolPagesCost(toolId: string): number {
  return TOOL_PAGE_COSTS[toolId] ?? 1;
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const xForwardedFor = request.headers.get('X-Forwarded-For');
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
  const xRealIp = request.headers.get('X-Real-IP');
  if (xRealIp) return xRealIp;
  return 'unknown';
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

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  
  // Allow localhost with any port
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  
  // Allow local network IP addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x) with any port
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  
  // Allow Cloudflare Pages preview deployments
  if (/^https:\/\/([a-zA-Z0-9-]+\.)?prism-file-hero\.pages\.dev$/.test(origin)) return true;
  
  return false;
}

/** Strict CORS: only return ACAO header for known origins, block unknown origins for non-OPTIONS */
function corsHeaders(origin: string | null): { cors: HeadersInit; isAllowed: boolean } {
  const isAllowed = origin !== null && isOriginAllowed(origin);
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

async function verifyES256(token: string, jwkJson: string): Promise<{ sub: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    
    // CRITICAL: Validate algorithm in header
    const headerBytes = base64urlDecode(headerB64!);
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string };
    if (header.alg !== 'ES256') return null; // Reject if algorithm doesn't match
    
    const jwk = JSON.parse(jwkJson) as JsonWebKey;
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signingInput = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const signature = base64urlDecode(sigB64!);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature as BufferSource, signingInput);
    if (!valid) return null;
    const payloadBytes = base64urlDecode(payloadB64!);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) return null;
    if (payload.aud !== 'authenticated') return null;
    return { sub: payload.sub as string };
  } catch { return null; }
}

async function verifyHS256(token: string, secret: string): Promise<{ sub: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    
    // CRITICAL: Validate algorithm in header
    const headerBytes = base64urlDecode(headerB64!);
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string };
    if (header.alg !== 'HS256') return null; // Reject if algorithm doesn't match
    
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signingInput = enc.encode(headerB64 + '.' + payloadB64);
    const sigBytes = base64urlDecode(sigB64!);
    const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes as BufferSource, signingInput);
    if (!valid) return null;
    const payloadBytes = base64urlDecode(payloadB64!);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    // Validate expiration, issuer, and audience
    if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) return null;
    if (payload.aud !== 'authenticated') return null;
    return { sub: payload.sub as string };
  } catch { return null; }
}

async function verifyJWT(token: string, env: Env): Promise<{ sub: string } | null> {
  if (env.SUPABASE_JWK_PUBLIC_KEY) {
    const result = await verifyES256(token, env.SUPABASE_JWK_PUBLIC_KEY);
    if (result) return result;
  }
  if (env.SUPABASE_JWT_SECRET) { return verifyHS256(token, env.SUPABASE_JWT_SECRET); }
  return null;
}

function currentMonth(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

type NvidiaMessage = { role: string; content: any };

function getNvidiaModel(toolId: string): string {
  switch (toolId) {
    case 'redact': return 'nvidia/gliner-pii';
    case 'pdf-to-excel': return 'stockmark/stockmark-2-100b-instruct';
    case 'ocr':
    case 'ocr-to-pdf':
    case 'ocr-to-md':
    case 'pdf-to-word':
    case 'compare':
      return 'microsoft/phi-4-multimodal-instruct';
    default:
      return 'microsoft/phi-4-mini-instruct';
  }
}

function buildNvidiaPayload(toolId: string, messages: NvidiaMessage[]) {
  const model = getNvidiaModel(toolId);
  
  // Specialized system prompts for NVIDIA NIM models
  if (toolId === 'redact') {
    return {
      model,
      messages: [
        { role: 'system', content: 'You are a PII detection engine. Return ONLY a JSON array of objects with keys: page, x, y, width, height, text, type. No markdown, no explanation.' },
        ...messages
      ],
      temperature: 0.0,
      max_tokens: 4096,
    };
  }

  if (toolId === 'pdf-to-excel') {
    return {
      model,
      messages: [
        { role: 'system', content: 'You are a financial document extraction engine. Extract tables into strict JSON format: { "rows": [{ "Date": "", "Description": "", "Debit": 0, "Credit": 0, "Balance": 0 }] }. No markdown.' },
        ...messages
      ],
      temperature: 0.0,
      max_tokens: 4096,
    };
  }

  return {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 4096,
  };
}

// ---- Zod schemas ----
const AiRequestSchema = z.object({
  toolId: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.any() })),
  response_format: z.any().optional(),
});

const ExecuteCheckSchema = z.object({
  toolId: z.string(),
  pageCount: z.number().optional(),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const { cors, isAllowed } = corsHeaders(origin);

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

      // --- GET /api/usage ---
      if (url.pathname === '/api/usage' && request.method === 'GET') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid token' }, { status: 401, headers: cors });
        const month = currentMonth();
        // Phase 3: Single RPC for plan + total pages, plus getComprehensiveUsage for per-tool breakdown
        const ipAddress = getClientIp(request);
        const ctx = await getExecutionContext(env, jp.sub, ipAddress, month);
        const usage = await getComprehensiveUsage(env, jp.sub, month);
        const limit = PLAN_LIMITS[ctx.plan].aiPagesPerMonth;
        return Response.json({
          plan: ctx.plan,
          pages_used: usage.pagesUsed,
          pages_limit: limit,
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

        // Zod validation
        const body = await request.json().catch(() => null);
        const parseResult = ExecuteCheckSchema.safeParse(body);
        if (!parseResult.success) return Response.json({ error: 'Invalid payload' }, { status: 400, headers: cors });

        const { toolId, pageCount } = parseResult.data;
        const pagesRequested = pageCount ?? getToolPagesCost(toolId);
        const month = currentMonth();
        // Phase 3: Single RPC for execute route too (uses real client IP, not 'check')
        const ipAddress = getClientIp(request);
        const ctx = await getExecutionContext(env, jp.sub, ipAddress, month);
        const { plan, pagesUsed } = ctx;

        if (!isWithinLimit(plan, pagesUsed, pagesRequested)) {
          const limit = PLAN_LIMITS[plan].aiPagesPerMonth;
          return Response.json({
            allowed: false,
            reason: `Monthly ${plan} plan limit reached (${limit === -1 ? 'unlimited' : limit} pages).`,
            plan,
            pages_used: pagesUsed,
            limit,
          }, { status: 402, headers: cors });
        }
        return Response.json({ allowed: true, plan, pages_used: pagesUsed, limit: PLAN_LIMITS[plan].aiPagesPerMonth }, { headers: cors });
      }

      // --- POST /api/ai ---
      if (url.pathname === '/api/ai' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
        const jp = await verifyJWT(token, env);
        if (!jp) return Response.json({ error: 'Invalid or expired token' }, { status: 401, headers: cors });

        // Extract client IP for multi-account abuse prevention
        const ipAddress = getClientIp(request);

        // Zod validation
        const body = await request.json().catch(() => null);
        const parseResult = AiRequestSchema.safeParse(body);
        if (!parseResult.success) return Response.json({ error: 'Invalid AI request format' }, { status: 400, headers: cors });
        const { toolId, messages } = parseResult.data;

        const pagesRequested = getToolPagesCost(toolId);
        const month = currentMonth();

        // Phase 3: Single RPC call replaces 3 separate DB queries (waterfall fix)
        const ctx = await getExecutionContext(env, jp.sub, ipAddress, month);
        const { plan, pagesUsed, ipPagesUsed } = ctx;

        // Check user limit
        if (!isWithinLimit(plan, pagesUsed, pagesRequested)) {
          return Response.json({
            error: 'Monthly AI page limit reached. Upgrade to Pro for more pages.',
            pages_used: pagesUsed,
            pages_limit: PLAN_LIMITS[plan].aiPagesPerMonth,
            plan,
          }, { status: 429, headers: cors });
        }

        // Global IP limit (decoupled from user plan) — exempt Business users (shared NAT fix)
        if (plan !== 'business' && ipPagesUsed + pagesRequested > GLOBAL_IP_MONTHLY_LIMIT) {
          return Response.json({
            error: 'Network usage limit exceeded.',
          }, { status: 429, headers: cors });
        }

        // Forward to NVIDIA NIM
        const nvidiaPayload = buildNvidiaPayload(toolId, messages);
        const nvidiaRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': 'Bearer ' + env.NVIDIA_API_KEY 
          },
          body: JSON.stringify(nvidiaPayload),
        });

        // Sanitize NVIDIA errors — map to specific frontend codes
        if (!nvidiaRes.ok) {
          const errText = await nvidiaRes.text();
          console.error(`[NVIDIA NIM] Error ${nvidiaRes.status}:`, errText);

          let clientError = 'AI processing failed. Please try again later.';
          let statusCode = 502;

          if (nvidiaRes.status === 400) { clientError = 'ERR_INVALID_FILE'; statusCode = 400; }
          else if (nvidiaRes.status === 413) { clientError = 'ERR_FILE_TOO_LARGE'; statusCode = 413; }
          else if (nvidiaRes.status === 429) { clientError = 'ERR_AI_RATE_LIMIT'; statusCode = 429; }

          return Response.json({ error: clientError }, { status: statusCode, headers: cors });
        }

        const nvidiaData = await nvidiaRes.json();

        // Atomic RPC increment (only on success) — catch billing failures
        try {
          await incrementUsage(env, jp.sub, toolId, pagesRequested, ipAddress, month);
        } catch (billingErr) {
          console.error('[Billing] Transaction halted:', billingErr);
        }

        return new Response(JSON.stringify(nvidiaData), {
          status: 200,
          headers: { ...cors as Record<string, string>, 'Content-Type': 'application/json' },
        });
      }

      // --- POST /api/usage/report ---
      if (url.pathname === '/api/usage/report' && request.method === 'POST') {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });
        }
        if (!body.toolId || !body.status) {
          return Response.json({ error: 'toolId and status required' }, { status: 400, headers: cors });
        }
        let userId: string | null = null;
        const authHeader = request.headers.get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const payload = await verifyJWT(authHeader.slice(7), env.SUPABASE_JWT_SECRET);
          userId = payload?.sub ?? null;
        }
        const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
        try {
          const { reportAndSummarize } = await import('./usageTracker');
          const summary = await reportAndSummarize(env as any, userId, clientIp, {
            toolId: body.toolId,
            pagesProcessed: body.pagesProcessed ?? 1,
            fileSizeBytes: body.fileSizeBytes ?? 0,
            fileName: body.fileName ?? 'unknown',
            status: body.status,
            error: body.error,
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
        let userId: string | null = null;
        const authHeader = request.headers.get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const payload = await verifyJWT(authHeader.slice(7), env.SUPABASE_JWT_SECRET);
          userId = payload?.sub ?? null;
        }
        const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
        try {
          const { getUsageSummary } = await import('./usageTracker');
          const summary = await getUsageSummary(env as any, userId, clientIp);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Worker] Uncaught error:', error);
      return Response.json(
        { error: 'Internal server error', details: errorMessage },
        { status: 500, headers: cors },
      );
    }
  },
};
