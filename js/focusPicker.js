// focusPicker.js — "whose connections do you want to see?"
//
// Paul, 20 Sep 2026: a dialogue rather than a drop-down. "That will be more
// robust for the user, and it may be better when there's hundreds or thousands
// of people in the database." Both true — a select element with three thousand
// options is unusable, and a dialogue has room to explain itself.
//
// And: "Many of these users will be older and may need MORE ways to remind them
// about what they're looking at." So one large search box that looks for a NAME
// or a SCHOOL at the same time, rather than a tidy set of tabs and filters that
// each have to be learned. Type anything you remember about the person.
//
// Under the box, the people you are already connected to, because that is who
// you are usually looking for and it means the dialogue is useful before you
// have typed a single character.
import { supabase, friendlyDbError } from './supabaseClient.js';
import { el, append } from './widgets.js';
import { degreeColor, degreeLabel } from './degrees.js';

let panel = null;
let lastQuery = 0;

export function closeFocusPicker() {
  if (panel) { panel.remove(); panel = null; }
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') closeFocusPicker(); }

/**
 * @param {object}   ctx
 * @param {string}   currentId  who is focused now
 * @param {function} onPick     (id, name) — null id means "back to me"
 */
export function openFocusPicker(ctx, currentId, onPick) {
  closeFocusPicker();
  panel = el('div.person-overlay');
  panel.addEventListener('click', (e) => { if (e.target === panel) closeFocusPicker(); });
  document.addEventListener('keydown', onKey);

  const card = el('div.person-card.inbox', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose whose connections to see',
  });
  const x = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  x.addEventListener('click', closeFocusPicker);
  card.append(x, el('h3.person-name', { text: 'Whose connections do you want to see?' }));
  card.appendChild(el('p.muted', {
    style: 'font-size:13px;margin:0 0 12px;',
    text: 'Type a person’s name, or the name of a school they worked at. '
        + 'You can also pick from the people you’re connected to below.',
  }));

  const box = el('input', {
    type: 'search', autocomplete: 'off', 'aria-label': 'Search by name or school',
    placeholder: 'e.g. Linda, or American School of Dubai',
    style: 'width:100%;font:inherit;font-size:15px;padding:11px 13px;'
      + 'border:1px solid #d7e3e8;border-radius:9px;',
  });
  card.appendChild(box);

  // Back to your own, always offered when you are looking at someone else — a
  // second way out besides the banner on the page behind this.
  if (currentId && currentId !== ctx.me) {
    const back = el('button.btn.accent', {
      type: 'button', text: '← Back to my own connections',
      style: 'margin-top:12px;width:100%;',
    });
    back.addEventListener('click', () => { closeFocusPicker(); onPick(null, null); });
    card.appendChild(back);
  }

  const heading = el('h4', { style: 'margin:16px 0 6px;', text: 'People you’re connected to' });
  const list = el('div');
  card.append(heading, list);
  panel.appendChild(card);
  document.body.appendChild(panel);
  box.focus();

  const row = (r) => {
    const btn = el('button.focus-row', { type: 'button' });
    const deg = r.my_degree
      ? el('span.deg-pill', { style: `background:${degreeColor(r.my_degree)}`, text: String(r.my_degree) })
      : el('span.deg-pill', { style: 'background:#cfdce2;', text: '·' });
    const where = r.matched_school && r.matched_school !== r.current_place
      ? `${r.current_place || ''} · was at ${r.matched_school}`
      : (r.current_place || '');
    append(btn, deg, el('span', {
      html: `<strong>${r.display_name}</strong><br><small class="muted">`
        + `${where || 'no postings listed'}`
        + `${r.my_degree ? ` · ${degreeLabel(r.my_degree)} to you` : ''}</small>`,
    }));
    btn.addEventListener('click', () => {
      closeFocusPicker();
      onPick(r.id, r.display_name);
    });
    return btn;
  };

  async function search(term) {
    const mine = ++lastQuery;
    list.innerHTML = '';
    list.appendChild(el('p.muted', { style: 'font-size:12.5px;', text: 'Looking…' }));
    const { data, error } = await supabase.rpc('find_members', { p_query: term || null });
    if (mine !== lastQuery) return;            // a later keystroke already won
    list.innerHTML = '';
    if (error) {
      list.appendChild(el('p.auth-msg.error', { text: friendlyDbError(error, 'search the community') }));
      return;
    }
    const rows = (data || []).filter((r) => r.id !== ctx.me);
    heading.textContent = term
      ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'} for “${term}”`
      : 'People you’re connected to';
    if (!rows.length) {
      list.appendChild(el('p.muted', {
        style: 'font-size:12.5px;',
        text: `Nobody found for “${term}”. Try part of a name, or a school.`,
      }));
      return;
    }
    // Your own people come back first, then everybody else. Say which is which
    // rather than letting one heading stand over both — the first version of
    // this listed Bob under "People you're connected to", and Paul is not
    // connected to Bob.
    const mineRows = rows.filter((r) => r.my_degree);
    const others = rows.filter((r) => !r.my_degree);
    if (term) {
      rows.forEach((r) => list.appendChild(row(r)));
      return;
    }
    if (mineRows.length) mineRows.forEach((r) => list.appendChild(row(r)));
    else {
      heading.textContent = 'Everyone in the community';
    }
    if (others.length) {
      if (mineRows.length) list.appendChild(el('p.focus-group', { text: 'Others in the community' }));
      others.forEach((r) => list.appendChild(row(r)));
    }
  }

  let debounce = null;
  box.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => search(box.value.trim()), 220);
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(debounce); search(box.value.trim()); }
  });

  search('');
}
