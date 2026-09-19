// report-issue — a member says something is wrong, and Paul hears about it today.
//
// client_errors has caught every thrown exception since 13 Sep. It cannot catch
// the other half: a school in the wrong city, a connection that makes no sense,
// a button that does nothing. Those reach Paul days later as a screenshot in
// WhatsApp, if at all.
//
// The report is written as the CALLER, so the rate limit and the email scrubbing
// already in the table apply exactly as they do to any other insert. The service
// key is used for one thing only: reading back the errors this person's browser
// logged in the minutes before they pressed the button, which they cannot read
// themselves (client_errors is deliberately write-only to members).
//
// If the mail cannot go out the report is still saved and still says so. A
// report that exists but was not emailed is recoverable; one that was refused
// because the mail server was busy is gone.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// Set by Paul with `supabase secrets set`; never in the repo, never seen here in
// plain text by anyone but the mail server.
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASSWORD') ?? '';
const REPORT_TO = Deno.env.get('ISSUE_REPORT_TO') ?? 'EdGeoinnovations@gmail.com';

const ALLOWED = new Set([
  'https://edgeoinnovations-resources.github.io',
  'http://localhost:8000',
]);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED.has(origin) ? origin : [...ALLOWED][0],
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '3600',
  'Vary': 'Origin',
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });

const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'You are not signed in.' }, 401, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400, origin); }

  const note = String(body.note ?? '').trim();
  if (note.length < 3) return json({ error: 'Tell us a little about what went wrong.' }, 400, origin);

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'You are not signed in.' }, 401, origin);

  // What their browser logged just before they pressed the button. Members cannot
  // read this table, so it takes the service key — and it is scoped to them.
  let recent: unknown[] = [];
  if (SERVICE_KEY) {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data } = await admin.from('client_errors')
      .select('created_at, view, action, code, message')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5);
    recent = data || [];
  }

  const { data: saved, error: insErr } = await asUser.from('issue_reports').insert({
    reporter_id: user.id,
    note,
    view: String(body.view ?? '').slice(0, 40),
    build: String(body.build ?? '').slice(0, 60),
    path: String(body.path ?? '').slice(0, 200),
    user_agent: String(body.userAgent ?? '').slice(0, 300),
    window_size: String(body.windowSize ?? '').slice(0, 40),
    screenshot: body.screenshot ? String(body.screenshot).slice(0, 400) : null,
    recent_errors: recent,
  }).select('id, created_at').single();

  if (insErr) return json({ error: insErr.message }, 400, origin);

  // ── Tell Paul ─────────────────────────────────────────────────────────────
  let emailed = false;
  let mailError = '';
  if (SMTP_USER && SMTP_PASS) {
    try {
      const client = new SMTPClient({
        connection: {
          hostname: 'smtp.gmail.com', port: 465, tls: true,
          auth: { username: SMTP_USER, password: SMTP_PASS },
        },
      });
      const errs = recent.length
        ? `<h4>Errors logged in the 30 minutes before</h4><pre style="font-size:12px">${esc(JSON.stringify(recent, null, 2))}</pre>`
        : '<p style="color:#666">No errors were logged around it.</p>';
      await client.send({
        from: SMTP_USER,
        to: REPORT_TO,
        subject: `6 Degrees issue #${saved.id} — ${note.slice(0, 60)}`,
        html: `<h3>Issue #${saved.id}</h3>
<p style="font-size:15px;white-space:pre-wrap">${esc(note)}</p>
<table style="font-size:13px;border-collapse:collapse">
<tr><td><b>Screen</b></td><td>${esc(body.view)}</td></tr>
<tr><td><b>Build</b></td><td>${esc(body.build)}</td></tr>
<tr><td><b>Window</b></td><td>${esc(body.windowSize)}</td></tr>
<tr><td><b>Browser</b></td><td>${esc(body.userAgent)}</td></tr>
<tr><td><b>Screenshot</b></td><td>${body.screenshot ? esc(body.screenshot) : 'none attached'}</td></tr>
</table>
${errs}
<p style="color:#666;font-size:12px">Run <code>bash tools/issues.sh</code> to see every open report.</p>`,
      });
      await client.close();
      emailed = true;
    } catch (e) {
      mailError = String(e).slice(0, 200);
    }
  }

  return json({ status: 'SAVED', id: saved.id, emailed, mailError }, 200, origin);
});
