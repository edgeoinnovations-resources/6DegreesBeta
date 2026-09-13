// auth.js — the gate. Nothing in the app renders until there is a session.
//
// Paul, 13 Sep 2026, on what a signed-out visitor sees: "Nothing. Redirect to
// sign-in." Sign-in is an email magic link, and sign-up is invite only — the
// database enforces that with a trigger on auth.users, so it holds however
// someone arrives, not just through this screen.
import { supabase, cleanAuthParamsFromUrl, friendlyAuthError } from './supabaseClient.js';
import { REDIRECT_URL } from './config.js';
import { el } from './widgets.js';

// ── Sign-in screen ──────────────────────────────────────────────────────────
function signInScreen(onSent) {
  const card = el('div.auth-card');
  card.append(
    el('div.auth-brand', {}, [
      el('span.brand-mark', { text: '6°' }),
      el('div', {}, [
        el('h1', { text: '6 Degrees' }),
        el('p', { text: 'How international school teachers are connected by place & time' }),
      ]),
    ]),
    el('p.auth-lead', { text: 'Sign in with your email. We’ll send you a link — no password to remember.' }),
  );

  const form = el('form.auth-form');
  const input = el('input', {
    type: 'email', required: 'required', autocomplete: 'email',
    placeholder: 'you@email.com', 'aria-label': 'Email address',
  });
  const btn = el('button.btn.accent', { type: 'submit', text: 'Email me a sign-in link' });
  const msg = el('p.auth-msg');
  form.append(input, btn);
  card.append(form, msg);

  card.append(el('p.auth-foot', {
    html: 'Invite only while we’re in beta. If your email isn’t on the list, ask someone in the group to add you.',
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    msg.className = 'auth-msg';
    msg.textContent = '';

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: REDIRECT_URL, shouldCreateUser: true },
    });

    if (error) {
      msg.className = 'auth-msg error';
      msg.textContent = friendlyAuthError(error);
      btn.disabled = false;
      btn.textContent = 'Email me a sign-in link';
      return;
    }
    onSent(email, card, form, msg);
  });

  return card;
}

function showSent(email, card, form, msg) {
  form.style.display = 'none';
  msg.className = 'auth-msg ok';
  msg.innerHTML = `Check <strong>${email}</strong> — the link is on its way.<br>`
    + '<small>It can take a minute, and it may land in spam.</small>';
}

// ── Mount ───────────────────────────────────────────────────────────────────
function mountSignIn(root) {
  root.innerHTML = '';
  document.body.classList.add('signed-out');
  const wrap = el('div.auth-wrap');
  wrap.appendChild(signInScreen(showSent));
  root.appendChild(wrap);
}

/**
 * Resolve the session before the app boots.
 * Returns { session, user } once signed in; renders the gate and never resolves
 * otherwise (the page is replaced when auth state changes).
 */
export async function requireSession(root) {
  // A magic link returns here with tokens in the URL; supabase-js consumes them.
  const { data: { session } } = await supabase.auth.getSession();
  cleanAuthParamsFromUrl();

  if (session) {
    document.body.classList.remove('signed-out');
    return session;
  }

  // Signing in from the emailed link fires this in the same tab.
  const ready = new Promise((resolve) => {
    supabase.auth.onAuthStateChange((event, s) => {
      if (s && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
        cleanAuthParamsFromUrl();
        document.body.classList.remove('signed-out');
        resolve(s);
      }
    });
  });

  mountSignIn(root);
  return ready;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}

// ── Profile bootstrap ───────────────────────────────────────────────────────
// A session is not a profile. Someone can be authenticated and still have no
// row in public.profiles — that is the state the onboarding flow exists for.
export async function loadMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return { user, profile: data || null };
}
