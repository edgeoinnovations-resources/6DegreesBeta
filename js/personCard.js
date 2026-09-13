// personCard.js — the panel you get when you click someone.
//
// Melissa, 13 Sep 2026: "I see Paul's name and I want to see 'Paul who?' But the
// moment I touch his name, now he's the center. I just wanted to see his details.
// Not put him in the middle yet."
//
// So clicking opens this instead of re-centring, and you stay at the middle of
// your own graph — which is also what Dee asked for: "it's always tied to the
// user who is logged in."
import { el } from './widgets.js';
import { degreeColor, degreeLabel, roleCategory } from './degrees.js';
import { tagSection } from './tags.js';

let overlay = null;

export function closePersonCard() {
  if (overlay) { overlay.remove(); overlay = null; }
  document.removeEventListener('keydown', onKey);
}

function onKey(e) { if (e.key === 'Escape') closePersonCard(); }

/**
 * @param ctx    app context (data, idx, me)
 * @param id     the person to show
 * @param extras optional array of elements appended to the card (tags, notes)
 */
export function openPersonCard(ctx, id, extras = []) {
  const { idx, adj, me } = ctx;
  const t = idx.teacherById.get(id);
  if (!t) return;

  closePersonCard();
  overlay = el('div.person-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePersonCard(); });
  document.addEventListener('keydown', onKey);

  const card = el('div.person-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t.FULL_NAME });
  const close = el('button.person-close', { type: 'button', text: '×', 'aria-label': 'Close' });
  close.addEventListener('click', closePersonCard);
  card.appendChild(close);

  // ── who ───────────────────────────────────────────────────────────────────
  const meta = [t.SPECIALIZATION, t.NATIONALITY].filter(Boolean).join(' · ');
  card.append(
    el('h3.person-name', { text: t.FULL_NAME }),
    meta ? el('p.person-meta', { text: meta }) : null,
  );

  if (t.IS_GHOST) {
    card.appendChild(el('p.muted', { style: 'font-size:12.5px;', text: 'This person has left 6 Degrees. Their history stays so everyone else’s connections remain correct.' }));
  }

  // ── how you're connected ──────────────────────────────────────────────────
  if (id !== me) {
    const links = (adj.get(me) || []).filter((e) => e.other === id)
      .sort((a, b) => (a.degree ?? 99) - (b.degree ?? 99));
    const box = el('div.person-conn');
    if (!links.length) {
      box.append(el('h4', { text: 'How you’re connected' }),
        el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'You haven’t shared a school, city or country — and haven’t confirmed knowing each other.' }));
    } else {
      box.appendChild(el('h4', { text: 'How you’re connected' }));
      links.forEach((e) => {
        const row = el('div.conn-row');
        if (e.degree) {
          row.append(
            el('span.deg-pill', { style: `background:${degreeColor(e.degree)}`, text: `Degree ${e.degree}` }),
            el('span', { html: `<strong>${e.label || ''}</strong><br><small class="muted">${degreeLabel(e.degree)}${e.overlap ? ` · ${e.overlap}` : ''}</small>` }),
          );
        } else {
          // a mutually approved tag between two people who never shared a place
          row.append(
            el('span.deg-pill.ack', { text: 'Acknowledged' }),
            el('span', { html: '<strong>You’ve both confirmed you know each other</strong><br><small class="muted">No shared school, city or country</small>' }),
          );
        }
        box.appendChild(row);
      });
    }
    card.appendChild(box);
  } else {
    card.appendChild(el('p.muted', { style: 'font-size:12.5px;', text: 'This is you.' }));
  }

  // ── their history ─────────────────────────────────────────────────────────
  const postings = (idx.postingsByTeacher.get(id) || []).slice()
    .sort((a, b) => String(b.START_DATE).localeCompare(String(a.START_DATE)));
  const hist = el('div.person-hist');
  hist.appendChild(el('h4', { text: 'Where they’ve been' }));
  if (!postings.length) {
    hist.appendChild(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'No postings listed.' }));
  } else {
    const ul = el('ul');
    postings.forEach((p) => {
      const s = idx.schoolById.get(p.SCHOOL_ID) || {};
      const from = String(p.START_DATE || '').slice(0, 4);
      const to = p.END_DATE ? String(p.END_DATE).slice(0, 4) : 'present';
      ul.appendChild(el('li', {
        html: `<strong>${s.SCHOOL_NAME || p.SCHOOL_ID}</strong><small>${[s.CITY, s.COUNTRY].filter(Boolean).join(', ')} · ${roleCategory(p.POSITION_TITLE)} · ${from}–${to}</small>`,
      }));
    });
    hist.appendChild(ul);
  }
  card.appendChild(hist);

  // Confirming a connection and keeping a private note both belong here — this is
  // where you are already looking at the person.
  if (id !== me && !t.IS_GHOST) {
    card.appendChild(tagSection(ctx, id, () => {
      // A tag change alters the graph, so reload rather than patch it in place.
      if (ctx.reload) ctx.reload(); else location.reload();
    }));
  }

  for (const x of extras) if (x) card.appendChild(x);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  close.focus();
  return card;
}
