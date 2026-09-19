// send-invite — the first server-side code in this project.
//
// A member types an email into the Invite panel and the person gets a real
// invitation, instead of the member copying a message into WhatsApp themselves.
//
// WHY A FUNCTION AT ALL. Sending requires the service_role key, which bypasses
// every row-level security policy in the database. It can never go near a
// browser. This runs on Supabase, holds that key, and is the only thing that
// touches it.
//
// WHAT IT DOES NOT DO. It does not decide who may be invited. That stays in
// Postgres, in invite_someone(), called here with the CALLER'S token — so the
// email validation, the 25-a-day cap, the 250 lifetime cap and the record of who
// invited whom all apply exactly as they did before, and a bug in this file
// cannot widen them. If the row is not created, no email is sent.
//
// The mail itself goes out through the Gmail SMTP already configured for
// magic links, using Supabase's invite template. No new provider.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

// Supabase injects these into every function; no secret has to be set by hand.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// The app is served from GitHub Pages, so this is a cross-origin call and needs
// a preflight answer.
const ALLOWED = new Set([
  'https://edgeoinnovations-resources.github.io',
  'http://localhost:8000',
]);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED.has(origin) ? origin : [...ALLOWED][0],
  // supabase-js sends apikey and x-client-info alongside the token. Leaving them
  // out makes the browser reject the preflight and report "Failed to fetch" with
  // no status and no body — which looks like the function is down when it is
  // actually fine. curl never notices, because curl does not enforce CORS.
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Max-Age': '3600',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'The invitation sender is not configured. Tell Paul.' }, 500, origin);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return json({ error: 'You are not signed in.' }, 401, origin);
  }

  let email = '';
  let note: string | null = null;
  let redirectTo = '';
  try {
    const body = await req.json();
    email = String(body.email ?? '').trim();
    note = body.note ? String(body.note).slice(0, 200) : null;
    redirectTo = String(body.redirectTo ?? '');
  } catch {
    return json({ error: 'Bad request.' }, 400, origin);
  }
  if (!email) return json({ error: 'No email address.' }, 400, origin);

  // Only ever redirect back to the app itself. Without this check the caller
  // could aim a genuine-looking invitation at any site they liked.
  const redirect = [...ALLOWED].some((o) => redirectTo.startsWith(o)) ? redirectTo : undefined;

  // ── 1. Record it, as the caller, under the rules that already exist ───────
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: result, error: rpcError } = await asUser.rpc('invite_someone', {
    p_email: email,
    p_note: note,
  });

  if (rpcError) {
    // Postgres raised: not a member, bad address, over the daily cap. The message
    // is already written for a person to read.
    return json({ error: rpcError.message, stage: 'record' }, 400, origin);
  }
  if (result === 'ALREADY_LISTED') {
    return json({ status: 'ALREADY_LISTED' }, 200, origin);
  }

  // ── 2. Send it, with the key that never leaves this function ──────────────
  const asAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error: sendError } = await asAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: redirect,
  });

  if (sendError) {
    // The invitation EXISTS even though the email failed, so the person can still
    // be let in — they just have to be told by hand. Say so plainly rather than
    // reporting a failure that would make the member try again and hit the cap.
    return json({
      status: 'RECORDED_NOT_SENT',
      error: sendError.message,
    }, 200, origin);
  }

  return json({ status: 'SENT' }, 200, origin);
});
