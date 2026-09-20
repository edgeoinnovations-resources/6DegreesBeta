// notify-addition — Paul hears, the same day, about anything a member had to
// add themselves.
//
// Paul, 20 Sep 2026: "instead of throwing an error, send me an email, log it in
// the database and have me review it and find that actual school as a human
// check and I'll add it."
//
// The log is written by a TRIGGER in Postgres and cannot be skipped. This is the
// telling-Paul half, and it is deliberately best-effort: if the mail server is
// busy, the addition is still recorded and tools/additions.sh still lists it.
// Nothing a member does is ever refused because an email failed.
//
// It also carries the one thing a reviewer needs and a database row does not:
// SCHOOLS THAT LOOK LIKE THIS ONE. "International School of Choueifat, Lahore"
// was added on 20 Sep under Lebanon while "International School Choueifat",
// Lahore, Pakistan, was already there — and the trailing ", Lahore" was enough
// that no automatic check saw it. A human reading the two names side by side
// sees it instantly.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
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
  if (!auth.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401, origin);

  let additionId = 0;
  try {
    additionId = Number((await req.json())?.id || 0);
  } catch { return json({ error: 'bad request' }, 400, origin); }
  if (!additionId) return json({ error: 'which addition?' }, 400, origin);

  // The caller must really be signed in; beyond that this endpoint only sends
  // mail about a row the database wrote itself.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'not signed in' }, 401, origin);

  if (!SERVICE_KEY) return json({ status: 'LOGGED', notified: false }, 200, origin);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: rows } = await admin.from('catalogue_additions')
    .select('id, kind, entity_id, name, city, region, country, country_code, added_by, had_profile, member_note')
    .eq('id', additionId).limit(1);
  const a = rows?.[0];
  // Only the person who caused it can trigger its email, and only once.
  if (!a || a.added_by !== user.id) return json({ status: 'LOGGED', notified: false }, 200, origin);

  let who = 'somebody still registering';
  if (a.had_profile) {
    const { data: p } = await admin.from('profiles').select('display_name').eq('id', a.added_by).limit(1);
    who = p?.[0]?.display_name || 'a member';
  }

  // Near matches, the thing a human eye is for.
  let near: Array<Record<string, unknown>> = [];
  if (a.kind === 'school' && a.country) {
    const { data: n } = await admin.rpc('schools_like', { p_name: a.name, p_country: a.country });
    near = (n || []).filter((r: { id: number }) => r.id !== a.entity_id).slice(0, 6);
  }

  if (!SMTP_USER || !SMTP_PASS) return json({ status: 'LOGGED', notified: false }, 200, origin);

  const where = [a.city, a.region, a.country].filter(Boolean).map(esc).join(', ');
  const subject = a.kind === 'country'
    ? `6 Degrees — a country is missing: ${a.name}`
    : `6 Degrees — new ${a.kind}: ${a.name}`;

  const nearHtml = near.length
    ? `<p style="margin:18px 0 6px"><strong>Already in the catalogue, and similar:</strong></p>
       <ul style="font-size:14px;color:#334">${near.map((r) =>
         `<li>${esc(r.name)} — ${esc(r.city)}, ${esc(r.country)}${r.is_verified ? ' · verified' : ''}</li>`).join('')}</ul>
       <p style="font-size:13px;color:#667">If one of these is the same school, merge it:
       a duplicate turns same-school colleagues from degree 1 into degree 3, silently.</p>`
    : (a.kind === 'school'
        ? '<p style="font-size:13px;color:#667">Nothing similar is already listed.</p>' : '');

  try {
    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com', port: 465, tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });
    await client.send({
      from: SMTP_USER,
      to: REPORT_TO,
      subject,
      html: `<p style="font-size:15px;margin:0 0 4px"><strong>${esc(a.name)}</strong></p>
<p style="font-size:14px;color:#334;margin:0">${where || '—'}</p>
<p style="font-size:14px;color:#334">Added by ${esc(who)}${a.had_profile ? '' : ' — they have not finished registering'}.</p>
${a.member_note ? `<p style="font-size:14px;color:#334"><em>${esc(a.member_note)}</em></p>` : ''}
${a.kind === 'country'
  ? `<p style="font-size:14px;color:#334">There is no school anywhere in ${esc(a.name)} yet, so the country
     does not appear in the list at all. They have been let through and can finish registering; the country
     needs adding before anyone else from there can.</p>`
  : `<p style="font-size:13px;color:#667">They were not made to wait for this. The row exists and they
     carried on; correcting it re-runs the degrees automatically.</p>`}
${nearHtml}
<p style="font-size:13px;color:#667;margin-top:20px">Review it with:
<code>bash tools/additions.sh show ${a.id}</code> · <code>bash tools/additions.sh near ${a.id}</code></p>`,
    });
    await client.close();
  } catch (_e) {
    return json({ status: 'LOGGED', notified: false }, 200, origin);
  }

  return json({ status: 'LOGGED', notified: true }, 200, origin);
});
