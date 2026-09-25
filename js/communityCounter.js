// communityCounter.js — how big this has got.
//
// Paul, 20 Sep 2026: a way to see how many people are in the community — fun and
// visible, but simple and streamlined. Then: put it on the Map page too, which
// is why it lives in its own file rather than inside one view.
//
// A thin strip, not a dashboard. Big numbers, quiet labels, one line: it reads
// at a glance and then gets out of the way. Sarah's note in June about the app
// having too many dashboards is still the best design advice this project has
// had, and a counter is exactly the sort of thing that grows into one.
//
// Counted server-side in a single round trip. The screens this appears on
// deliberately do not hold the whole network any more — the Connections page
// loads only your own neighbourhood — so counting in the browser would mean
// downloading everybody in order to say how many there are.
import { supabase } from './supabaseClient.js';
import { el } from './widgets.js';

const CELLS = [
  ['members', 'in the community'],
  ['schools', 'schools'],
  ['countries', 'countries'],
  // The one this product exists to count, and it climbs faster than the
  // membership — so it moves even in a week when nobody new joins.
  ['connections', 'connections between us'],
];

/**
 * @param {object}   opts
 * @param {boolean}  opts.compact    tighter, for sitting on top of the map
 * @param {function} opts.onMembers  called when the member count is clicked
 */
export function communityCounter({ compact = false, onMembers = null } = {}) {
  const wrap = el(`div.community-bar${compact ? '.compact' : ''}`);
  const nodes = CELLS.map(([key, label]) => {
    const n = el('span.cc-num', { text: '—' });
    // Linda, 25 Sep 2026: "I love this dashboard. Is it possible to make this
    // clickable so I can see the full community list?" Only the member count —
    // it is the one with a list behind it that a person would want to read.
    if (key === 'members' && onMembers) {
      const cell = el('button.cc-cell.cc-link', {
        type: 'button', title: 'See everyone in the community',
      }, [n, el('span.cc-lbl', { text: label })]);
      cell.addEventListener('click', onMembers);
      wrap.appendChild(cell);
    } else {
      wrap.appendChild(el('div.cc-cell', {}, [n, el('span.cc-lbl', { text: label })]));
    }
    return [key, n];
  });

  // Counting up is the whole "fun" of it. Not for anyone whose system asks for
  // less motion, and not for numbers small enough that it reads as a flicker.
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const countTo = (node, target) => {
    if (still || target <= 3) { node.textContent = String(target); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      node.textContent = String(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  supabase.rpc('community_stats').then(({ data, error }) => {
    // A broken box at the top of a screen is worse than no box.
    if (error || !data) { wrap.remove(); return; }
    const row = Array.isArray(data) ? data[0] : data;
    nodes.forEach(([key, node]) => countTo(node, Number(row[key]) || 0));
  }, () => wrap.remove());

  return wrap;
}
