import { createClient } from '@supabase/supabase-js';

// Supabase client kept for DB access (historyService etc.) — auth is now via Clerk
const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || process.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null as any;

// ── Clerk token bridge ─────────────────────────────────────────
// Clerk hooks can only be called inside React components.
// Services outside React need access to the current auth token.
// Instead of caching a static token (which expires after ~60 min),
// we store a reference to the Clerk instance and fetch a fresh
// token from the active session on every call.

let _clerkInstance: any = null;
let _clerkUserId: string | null = null;

/**
 * Store a reference to the Clerk instance so non-React code can
 * request fresh session tokens.  Called from App.tsx via useClerk().
 */
export function setClerkInstance(clerk: any) {
  _clerkInstance = clerk;
}

/**
 * Keep the user-id in sync.  Called from App.tsx whenever auth state changes.
 */
export function setClerkUserId(userId: string | null) {
  _clerkUserId = userId;
}

/**
 * Retrieve a **fresh** session token from the Clerk instance.
 * Clerk caches the token internally and only refreshes when needed,
 * so calling this on every request is safe and efficient.
 * Returns null when there is no active session.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    if (_clerkInstance?.session) {
      const token = await _clerkInstance.session.getToken();
      return token ?? null;
    }
  } catch {
    // Session may have been removed between the check and the call — ignore.
  }
  return null;
}

/**
 * Return the current Clerk user ID, or null if not signed in.
 */
export function getClerkUserId(): string | null {
  return _clerkUserId;
}
