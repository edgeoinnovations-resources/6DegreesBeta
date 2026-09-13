// supabaseClient.js — the one Supabase client for the whole app.
//
// Loaded from a CDN as an ES module, in keeping with the rest of the project:
// no bundler, no node_modules, relative paths only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUILD } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Magic links come back with tokens in the URL; let the client consume them.
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    storageKey: 'sixdeg.auth',
  },
});


// ── Error log ───────────────────────────────────────────────────────────────
// Every failure is written to public.client_errors so it can be reviewed and
// fixed later, rather than discovered one screenshot at a time. Write-only: no
// member can read the log (see supabase/migrations/20260913001700_client_error_log.sql).
//
// Deliberately careful, because these are real people:
//   * no email addresses, form contents, notes, tag text or URL tokens — anything
//     email- or token-shaped is stripped here AND again in the database;
//   * capped per page load, and identical errors are sent once, so a loop that
//     throws cannot flood the free-tier database;
//   * the logger can never throw, and never logs its own failures (which would
//     recurse).
const LOG_CAP = 25;
let logged = 0;
const seen = new Set();

const scrub = (x, max) => String(x ?? '')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
  .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
  .slice(0, max);

function safePath() {
  const h = location.hash || '';
  // A magic link arrives with tokens in the fragment. Never send those.
  const hash = /token|code=|error_description/.test(h) ? '#[auth]' : h.split('?')[0];
  return (location.pathname + hash).slice(0, 200);
}

export function logError({ action = '', code = '', message = '', stack = '' } = {}) {
  try {
    if (logged >= LOG_CAP) return;
    const key = `${action}|${code}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    logged += 1;
    supabase.from('client_errors').insert({
      build: String(BUILD).slice(0, 60),
      view: String(window.__6degView || '').slice(0, 40),
      action: scrub(action, 80),
      code: scrub(code, 40),
      message: scrub(message, 1000),
      stack: scrub(stack, 4000),
      path: safePath(),
      user_agent: String(navigator.userAgent || '').slice(0, 300),
    }).then(() => {}, () => {});   // fire and forget; a failed log is not itself logged
  } catch { /* the logger must never break the app */ }
}

// Anything nobody caught.
window.addEventListener('error', (e) => {
  logError({
    action: 'uncaught error',
    code: e.error?.name || 'Error',
    message: e.message || String(e.error || ''),
    stack: e.error?.stack || `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  logError({
    action: 'unhandled promise',
    code: r?.code || r?.name || 'Rejection',
    message: r?.message || String(r || ''),
    stack: r?.stack || '',
  });
});

// Strip the auth fragment once a session is established, so a copied URL never
// carries someone's tokens and a refresh doesn't try to re-consume them.
export function cleanAuthParamsFromUrl() {
  if (/[#&](access_token|refresh_token|error_description|code)=/.test(location.hash)
      || /[?&](code|error_description)=/.test(location.search)) {
    const clean = location.pathname + (location.hash.startsWith('#/') ? location.hash : '');
    history.replaceState(null, '', clean);
  }
}

// Supabase surfaces the invite-only trigger as a generic database error. Turn it
// into something a person can act on.
export function friendlyAuthError(err) {
  const msg = (err && (err.message || err.error_description || '')) || 'Something went wrong.';
  logError({ action: 'sign in', code: err?.code || err?.status || '', message: msg });
  // The invite-only trigger raises a clear exception, but GoTrue swallows it and
  // returns this generic wrapper instead. Verified 13 Sep 2026: an uninvited
  // address gets exactly "Database error saving new user".
  if (/not been invited/i.test(msg) || /database error saving new user/i.test(msg)) {
    return 'That email hasn’t been invited to 6 Degrees yet — ask someone in the group to add you. '
         + '(If you believe it has been, tell Paul: the sign-up itself failed.)';
  }
  // This is NOT a per-person limit and it is not a minute. Supabase's built-in
  // sender allows only a couple of messages per hour ACROSS THE WHOLE PROJECT,
  // so one person working through several sign-ins uses up everyone's allowance —
  // which is exactly how Sarah got blocked by Paul's attempts without ever having
  // requested a link herself. Saying "wait a minute" sends people back to press
  // the button again and fail again.
  if (/rate limit|too many|over_email_send_rate_limit/i.test(msg)) {
    return 'Sign-in emails are rate limited while we’re on the free plan — only a couple an hour, '
         + 'shared across everyone. Someone else has probably just used them up. '
         + 'Try again in a while, or message Paul and he can sort it.';
  }
  if (/redirect/i.test(msg)) {
    return 'This site isn’t on the allowed redirect list yet — tell Paul.';
  }
  return msg;
}

// ── Database errors, in words a person can act on ───────────────────────────
// Linda was shown `insert or update on table "schools" violates foreign key
// constraint "schools_added_by_fkey"` — raw Postgres, meaningless to her and
// useless as a report. Every error the UI shows goes through here now.
//
// Each message keeps a short REFERENCE (the Postgres/PostgREST code) so a
// screenshot is still diagnosable, and the full error always goes to the
// console with the action that failed.
const FRIENDLY_BY_CODE = {
  '23503': 'Something this depends on isn’t set up yet.',
  '23505': 'That already exists.',
  '23514': 'Some of that isn’t in a form we can save.',
  '23502': 'Something required is missing.',
  '22P02': 'Some of that isn’t in a form we can save.',
  '22007': 'One of the dates isn’t valid.',
  '22008': 'One of the dates isn’t valid.',
  '42501': 'The database refused that — your sign-in may have expired.',
  PGRST301: 'Your sign-in has expired.',
  PGRST303: 'Your sign-in has expired.',
};

// Codes whose message WE wrote in SQL (raise exception ... using errcode), so the
// text is already meant for people and should be shown as-is.
const AUTHORED_CODES = new Set(['22023', '28000', 'P0001']);

export function friendlyDbError(err, action = 'do that') {
  const code = err?.code || '';
  const raw = err?.message || String(err || '');
  console.error(`[6deg] failed to ${action}:`, { code, message: raw, details: err?.details, hint: err?.hint, err });
  logError({ action, code, message: [raw, err?.details, err?.hint].filter(Boolean).join(' | '), stack: err?.stack || '' });

  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return 'Couldn’t reach the server. Check your connection and try again.';
  }
  if (/JWT|expired/i.test(raw) && !AUTHORED_CODES.has(code)) {
    return 'Your sign-in has expired. Reload the page and sign in again — nothing is lost.';
  }
  if (AUTHORED_CODES.has(code) && raw && !/ALREADY_LISTED/.test(raw)) {
    return raw;
  }

  const lead = FRIENDLY_BY_CODE[code] || `Couldn’t ${action}.`;
  const signIn = code === '42501' || code.startsWith('PGRST30');
  const next = signIn
    ? ' Reload the page and sign in again, then try once more.'
    : code === '23505'
      ? ''
      : ' Try again, and if it keeps happening let Paul know.';
  const ref = code ? ` Reference: ${code}.` : '';
  return `${lead}${next}${ref}`;
}
