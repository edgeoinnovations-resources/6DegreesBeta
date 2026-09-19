// messages.js — the thing this project has been asked for since September 2025.
//
// Linda: "if there's a connection we want people to be able to reach out."
// Dave's houseguest, in June: "Interesting data, but no way to connect."
// Linda again on 13 Sep: "If I saw we were connected but I had lost touch with
// you, I'd want to be able to connect."
//
// Nobody ever sees anybody's email address. The rules live in Postgres —
// send_message() decides who may write to whom, and the policies decide who may
// read. This file draws them; it does not enforce them.
import { supabase, friendlyDbError, logError } from './supabaseClient.js';
import { el, append } from './widgets.js';

let panel = null;
let pollTimer = null;

export function closeMessages() {
  if (panel) { panel.remove(); panel = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') closeMessages(); }

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = (Date.now() - d) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// ── One conversation ────────────────────────────────────────────────────────
async function openThread(ctx, otherId, otherName, back) {
  const card = panel.querySelector('.person-card');
  card.innerHTML = '';
  const x = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  x.addEventListener('click', closeMessages);
  const title = el('h3.person-name', { text: otherName || 'Message' });
  card.append(x, title);

  if (back) {
    const b = el('button.back-link', { type: 'button', text: '← All messages' });
    b.addEventListener('click', () => openInbox(ctx));
    card.appendChild(b);
  }

  const list = el('div.msg-thread');
  const box = el('textarea', {
    rows: '3', maxlength: '4000', 'aria-label': 'Your message',
    placeholder: `Write to ${(otherName || '').split(' ')[0] || 'them'}…`,
    style: 'width:100%;font:inherit;font-size:13px;padding:9px;border:1px solid #d7e3e8;border-radius:8px;',
  });
  const send = el('button.btn.accent', { type: 'button', text: 'Send' });
  const status = el('p.auth-msg', { style: 'margin:6px 0 0;' });
  card.append(list, el('div', { style: 'margin-top:10px;' }, [box]),
    el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:8px;' }, [send]), status);

  let convoId = null;

  async function draw() {
    const { data: convos } = await supabase.rpc('my_conversations');
    const row = (convos || []).find((c) => c.other_id === otherId);
    convoId = row?.conversation_id || null;
    if (!convoId) {
      list.innerHTML = '';
      list.appendChild(el('p.muted', { style: 'font-size:12.5px;',
        text: 'No messages yet. Say hello.' }));
      return;
    }
    const { data: msgs, error } = await supabase
      .from('messages')
      .select('id, sender_id, body, created_at, read_at')
      .eq('conversation_id', convoId)
      .order('created_at');
    if (error) { logError({ action: 'load thread', code: error.code, message: error.message }); return; }

    list.innerHTML = '';
    (msgs || []).forEach((m) => {
      const mine = m.sender_id === ctx.me;
      const bubble = el(`div.msg${mine ? '.mine' : ''}`);
      bubble.append(
        el('div.msg-body', { text: m.body }),
        el('div.msg-meta', { text: `${when(m.created_at)}${mine && m.read_at ? ' · read' : ''}` }),
      );
      list.appendChild(bubble);
    });
    list.scrollTop = list.scrollHeight;
    await supabase.rpc('mark_read', { p_conversation: convoId });
  }

  send.addEventListener('click', async () => {
    const body = box.value.trim();
    status.className = 'auth-msg';
    if (!body) return;
    send.disabled = true; send.textContent = 'Sending…';
    try {
      const { error } = await supabase.rpc('send_message', { p_to: otherId, p_body: body });
      if (error) throw error;
      box.value = '';
      await draw();
    } catch (err) {
      status.className = 'auth-msg error';
      status.textContent = friendlyDbError(err, 'send that message');
      logError({ action: 'send message', code: err?.code, message: err?.message });
    } finally {
      send.disabled = false; send.textContent = 'Send';
    }
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send.click();
  });

  await draw();
  box.focus();
  if (pollTimer) clearInterval(pollTimer);
  // Someone may reply while the thread is open.
  pollTimer = setInterval(() => { if (!document.hidden) draw(); }, 15000);
}

// ── The inbox ───────────────────────────────────────────────────────────────
export async function openInbox(ctx) {
  if (!panel) {
    panel = el('div.person-overlay');
    panel.addEventListener('click', (e) => { if (e.target === panel) closeMessages(); });
    document.addEventListener('keydown', onKey);
    panel.appendChild(el('div.person-card.inbox', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Messages',
    }));
    document.body.appendChild(panel);
  }
  const card = panel.querySelector('.person-card');
  card.innerHTML = '';
  const x = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  x.addEventListener('click', closeMessages);
  card.append(x, el('h3.person-name', { text: 'Messages' }));

  const body = el('div.muted', { text: 'Loading…' });
  card.appendChild(body);

  const { data, error } = await supabase.rpc('my_conversations');
  body.className = '';
  body.innerHTML = '';
  if (error) {
    body.appendChild(el('p.auth-msg.error', { text: friendlyDbError(error, 'load your messages') }));
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    body.appendChild(el('p.muted', {
      style: 'font-size:12.5px;',
      text: 'No messages yet. Open anyone in your connections and write to them.',
    }));
    return;
  }
  rows.forEach((c) => {
    const row = el('div.conn-row', { style: 'cursor:pointer;' });
    const pill = c.unread > 0
      ? el('span.deg-pill.ack', { text: String(c.unread) })
      : el('span.deg-pill', { style: 'background:#cfdce2;', text: '·' });
    append(row, pill, el('span', {
      html: `<strong>${c.other_name}</strong><br><small class="muted">`
        + `${c.last_from_me ? 'You: ' : ''}${(c.last_body || '').slice(0, 70)} · ${when(c.last_at)}</small>`,
    }));
    row.addEventListener('click', () => openThread(ctx, c.other_id, c.other_name, true));
    body.appendChild(row);
  });
}

/** Straight into one conversation, from the person card. */
export function messageSomeone(ctx, otherId, otherName) {
  if (!panel) {
    panel = el('div.person-overlay');
    panel.addEventListener('click', (e) => { if (e.target === panel) closeMessages(); });
    document.addEventListener('keydown', onKey);
    panel.appendChild(el('div.person-card.inbox', { role: 'dialog', 'aria-modal': 'true' }));
    document.body.appendChild(panel);
  }
  openThread(ctx, otherId, otherName, true);
}

/** Header icon with the unread count. */
export function messagesIcon(ctx) {
  const btn = el('button.conn-icon', { type: 'button', title: 'Messages', 'aria-label': 'Messages' });
  btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';
  const badge = el('span.conn-badge');
  badge.style.display = 'none';
  btn.appendChild(badge);
  btn.addEventListener('click', () => openInbox(ctx));

  // Same discipline as the connections poll: nothing while the tab is hidden or
  // the browser says it is offline, and a dropped request is retried rather than
  // reported. That poll was once the entire contents of the error log.
  let failures = 0;
  const refresh = async () => {
    if (document.hidden || navigator.onLine === false) return;
    try {
      const { data, error } = await supabase.rpc('unread_count');
      if (error) throw error;
      failures = 0;
      const n = Number(data) || 0;
      badge.textContent = String(n);
      badge.style.display = n ? '' : 'none';
      btn.classList.toggle('has-pending', n > 0);
      btn.title = n ? `Messages — ${n} unread` : 'Messages';
    } catch (err) {
      if (!err?.code) { failures += 1; if (failures === 5) {
        logError({ action: 'count unread messages', code: 'no-response', message: String(err?.message || '') });
      } return; }
      logError({ action: 'count unread messages', code: err.code, message: err.message });
    }
  };
  refresh();
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  return btn;
}
