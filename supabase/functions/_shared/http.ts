import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
export function preflight(): Response { return new Response('ok', { headers: corsHeaders }); }
export function errorResponse(message: string, status: number, code: string): Response {
  return json({ error: { message, code } }, status);
}

export function getAdminClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  let secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!secret && secretKeys) {
    try { secret = JSON.parse(secretKeys).default; } catch { /* missing configuration */ }
  }
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 12000) return null;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch { return null; }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function allowRate(client: SupabaseClient, request: Request, limit: number, windowSeconds: number): Promise<boolean> {
  // Supabase injects the server-only project secret into Edge Functions. Use a
  // namespaced derivation as a safe fallback so rate limiting stays enabled
  // before an optional, independently rotated RATE_LIMIT_PEPPER is configured.
  let pepper = Deno.env.get('RATE_LIMIT_PEPPER');
  if (!pepper) {
    const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
    if (secretKeys) {
      try {
        const parsed = JSON.parse(secretKeys);
        if (typeof parsed.default === 'string') pepper = `blackwood-rate-limit-v1:${parsed.default}`;
      } catch { /* fail closed when server secrets are unavailable */ }
    }
    const legacySecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!pepper && legacySecret) pepper = `blackwood-rate-limit-v1:${legacySecret}`;
  }
  if (!pepper) return false;
  const forwarded = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
    || request.headers.get('x-real-ip') || 'unknown';
  const keyHash = await sha256(`${pepper}:${forwarded}`);
  const { data, error } = await client.rpc('consume_public_rate_limit', {
    p_key_hash: keyHash, p_window_seconds: windowSeconds, p_limit: limit
  });
  return !error && data === true;
}

export async function verifyTurnstile(token: unknown, request: Request): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret || typeof token !== 'string' || token.length < 10 || token.length > 4096) return false;
  const form = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.success !== true) return false;
    const expected = (Deno.env.get('TURNSTILE_ALLOWED_HOSTNAMES') || '').split(',').map(x => x.trim()).filter(Boolean);
    return expected.length > 0 && expected.includes(result.hostname);
  } catch { return false; }
}

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
