// invites.js — bringing someone into the network.
//
// Dave, 6 Sep 2025: "to keep some of the bad actors that abound on our planet out
// of 6DoIT, we will probably want to have some sort of system where new members
// would have to either be invited or approved by those already in the system."
//
// The check has always been there — every sign-in is tested against
// public.invites — but only Paul could add a row, by hand, in SQL. This is the
// missing half.
//
// ADDING SOMEONE DOES NOT EMAIL THEM. The project's sender is wired for magic
// links only, and the June meeting put in-app messaging out of scope. So the
// panel writes the message for you and you send it however you already talk to
// that person. That also keeps the promise that the app never becomes a way to
// contact people who have not asked to be contacted.
import { supabase, friendlyDbError, logError } from './supabaseClient.js';
import { el, append } from './widgets.js';

const SITE = 'https://edgeoinnovations-resources.github.io/6DegreesBeta/';

let panel = null;

export function closeInvites() {
  if (panel) { panel.remove(); panel = null; }
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') closeInvites(); }

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// What the inviter sends. Written so it can be pasted into WhatsApp, which is
// where this group actually lives.
function invitationText(name, email) {
  return `I've added you to 6 Degrees — it maps how international school teachers `
    + `are connected through the schools and cities we've shared.\n\n`
    + `${SITE}\n`
    + `What it is: ${SITE}about.html\n\n`
    + `Sign in with ${email} and it'll email you a link. No password. `
    + `Check your spam for the first one.\n\n`
    + `It asks where you've worked — country, city, school, and the years. `
    + `Add everything, including schools back home; the whole point is who knows who.`
    + (name ? `\n\n— ${name}` : '');
}

export async function openInvitePanel(ctx) {
  closeInvites();
  panel = el('div.person-overlay');
  panel.addEventListener('click', (e) => { if (e.target === panel) closeInvites(); });
  document.addEventListener('keydown', onKey);

  const card = el('div.person-card.inbox', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Invite someone',
  });
  const x = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  x.addEventListener('click', closeInvites);
  card.append(x, el('h3.person-name', { text: 'Invite someone' }));
  card.appendChild(el('p.muted', {
    style: 'font-size:12.5px;margin:0 0 12px;',
    text: 'The network only works with people in it. Invite anyone you have worked with — '
        + 'they get an email with a sign-in link, and only that address can use it.',
  }));

  // ── the form ──────────────────────────────────────────────────────────────
  const email = el('input', {
    type: 'email', autocomplete: 'off', 'aria-label': 'Their email address',
    placeholder: 'their email address',
  });
  const note = el('input', {
    type: 'text', maxlength: '200', autocomplete: 'off', 'aria-label': 'Note to yourself',
    placeholder: 'note to yourself (optional) — where you know them from',
  });
  const go = el('button.btn.accent', { type: 'button', text: 'Send invitation' });
  const status = el('p.auth-msg', { style: 'margin:8px 0 0;' });
  const shareBox = el('div');
  shareBox.hidden = true;

  const form = el('div.card', { style: 'margin:0 0 14px;' });
  append(form,
    el('div.controls', {}, [
      el('div.control-group', { style: 'flex:1 1 220px;' }, [el('label', { text: 'Email' }), email]),
      el('div.control-group', { style: 'flex:2 1 260px;' }, [el('label', { text: 'Note (optional)' }), note]),
    ]),
    el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:8px;' }, [go]),
    status,
    shareBox,
  );
  card.appendChild(form);

  const list = el('div');
  card.appendChild(list);
  panel.appendChild(card);
  document.body.appendChild(panel);

  // ── what you've already sent ──────────────────────────────────────────────
  async function refreshList() {
    list.innerHTML = '';
    list.appendChild(el('p.muted', { style: 'font-size:12.5px;', text: 'Loading…' }));
    const { data, error } = await supabase.rpc('my_invites');
    list.innerHTML = '';
    if (error) {
      list.appendChild(el('p.auth-msg.error', { text: friendlyDbError(error, 'load your invitations') }));
      logError({ action: 'load my invites', code: error.code, message: error.message });
      return;
    }
    const rows = data || [];
    const joined = rows.filter((r) => r.registered).length;
    list.appendChild(el('h4', {
      text: rows.length
        ? `You've invited ${rows.length} ${rows.length === 1 ? 'person' : 'people'}`
          + (joined ? ` — ${joined} joined` : '')
        : 'You haven’t invited anyone yet',
    }));
    if (!rows.length) return;

    const ul = el('div.inbox-sec');
    rows.forEach((r) => {
      const row = el('div.conn-row');
      // Three states, not two. "Signed in" is someone who clicked the link and did
      // not finish — worth seeing, because they are the ones to nudge.
      const pill = r.registered
        ? el('span.deg-pill.ack', { text: 'Joined' })
        : r.signed_in_at
          ? el('span.deg-pill', { style: 'background:#e0a458;', text: 'Started' })
          : el('span.deg-pill', { style: 'background:#9fb3bd;', text: 'Invited' });
      const state = r.registered ? `joined ${when(r.signed_in_at || r.created_at)}`
        : r.signed_in_at ? `opened the link ${when(r.signed_in_at)} — hasn’t finished their details`
        : `invited ${when(r.created_at)}`;
      const body = el('span', {
        html: `<strong>${r.email}</strong><br><small class="muted">`
          + `${r.note ? `${r.note} · ` : ''}${state}</small>`,
      });
      append(row, pill, body);

      if (!r.registered) {
        // Was "copy message", from before invitations sent themselves. Re-sending
        // the email is the useful action now — and the only way to deliver the
        // invitations that were recorded before the sender existed.
        const again = el('button.btn.ghost', { type: 'button', text: 'resend' });
        again.addEventListener('click', async () => {
          again.disabled = true; again.textContent = 'sending…';
          const sent = await sendInvite(r.email, null);
          again.textContent = sent.ok ? 'sent' : 'failed';
          if (!sent.ok && sent.fallback) await share(r.email);
          setTimeout(() => { again.disabled = false; again.textContent = 'resend'; }, 2500);
          if (sent.ok) refreshList();
        });
        const drop = r.signed_in_at ? null
          : el('button.btn.ghost', { type: 'button', text: 'withdraw' });
        if (drop) {
          drop.addEventListener('click', async () => {
            drop.disabled = true;
            const { error } = await supabase.rpc('uninvite', { p_email: r.email });
            if (error) { drop.disabled = false; drop.textContent = 'failed'; return; }
            refreshList();
          });
        }
        row.append(el('span', { style: 'margin-left:auto;display:flex;gap:6px;' },
          [again, drop].filter(Boolean)));
      }
      ul.appendChild(row);
    });
    list.appendChild(ul);
  }

  // Only reached when the email could NOT be sent. Clipboard access can be
  // refused (insecure context, permissions), so the text is always left on screen
  // to copy by hand as well.
  async function share(addr) {
    const text = invitationText(ctx.profile?.first_name || '', addr);
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch { /* shown below instead */ }
    shareBox.hidden = false;
    shareBox.innerHTML = '';
    append(shareBox,
      el('p.muted', {
        style: 'font-size:12px;margin:10px 0 4px;',
        text: copied ? 'Copied — send it to them however you normally would.'
                     : 'Copy this and send it to them:',
      }),
      el('textarea', {
        rows: '7', readonly: 'readonly',
        style: 'width:100%;font:inherit;font-size:12px;padding:8px;border:1px solid #d7e3e8;border-radius:6px;',
      }, [text]),
    );
    shareBox.querySelector('textarea').select();
  }

  // The single path to the sender. Returns { ok, status, message, fallback }.
  async function sendInvite(addr, noteText) {
    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: {
        email: addr,
        note: noteText || null,
        redirectTo: `${location.origin}${location.pathname}`,
      },
    });
    if (error) {
      let msg = '';
      try { msg = (await error.context?.json())?.error || ''; } catch { /* not json */ }
      return { ok: false, message: msg || error.message || 'That didn’t go through.' };
    }
    if (data?.status === 'ALREADY_LISTED') {
      return { ok: false, status: 'ALREADY_LISTED', already: true,
        message: 'Someone else already invited that address — they can sign in whenever they like.' };
    }
    if (data?.status === 'RECORDED_NOT_SENT') {
      logError({ action: 'send invite email', code: 'not-sent', message: String(data.error || '') });
      return { ok: false, fallback: true,
        message: 'They’re on the list, but the email didn’t go out. Send them the message below yourself.' };
    }
    return { ok: true, status: data?.status,
      message: data?.status === 'RESENT'
        ? `Invitation sent again to ${addr}.`
        : `Invitation emailed to ${addr}. Tell them to check spam for the first one.` };
  }

  go.addEventListener('click', async () => {
    const addr = email.value.trim();
    status.className = 'auth-msg';
    if (!addr) { status.className = 'auth-msg error'; status.textContent = 'Put in their email address.'; return; }
    go.disabled = true; go.textContent = 'Sending…';
    try {
      // Typing an address you already invited re-sends it, rather than telling you
      // that you already did. The server decides whether that is allowed.
      const res = await sendInvite(addr, note.value.trim());
      status.className = res.ok ? 'auth-msg ok' : 'auth-msg error';
      status.textContent = res.message;
      if (res.fallback) await share(addr);
      if (res.ok) { email.value = ''; note.value = ''; }
      refreshList();
    } catch (err) {
      status.className = 'auth-msg error';
      status.textContent = friendlyDbError(err, 'send that invitation');
      logError({ action: 'invite someone', code: err?.code, message: err?.message });
    } finally {
      go.disabled = false; go.textContent = 'Send invitation';
    }
  });

  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  refreshList();
  email.focus();
}
