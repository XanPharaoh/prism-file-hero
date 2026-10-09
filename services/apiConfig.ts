// VITE_WORKER_URL is set in .env.local (dev) and Cloudflare Pages env vars (prod)
// The default is the deployed Worker so a build never silently binds to a local server.
// Local dev against a `wrangler dev` worker: set VITE_WORKER_URL=http://localhost:8787
export const WORKER_BASE_URL: string =
  (import.meta.env as any).VITE_WORKER_URL ?? 'https://prism-worker.prismfilehero.workers.dev';
