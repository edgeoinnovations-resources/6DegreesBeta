// tags.js — private notes, and public labels that need both people to agree.
//
// TWO SEPARATE THINGS, deliberately kept apart:
//
//   NOTES are free text, private to you, and nobody else ever sees them. This is
//   Dee's "made this kickass website together" — a reminder for yourself.
//
//   TAGS are a short curated vocabulary, public, and require the other person to
//   approve. Free text is not allowed here, because Paul is right about where it
//   goes: "you meet me and decide that I'm a toxic person. So on your profile you
//   give me the tag of 'TOXIC A-Hole from Barcelona IB Training'. Everyone can
//   see that." Curation plus consent is what stops that, and Linda set the rule:
//   "both people should have to tag/approve it for it to be public ... I could
//   tag him and he could just ignore it and it wouldn't show."
//
// An approved tag also CREATES a connection (see the `connections` view), which
// is the only way two people who never shared a place can appear linked at all.
import { supabase, friendlyDbError } from './supabaseClient.js';
import { el } from './widgets.js';

let _types = null;
export async function tagTypes() {
  if (_types) return _types;
  const { data, error } = await supabase.from('tag_types').select('*').order('sort_order');
  if (error) throw error;
  _types = data || [];
  return _types;
}

export async function tagsBetween(me, other) {
  const { data, error } = await supabase
    .from('connection_tags')
    .select('*')
    .or(`and(requester_id.eq.${me},subject_id.eq.${other}),and(requester_id.eq.${other},subject_id.eq.${me})`);
  if (error) throw error;
  return data || [];
}

export async function pendingForMe(me) {
  const { data, error } = await supabase
    .from('connection_tags')
    .select('*')
    .eq('subject_id', me)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// The insert policy requires requester_id = auth.uid(), so read it live rather
// than trusting anything captured earlier — the registration bug was exactly
// that mistake.
export async function createTag(subjectId, tagKey, context) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error('Your sign-in expired. Reload and try again.');
  return supabase.from('connection_tags').insert({
    requester_id: session.user.id,
    subject_id: subjectId,
    tag_key: tagKey,
    context: context?.trim() || null,
  });
}

export const respondToTag = (id, status) =>
  supabase.from('connection_tags').update({ status }).eq('id', id);

// ── Notes ───────────────────────────────────────────────────────────────────
export async function noteFor(subjectId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from('notes').select('*')
    .eq('author_id', session.user.id).eq('subject_id', subjectId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function saveNote(subjectId, body, existingId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error('Your sign-in expired. Reload and try again.');
  const text = body.trim();
  if (!text) {
    if (existingId) return supabase.from('notes').delete().eq('id', existingId);
    return { error: null };
  }
  if (existingId) return supabase.from('notes').update({ body: text }).eq('id', existingId);
  return supabase.from('notes').insert({
    author_id: session.user.id, subject_id: subjectId, body: text,
  });
}

// ── UI: the tag + note section of a person card ─────────────────────────────
export function tagSection(ctx, otherId, onChanged) {
  const wrap = el('div.tag-section');
  wrap.appendChild(el('h4', { text: 'Your connection' }));
  const body = el('div', { text: 'Loading…' });
  body.className = 'muted';
  body.style.fontSize = '12.5px';
  wrap.appendChild(body);

  (async () => {
    try {
      const [types, existing, note] = await Promise.all([
        tagTypes(), tagsBetween(ctx.me, otherId), noteFor(otherId),
      ]);
      body.className = '';
      body.style.fontSize = '';
      body.innerHTML = '';

      // ── public tags ───────────────────────────────────────────────────────
      types.forEach((ty) => {
        const mine = existing.find((x) => x.tag_key === ty.key);
        const row = el('div.tag-row');
        const label = el('div.tag-label', {}, [
          el('strong', { text: ty.label }),
          el('small', { text: ty.description || '' }),
        ]);
        row.appendChild(label);

        const action = el('div.tag-action');
        if (!mine) {
          const btn = el('button.btn.ghost', { type: 'button', text: 'Confirm this' });
          btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = 'Sending…';
            const ctxInput = row.querySelector('input');
            const { error } = await createTag(otherId, ty.key, ctxInput?.value);
            if (error) { btn.disabled = false; btn.textContent = 'Confirm this'; note0(row, friendlyDbError(error, 'send that')); return; }
            onChanged?.();
          });
          action.append(
            el('input', { type: 'text', placeholder: 'e.g. met at the IB Global Conference 2026', maxlength: '200' }),
            btn,
          );
        } else if (mine.status === 'pending') {
          const iAsked = mine.requester_id === ctx.me;
          if (iAsked) {
            action.appendChild(el('span.tag-state.pending', { text: 'Waiting for them to confirm' }));
          } else {
            const yes = el('button.btn.accent', { type: 'button', text: 'Confirm' });
            const no = el('button.btn.ghost', { type: 'button', text: 'Decline' });
            yes.addEventListener('click', () => respond(row, mine.id, 'approved', 'confirm that', onChanged));
            no.addEventListener('click', () => respond(row, mine.id, 'declined', 'decline that', onChanged));
            action.append(el('span.tag-state.pending', { text: 'They say yes — do you?' }), yes, no);
          }
        } else if (mine.status === 'approved') {
          const revoke = el('button.btn.ghost', { type: 'button', text: 'Remove' });
          revoke.addEventListener('click', () => respond(row, mine.id, 'revoked', 'remove that', onChanged));
          action.append(el('span.tag-state.ok', { text: 'Confirmed by you both' }), revoke);
        } else {
          action.appendChild(el('span.tag-state', { text: mine.status === 'declined' ? 'Declined' : 'Removed' }));
        }
        row.appendChild(action);
        if (mine?.context) row.appendChild(el('p.tag-context', { text: `“${mine.context}”` }));
        body.appendChild(row);
      });

      body.appendChild(el('p.muted', {
        style: 'font-size:11.5px;margin:10px 0 0;',
        text: 'A confirmed connection is public and shows on both your graphs. Either of you can remove it later.',
      }));

      // ── private note ──────────────────────────────────────────────────────
      const nWrap = el('div.note-block');
      nWrap.append(
        el('h4', { text: 'Private note' }),
        el('p.muted', { style: 'font-size:11.5px;margin:0 0 6px;', text: 'Only you can read this. Not shown to them or anyone else.' }),
      );
      const ta = el('textarea', { rows: '2', placeholder: 'Anything you want to remember about them…', maxlength: '2000' });
      ta.value = note?.body || '';
      const nBtn = el('button.btn.ghost', { type: 'button', text: 'Save note' });
      const nMsg = el('span.muted', { style: 'font-size:12px;' });
      nBtn.addEventListener('click', async () => {
        nBtn.disabled = true; nMsg.textContent = 'Saving…';
        const { error } = await saveNote(otherId, ta.value, note?.id);
        nBtn.disabled = false;
        nMsg.textContent = error ? friendlyDbError(error, 'save your note') : 'Saved.';
      });
      nWrap.append(ta, el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px;' }, [nBtn, nMsg]));
      body.appendChild(nWrap);
    } catch (err) {
      body.className = 'auth-msg error';
      body.textContent = friendlyDbError(err, 'load your connection');
    }
  })();

  return wrap;
}

// Respond to a tag, and only move on if the database actually accepted it. These
// buttons used to ignore the result and reload, so a refused change looked like it
// had worked until the page came back unchanged.
async function respond(row, id, status, action, onChanged) {
  row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const { error } = await respondToTag(id, status);
  if (error) {
    row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    note0(row, friendlyDbError(error, action));
    return;
  }
  onChanged?.();
}

function note0(row, msg) {
  let p = row.querySelector('.tag-err');
  if (!p) { p = el('p.tag-err'); row.appendChild(p); }
  p.textContent = msg;
}
