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
    + `${SITE}\n\n`
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
    text: 'The network only works with people in it. Add anyone you have worked with — '
        + 'they can sign in with this address, and nobody else can.',
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
  const go = el('button.btn.accent', { type: 'button', text: 'Add them' });
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
    const joined = rows.filter((r) => r.accepted_at).length;
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
      const pill = r.accepted_at
        ? el('span.deg-pill.ack', { text: 'Joined' })
        : el('span.deg-pill', { style: 'background:#9fb3bd;', text: 'Waiting' });
      const body = el('span', {
        html: `<strong>${r.email}</strong><br><small class="muted">`
          + `${r.note ? `${r.note} · ` : ''}`
          + `${r.accepted_at ? `joined ${when(r.accepted_at)}` : `invited ${when(r.created_at)}`}</small>`,
      });
      append(row, pill, body);

      if (!r.accepted_at) {
        const copy = el('button.btn.ghost', { type: 'button', text: 'copy message' });
        copy.addEventListener('click', async () => {
          await share(r.email, copy);
        });
        const drop = el('button.btn.ghost', { type: 'button', text: 'withdraw' });
        drop.addEventListener('click', async () => {
          drop.disabled = true;
          const { error } = await supabase.rpc('uninvite', { p_email: r.email });
          if (error) { drop.disabled = false; drop.textContent = 'failed'; return; }
          refreshList();
        });
        row.append(el('span', { style: 'margin-left:auto;display:flex;gap:6px;' }, [copy, drop]));
      }
      ul.appendChild(row);
    });
    list.appendChild(ul);
  }

  // Clipboard access can be refused (insecure context, permissions), so always
  // leave the text on screen to copy by hand.
  async function share(addr, btn) {
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
    if (btn) { btn.textContent = copied ? 'copied' : 'shown below'; setTimeout(() => { btn.textContent = 'copy message'; }, 2500); }
  }

  go.addEventListener('click', async () => {
    const addr = email.value.trim();
    status.className = 'auth-msg';
    if (!addr) { status.className = 'auth-msg error'; status.textContent = 'Put in their email address.'; return; }
    go.disabled = true; go.textContent = 'Adding…';
    try {
      const { data, error } = await supabase.rpc('invite_someone', {
        p_email: addr, p_note: note.value.trim() || null,
      });
      if (error) throw error;
      if (data === 'ALREADY_LISTED') {
        status.className = 'auth-msg';
        status.textContent = 'That address is already on the list — they can sign in whenever they like.';
      } else {
        status.className = 'auth-msg ok';
        status.textContent = 'Added. Now send them the message below.';
        await share(addr, null);
        email.value = ''; note.value = '';
        refreshList();
      }
    } catch (err) {
      status.className = 'auth-msg error';
      status.textContent = friendlyDbError(err, 'add that invitation');
      logError({ action: 'invite someone', code: err?.code, message: err?.message });
    } finally {
      go.disabled = false; go.textContent = 'Add them';
    }
  });

  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  refreshList();
  email.focus();
}
