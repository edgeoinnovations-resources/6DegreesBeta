// send-message — deliver a message, then tell the recipient by email.
//
// Dave, June 2026: "perhaps they could message someone via the platform which
// then sends a vanilla email to the recipient — 'You've received a direct
// message on the 6 Degrees site. Log in to read it.' — without either party
// seeing the other's email."
//
// That is exactly what this does, and the constraint is the point: the
// notification contains no address and no message body. Somebody who intercepts
// it learns that a member has mail, and nothing else.
//
// The rules stay in Postgres. send_message() decides whether the message is
// delivered at all — the daily cap on new conversations, the global toggle, the
// per-person switch — and this function only emails when it returns a real
// message id. A message that was quietly declined produces no email, which is
// what makes "quietly" true.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASSWORD') ?? '';
const SITE = 'https://edgeoinnovations-resources.github.io/6DegreesBeta/';

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

  let to = '';
  let body = '';
  try {
    const b = await req.json();
    to = String(b.to ?? '');
    body = String(b.body ?? '');
  } catch { return json({ error: 'Bad request.' }, 400, origin); }

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'You are not signed in.' }, 401, origin);

  // Postgres decides. A refusal here is a real refusal (empty body, daily cap,
  // person has left); a quiet decline comes back as message_id 0.
  const { data, error } = await asUser.rpc('send_message', { p_to: to, p_body: body });
  if (error) return json({ error: error.message }, 400, origin);

  const row = Array.isArray(data) ? data[0] : data;
  const convo = Number(row?.conversation_id || 0);
  const msgId = Number(row?.message_id || 0);

  // Declined, or nothing to tell anyone about.
  if (!msgId) return json({ status: 'SENT' }, 200, origin);
  if (!SERVICE_KEY || !SMTP_USER || !SMTP_PASS) {
    return json({ status: 'SENT', notified: false, reason: 'sender not configured' }, 200, origin);
  }

  // ── Tell them, without telling them anything ──────────────────────────────
  let notified = false;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: t } = await admin.rpc('notify_target', {
      p_conversation: convo, p_sender: user.id,
    });
    const target = Array.isArray(t) ? t[0] : t;

    if (target?.should_send && target.recipient_email) {
      const client = new SMTPClient({
        connection: {
          hostname: 'smtp.gmail.com', port: 465, tls: true,
          auth: { username: SMTP_USER, password: SMTP_PASS },
        },
      });
      const who = esc(target.sender_name || 'Someone');
      await client.send({
        from: `6 Degrees <${SMTP_USER}>`,
        to: target.recipient_email,
        subject: 'You have a message on 6 Degrees',
        // No address, no message body. Deliberately dull.
        html: `<p style="font-size:15px">You&rsquo;ve received a direct message on the 6 Degrees site
from <strong>${who}</strong>. Log in to read it.</p>
<p><a href="${SITE}" style="display:inline-block;background:#17A2B8;color:#fff;
padding:9px 16px;border-radius:6px;text-decoration:none">Open 6 Degrees</a></p>
<p style="color:#667;font-size:12px">Neither of you can see the other&rsquo;s email address.
You can stop receiving messages at any time under Your details.</p>`,
      });
      await client.close();
      await admin.rpc('mark_notified', { p_conversation: convo });
      notified = true;
    }
  } catch (_e) {
    // A message that arrived but was not announced is still a message. Never
    // fail the send because a mail server was busy.
  }

  return json({ status: 'SENT', notified }, 200, origin);
});
