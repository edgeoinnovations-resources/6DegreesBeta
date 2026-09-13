// supabaseClient.js — the one Supabase client for the whole app.
//
// Loaded from a CDN as an ES module, in keeping with the rest of the project:
// no bundler, no node_modules, relative paths only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
