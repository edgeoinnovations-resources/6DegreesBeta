// reportIssue.js — "Having an issue?"
//
// Paul, 19 Sep 2026: a button members click when they hit a problem, with a note
// and a screenshot, saved to the database and emailed to him, so a coding
// session can start from a list rather than from memory.
//
// The half that isn't asked for: the context. Which screen, which build, which
// browser, what size the window was, and anything the error logger caught in the
// half hour before. A member should not have to know any of that — and it is
// usually what identifies the bug. The map glitch took five builds partly
// because nobody was recording the window width.
//
// Screenshots go to a private bucket. They contain other members' names and
// histories, so a member can write one and never read one back, not even their
// own.
import { supabase, logError } from './supabaseClient.js';
import { el, append } from './widgets.js';
import { BUILD } from './config.js';

let panel = null;

export function closeReport() {
  if (panel) { panel.remove(); panel = null; }
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') closeReport(); }

function context() {
  return {
    view: window.__6degView || '',
    build: BUILD,
    path: location.hash || location.pathname,
    userAgent: navigator.userAgent || '',
    windowSize: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
  };
}

export function openReport(ctx) {
  closeReport();
  panel = el('div.person-overlay');
  panel.addEventListener('click', (e) => { if (e.target === panel) closeReport(); });
  document.addEventListener('keydown', onKey);

  const card = el('div.person-card.inbox', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Report a problem',
  });
  const x = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  x.addEventListener('click', closeReport);
  card.append(x, el('h3.person-name', { text: 'Having an issue?' }));
  card.appendChild(el('p.muted', {
    style: 'font-size:12.5px;margin:0 0 12px;',
    text: 'Tell us what went wrong — even roughly. A screenshot helps a lot. '
        + 'Which screen you were on and which version you are running are sent with it, '
        + 'so you don’t have to know any of that.',
  }));

  const note = el('textarea', {
    rows: '5', maxlength: '4000', 'aria-label': 'What went wrong',
    placeholder: 'What were you doing, and what happened instead?',
    style: 'width:100%;font:inherit;font-size:13px;padding:9px;border:1px solid #d7e3e8;border-radius:8px;',
  });
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': 'Screenshot' });
  const go = el('button.btn.accent', { type: 'button', text: 'Send it' });
  const status = el('p.auth-msg', { style: 'margin:8px 0 0;' });

  const c = context();
  const form = el('div.card', { style: 'margin:0;' });
  append(form,
    note,
    el('p.muted', { style: 'font-size:11.5px;margin:10px 0 4px;', text: 'Screenshot (optional)' }),
    file,
    el('p.muted', {
      style: 'font-size:11px;margin:6px 0 0;',
      text: `Sent with this: ${c.view || 'this screen'} · ${c.build} · ${c.windowSize}`,
    }),
    el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:12px;' }, [go]),
    status,
  );
  card.appendChild(form);
  panel.appendChild(card);
  document.body.appendChild(panel);
  note.focus();

  go.addEventListener('click', async () => {
    const text = note.value.trim();
    status.className = 'auth-msg';
    if (text.length < 3) {
      status.className = 'auth-msg error';
      status.textContent = 'A sentence is plenty — just say what happened.';
      return;
    }
    go.disabled = true; go.textContent = 'Sending…';
    try {
      // The screenshot goes up first; the report carries its path. If the upload
      // fails the report still goes — a described problem beats no problem.
      let shot = null;
      const f = file.files?.[0];
      if (f) {
        status.textContent = 'Uploading the screenshot…';
        const ext = (f.name.split('.').pop() || 'png').toLowerCase().slice(0, 5);
        const path = `${ctx.me}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('issue-screenshots').upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) {
          logError({ action: 'upload screenshot', code: upErr.name, message: upErr.message });
        } else {
          shot = path;
        }
      }

      status.textContent = 'Sending…';
      const { data, error } = await supabase.functions.invoke('report-issue', {
        body: { note: text, screenshot: shot, ...context() },
      });
      if (error) {
        let msg = '';
        try { msg = (await error.context?.json())?.error || ''; } catch { /* not json */ }
        throw new Error(msg || error.message || 'That didn’t go through.');
      }

      status.className = 'auth-msg ok';
      status.textContent = data?.emailed
        ? `Thank you — that's report #${data.id}, and Paul has it.`
        : `Thank you — that's report #${data.id}. It's saved and Paul will see it.`;
      note.value = ''; file.value = '';
      setTimeout(closeReport, 2600);
    } catch (err) {
      status.className = 'auth-msg error';
      status.textContent = err?.message || 'That didn’t go through. Try again in a moment.';
      logError({ action: 'report issue', code: err?.code, message: err?.message });
    } finally {
      go.disabled = false; go.textContent = 'Send it';
    }
  });
}

/** The always-there button. Small, out of the way, never in front of the map. */
export function issueButton(ctx) {
  const btn = el('button.issue-btn', {
    type: 'button', title: 'Report a problem', 'aria-label': 'Having an issue? Report a problem',
  }, ['Having an issue?']);
  btn.addEventListener('click', () => openReport(ctx));
  return btn;
}
