/**
 * Single source of truth for the Worker base URL (Batch 04: unify endpoints).
 *
 * Rules enforced here so no bundle ever silently binds to a dev machine:
 *   - Production builds MUST resolve to an HTTPS origin. A configured
 *     VITE_WORKER_URL that is not https is rejected at build/runtime; with no
 *     override configured the deployed Worker origin is used.
 *   - Localhost / plain http is allowed ONLY in development (import.meta.env.DEV),
 *     for `wrangler dev` workflows that explicitly set VITE_WORKER_URL.
 */

const PROD_DEFAULT = 'https://prism-worker.prismfilehero.workers.dev';

/** Pure, unit-testable resolver. `isDev` mirrors import.meta.env.DEV. */
export function resolveWorkerBaseUrl(
  configured: string | undefined,
  isDev: boolean
): string {
  const raw = (configured ?? '').trim();

  if (isDev) {
    // Dev may point at a local wrangler worker; fall back to the prod origin if unset.
    return raw || PROD_DEFAULT;
  }

  // Production: require an explicit https origin.
  if (raw) {
    if (/^https:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
    // Reject non-https / localhost in production rather than ship an insecure endpoint.
    throw new Error(
      `VITE_WORKER_URL must be an https:// origin in production (got "${raw}").`
    );
  }
  return PROD_DEFAULT;
}

function currentEnv(): { configured?: string; isDev: boolean } {
  const meta = (import.meta as any).env ?? {};
  return { configured: meta.VITE_WORKER_URL, isDev: !!meta.DEV };
}

const { configured, isDev } = currentEnv();

// The default is the deployed Worker so a build never silently binds to a local
// server. Local dev against `wrangler dev`: set VITE_WORKER_URL=http://localhost:8787.
export const WORKER_BASE_URL: string = resolveWorkerBaseUrl(configured, isDev);
