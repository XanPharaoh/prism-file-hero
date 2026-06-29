// VITE_WORKER_URL is set in .env.local (dev) and Cloudflare Pages env vars (prod)
// Example .env.local: VITE_WORKER_URL=http://localhost:8787
// Production:         VITE_WORKER_URL=https://prism-worker.<your-subdomain>.workers.dev

export const WORKER_BASE_URL: string =
  (import.meta.env as any).VITE_WORKER_URL ?? 'http://localhost:8787';
