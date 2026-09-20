// connectionsInbox.js — the "Connections" icon in the header.
//
// Paul, 13 Sep 2026: "when Linda tags me, there should be a notification symbol
// on the top of my browser page that's a small Icon that when hovered over says
// 'Connections'. When the user clicks on it, it opens a window that allows the
// user to validate, and edit those connections."
//
// It carries a count of what is waiting on YOU, and opens a window with three
// groups: things to answer, things you have asked for, and what is already
// confirmed (which you can undo).
import { supabase, friendlyDbError, logError } from './supabaseClient.js';
import { el } from './widgets.js';
import { tagTypes, respondToTag } from './tags.js';

let panel = null;

function close() {
  if (panel) { panel.remove(); panel = null; }
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') close(); }

async function loadAll(me, ctx) {
  const [{ data: tags, error }, types] = await Promise.all([
    supabase.from('connection_tags')
      .select('*')
      .or(`requester_id.eq.${me},subject_id.eq.${me}`)
      .order('created_at', { ascending: false }),
    tagTypes(),
  ]);
  if (error) throw error;
  const rows = tags || [];

  // WHO IS ASKING. Dee's inbox said "Someone says you know each other" over a
  // request from Paul, while Robb, Bob and Linda were named correctly on the
  // same screen — because names were read only from the graph already in the
  // browser, and that holds your own neighbourhood alone. The people missing
  // from it are exactly the people this feature is FOR: somebody you share no
  // school, city or country with. The first person ever to use it was
  // anonymous to the person she had to trust.
  //
  // So fetch the ones we cannot name. public_profiles is readable by any
  // member, and these are people already asking to be recognised by name.
  const names = new Map();
  const unknown = [...new Set(rows
    .map((t) => (t.requester_id === me ? t.subject_id : t.requester_id))
    .filter((id) => !ctx.idx.teacherById.has(id)))];
  if (unknown.length) {
    const { data: people } = await supabase
      .from('public_profiles').select('id, display_name').in('id', unknown);
    (people || []).forEach((p) => names.set(p.id, p.display_name));
  }
  return { tags: rows, types, names };
}

function nameOf(ctx, id, names) {
  return (ctx.idx.teacherById.get(id) || {}).FULL_NAME
    || names?.get(id)
    || 'Someone';
}

function group(title, blurb, rows) {
  const sec = el('div.inbox-sec');
  sec.append(el('h4', { text: title }));
  if (blurb) sec.append(el('p.muted', { style: 'font-size:11.5px;margin:0 0 8px;', text: blurb }));
  if (!rows.length) {
    sec.append(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'Nothing here.' }));
  } else rows.forEach((r) => sec.appendChild(r));
  return sec;
}

export async function openInbox(ctx) {
  close();
  panel = el('div.person-overlay');
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
  document.addEventListener('keydown', onKey);

  const card = el('div.person-card.inbox', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Connections' });
  const x = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  x.addEventListener('click', close);
  card.append(x, el('h3.person-name', { text: 'Connections' }));
  const body = el('div.muted', { text: 'Loading…' });
  card.appendChild(body);
  panel.appendChild(card);
  document.body.appendChild(panel);

  try {
    const { tags, types, names } = await loadAll(ctx.me, ctx);
    const label = (k) => (types.find((t) => t.key === k) || {}).label || k;
    body.className = '';
    body.innerHTML = '';

    const refresh = async () => { close(); await ctx.reload(); };

    // Run a change and only reload if it worked; otherwise say why on that row.
    // (These used to ignore errors and reload as though they had succeeded.)
    const act = async (r, action, fn) => {
      r.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const { error } = await fn();
      if (error) {
        r.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        let msg = r.querySelector('.inbox-err');
        if (!msg) { msg = el('p.inbox-err'); r.appendChild(msg); }
        msg.textContent = friendlyDbError(error, action);
        return;
      }
      refresh();
    };

    const row = (t, actions) => {
      const other = t.requester_id === ctx.me ? t.subject_id : t.requester_id;
      const r = el('div.inbox-row');
      r.append(el('div', {}, [
        el('strong', { text: nameOf(ctx, other, names) }),
        el('small', { text: label(t.tag_key) + (t.context ? ` · “${t.context}”` : '') }),
      ]));
      const buttons = el('div.inbox-act');
      actions.forEach((a) => buttons.appendChild(a));
      r.appendChild(buttons);
      return r;
    };

    // 1. waiting on you
    const toAnswer = tags.filter((t) => t.status === 'pending' && t.subject_id === ctx.me).map((t) => {
      const yes = el('button.btn.accent', { type: 'button', text: 'Confirm' });
      const no = el('button.btn.ghost', { type: 'button', text: 'Decline' });
      const r = row(t, [yes, no]);
      yes.addEventListener('click', () => act(r, 'confirm that', () => respondToTag(t.id, 'approved')));
      no.addEventListener('click', () => act(r, 'decline that', () => respondToTag(t.id, 'declined')));
      return r;
    });

    // 2. waiting on them
    const waiting = tags.filter((t) => t.status === 'pending' && t.requester_id === ctx.me).map((t) => {
      const undo = el('button.btn.ghost', { type: 'button', text: 'Withdraw' });
      const r = row(t, [el('span.tag-state.pending', { text: 'Waiting' }), undo]);
      undo.addEventListener('click', () => act(r, 'withdraw that',
        () => supabase.from('connection_tags').delete().eq('id', t.id)));
      return r;
    });

    // 3. confirmed
    const confirmed = tags.filter((t) => t.status === 'approved').map((t) => {
      const rm = el('button.btn.ghost', { type: 'button', text: 'Remove' });
      const r = row(t, [el('span.tag-state.ok', { text: 'Confirmed' }), rm]);
      rm.addEventListener('click', () => act(r, 'remove that', () => respondToTag(t.id, 'revoked')));
      return r;
    });

    body.append(
      group('Waiting for you', 'Someone says you know each other. Nothing is public until you agree.', toAnswer),
      group('Waiting for them', 'You’ve said you know them; it stays private until they confirm.', waiting),
      group('Confirmed', 'Public on both your graphs. Either of you can remove one at any time.', confirmed),
    );
  } catch (err) {
    body.className = 'auth-msg error';
    body.textContent = friendlyDbError(err, 'load your connections');
  }
}

/** The header icon. Returns the element; refresh() re-counts. */
export function connectionsIcon(ctx) {
  const btn = el('button.conn-icon', { type: 'button', title: 'Connections', 'aria-label': 'Connections' });
  btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>'
    + '<line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>';
  const badge = el('span.conn-badge');
  badge.style.display = 'none';
  btn.appendChild(badge);
  btn.addEventListener('click', () => openInbox(ctx));

  // This poll runs every minute for as long as a tab is open, so anything that
  // breaks it breaks it sixty times an hour. By 18 Sep 2026 it was the ENTIRE
  // contents of the error log: eleven rows across three people, all of them
  // "TypeError: Failed to fetch" or no message at all. None named a bug. A
  // sleeping laptop, a backgrounded tab and a dropped wifi connection all land
  // here, and reporting them buries anything real.
  //
  // So: don't poll when nobody is looking or the browser says it is offline, and
  // treat a dropped request as something to retry rather than something to
  // report. Only a failure that PERSISTS while the tab is visible and the
  // browser believes it is online is worth a member's error log — that one is a
  // real outage rather than a blip.
  const POLL_MS = 60000;
  const REPORT_AFTER = 5;        // five straight minutes of failure, not one blip
  let consecutiveFailures = 0;

  // No PostgREST code means the request never reached the database. An empty
  // message is the same story: supabase-js hands back an error object with
  // nothing on it when fetch itself rejects.
  const neverReachedServer = (e) => !e?.code
    && /fetch|network|load failed|aborted|^$/i.test(String(e?.message || ''));

  const refresh = async () => {
    if (document.hidden || navigator.onLine === false) return;
    try {
      const { count, error } = await supabase
        .from('connection_tags')
        .select('id', { count: 'exact', head: true })
        .eq('subject_id', ctx.me)
        .eq('status', 'pending');
      if (error) throw error;
      consecutiveFailures = 0;
      if (count > 0) {
        badge.textContent = String(count);
        badge.style.display = '';
        btn.title = `Connections — ${count} waiting for you`;
        btn.classList.add('has-pending');
      } else {
        badge.style.display = 'none';
        btn.title = 'Connections';
        btn.classList.remove('has-pending');
      }
    } catch (err) {
      if (neverReachedServer(err)) {
        consecutiveFailures += 1;
        // Exactly at the threshold, so a long outage reports once and not hourly.
        if (consecutiveFailures === REPORT_AFTER) {
          logError({
            action: 'count pending connections',
            code: 'no-response',
            message: `${REPORT_AFTER} consecutive failures while visible and online: ${err?.message || 'no message'}`,
          });
        }
        return;
      }
      // A real answer from the database — a permission or query fault. Always
      // worth reporting, and worth reporting the first time.
      consecutiveFailures = 0;
      logError({
        action: 'count pending connections',
        code: err?.code || err?.name || '',
        message: err?.message || String(err),
      });
    }
  };

  refresh();
  // Someone may confirm while you have the page open.
  setInterval(refresh, POLL_MS);
  // Catch up the moment someone comes back to the tab or the network returns,
  // rather than showing a stale badge for the rest of the minute.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  return btn;
}
