// personCard.js — the panel you get when you click someone.
//
// Melissa, 13 Sep 2026: "I see Paul's name and I want to see 'Paul who?' But the
// moment I touch his name, now he's the center. I just wanted to see his details.
// Not put him in the middle yet."
//
// So clicking opens this instead of re-centring, and you stay at the middle of
// your own graph — which is also what Dee asked for: "it's always tied to the
// user who is logged in."
import { el, append } from './widgets.js';
import { degreeColor, degreeLabel, roleCategory, degreeChip } from './degrees.js';
import { pairKey } from './loadData.js';
import { supabase } from './supabaseClient.js';
import { tagSection } from './tags.js';
import { messageSomeone } from './messages.js';

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
export function openPersonCard(ctx, id, extras = [], via = null) {
  const { data, idx, adj, me } = ctx;
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
  // Nationality and subject were dropped on 18 Sep 2026 — they fed nothing and the
  // seven of us had already written USA, American and Canadian for the same field.
  // What belongs here instead is the formal first name, and only when it differs
  // from the name someone goes by: a colleague searching for "Deanna" needs to
  // recognise "Dee Milne".
  const goesBy = t.PREFERRED_NAME && t.GIVEN_NAME && t.PREFERRED_NAME !== t.GIVEN_NAME
    ? `${t.GIVEN_NAME} ${t.LAST_NAME}`.trim()
    : '';
  append(card,
    el('h3.person-name', { text: t.FULL_NAME }),
    goesBy ? el('p.person-meta', { text: goesBy }) : null,
  );

  // ── "Focus on Linda", next to Linda's name ───────────────────────────────
  //
  // Sarah, 20 Sep 2026: she clicks her connection to Linda, reads where Linda
  // has worked, and at that moment wants to see who LINDA knows. The readout at
  // the top right already does it, but it is at the other end of the screen and
  // she is thinking about Linda here.
  //
  // Only on the Connections page: ctx.focusOn is set by that view and cleared
  // the moment you navigate away, so a card opened from the Map never offers to
  // re-centre a graph that is not on screen. Never for yourself — you are
  // already the middle — and never for a ghost, in step with them not being
  // findable in the picker either.
  const firstName = (t.FIRST_NAME || t.FULL_NAME || '').split(' ')[0] || 'them';
  if (ctx.focusOn && id !== me && !t.IS_GHOST && ctx.focusedId?.() !== id) {
    const focus = el('button.btn.focus-on', {
      type: 'button', text: `Focus on ${firstName}`,
      title: `See ${firstName}'s connections in the middle of the page`,
    });
    focus.addEventListener('click', () => {
      closePersonCard();
      ctx.focusOn(id, t.FULL_NAME);
    });
    append(card,
      el('div', { style: 'margin:0 0 12px;' }, [focus]),
      el('p.muted', { style: 'font-size:11.5px;margin:-8px 0 12px;',
        text: `Puts ${firstName} in the middle and shows who ${firstName} knows. `
            + 'Your own circles come back when you leave the page.' }),
    );
  }

  // Final destination, where they gave one. Phrased from what they told us
  // rather than guessed: "retired in" and "plans to retire in" are different
  // facts and picking wrong would be wrong half the time.
  if (t.FINAL_CITY) {
    const where = [t.FINAL_CITY, t.FINAL_REGION, t.FINAL_COUNTRY].filter(Boolean).join(', ');
    const lead = t.FINAL_STATUS === 'planned' ? 'Plans to retire in' : 'Retired in';
    const line = el('p.person-final', { style: 'margin:2px 0 10px;font-size:13px;' });
    line.innerHTML = `<span aria-hidden="true">🏡</span> ${lead} <strong>${where}</strong>`;
    if (id !== me) {
      const who = el('button.acct-edit', { type: 'button', text: 'who else is there?' });
      who.addEventListener('click', async () => {
        who.disabled = true; who.textContent = 'looking…';
        const { data } = await supabase.rpc('who_else_retired', {
          p_city: t.FINAL_CITY, p_country: t.FINAL_COUNTRY,
        });
        const names = (data || []).filter((r) => r.id !== id).map((r) => r.display_name);
        who.replaceWith(el('span.muted', {
          style: 'font-size:12px;',
          text: names.length
            ? `Also there: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}`
            : 'Nobody else here yet.',
        }));
      });
      line.append(' ', who);
    }
    card.appendChild(line);
  }

  if (t.IS_GHOST) {
    card.appendChild(el('p.muted', { style: 'font-size:12.5px;', text: 'This person has left 6 Degrees. Their history stays so everyone else’s connections remain correct.' }));
  }

  // ── how you're connected ──────────────────────────────────────────────────
  // EVERY shared context, not just the strongest. Dave, 13 Sep 2026: "Linda is
  // only listed as a Degree 1 connection, even though we are technically also
  // Degree 2 and Degree 4 connections as well (we were both at ASW in Poland, but
  // during different years)." Linda the same evening: "Robb and I only show 1 1st
  // degree connection, but we have almost all of the schools the same."
  //
  // The headline degree — the one that puts someone on a ring — is still the
  // lowest of these, and it is the first row because the list is sorted by degree.
  // Looking at somebody else's graph: show THEIR link to this person as well as
  // your own. Paul, 20 Sep 2026 — "both is good". It answers the question you
  // actually arrived with, which is usually how to reach this person.
  if (via && via.viaId && via.viaId !== me && via.viaId !== id) {
    const box = el('div.person-conn');
    box.appendChild(el('h4', { text: `${via.viaName || 'They'} and ${t.FIRST_NAME || 'them'}` }));
    const body = el('div');
    box.appendChild(body);
    body.appendChild(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'Loading…' }));
    card.appendChild(box);
    supabase.rpc('pair_contexts_between', { p_a: via.viaId, p_b: id }).then(({ data: rows }) => {
      body.innerHTML = '';
      if (!rows?.length) {
        body.appendChild(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'No shared school, city or country.' }));
        return;
      }
      rows.forEach((e) => {
        body.appendChild(el('div.conn-row', {}, [
          el('span.deg-pill', { style: `background:${degreeColor(e.degree)}`, text: degreeChip(e.degree) }),
          el('span', {
            html: `<strong>${e.context_label}</strong><br><small class="muted">`
              + `${degreeLabel(e.degree)}${e.overlap_years ? ` · ${e.overlap_years}` : ''}</small>`,
          }),
        ]));
      });
    }, () => { body.innerHTML = ''; });
  }

  if (id !== me) {
    // Whatever is already in hand (the full graph, if a heavy view loaded it),
    // otherwise asked for below — one pair, not the whole table.
    let shared = (data.sharedByPair && data.sharedByPair.get(pairKey(me, id))) || [];
    const link = (adj.get(me) || []).find((e) => e.other === id);
    const acknowledged = !!(link && link.acknowledged);
    const box = el('div.person-conn');

    const nothingKnownYet = !shared.length && !acknowledged && !data.partial;
    if (nothingKnownYet) {
      box.append(el('h4', { text: 'How you’re connected' }),
        el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'You haven’t shared a school, city or country — and haven’t confirmed knowing each other.' }));
    } else {
      box.appendChild(el('h4', {
        text: shared.length > 1 ? `You and ${t.FIRST_NAME || 'them'} — ${shared.length} ways` : `You and ${t.FIRST_NAME || 'them'}`,
      }));

      // The confirmation first: it is the one thing the two of you said yourselves.
      let ackNote = null;
      if (acknowledged) {
        ackNote = el('small.muted');
        box.appendChild(el('div.conn-row', {}, [
          el('span.deg-pill.ack', { text: 'Confirmed' }),
          el('span', {}, [
            el('strong', { text: 'You’ve both confirmed you know each other' }),
            el('br'), ackNote,
          ]),
        ]));
      }
      // Whether there IS a shared history is not known yet when only your own
      // neighbourhood is loaded, so this line has to be written again once the
      // rows arrive. Paul and Linda's card read "No shared school, city or
      // country" directly above their degree 1 at the American School of Dubai.
      const sayAck = (n) => {
        if (!ackNote) return;
        ackNote.textContent = n
          ? 'Alongside the shared history below — it doesn’t change your degree'
          : 'No shared school, city or country';
      };
      sayAck(shared.length);

      const drawShared = (rows) => {
        box.querySelectorAll('.conn-row.ctx').forEach((n) => n.remove());
        rows.forEach((e) => {
          box.appendChild(el('div.conn-row.ctx', {}, [
            el('span.deg-pill', { style: `background:${degreeColor(e.DEGREE)}`, text: degreeChip(e.DEGREE) }),
            el('span', {
              html: `<strong>${e.SHARED_CONTEXT_LABEL}</strong><br><small class="muted">`
                + `${degreeLabel(e.DEGREE)}${e.OVERLAP_YEARS ? ` · ${e.OVERLAP_YEARS}` : ''}</small>`,
            }),
          ]));
        });
        box.querySelector('h4').textContent = rows.length > 1
          ? `How you’re connected — ${rows.length} ways`
          : 'How you’re connected';
        sayAck(rows.length);
      };
      drawShared(shared);

      // Nothing in hand means only your own neighbourhood is loaded. Ask for this
      // one pair rather than pulling everyone's.
      if (!shared.length) {
        supabase.rpc('pair_contexts', { p_other: id }).then(({ data: rows }) => {
          if (!rows?.length || !overlay || !document.body.contains(box)) return;
          drawShared(rows.map((r) => ({
            DEGREE: r.degree,
            SHARED_CONTEXT_TYPE: r.context_type,
            SHARED_CONTEXT_LABEL: r.context_label,
            TIME_RELATION: r.time_relation,
            OVERLAP_YEARS: r.overlap_years || '',
          })));
        }, () => {});
      }
    }
    card.appendChild(box);
  } else {
    card.appendChild(el('p.muted', { style: 'font-size:12.5px;', text: 'This is you.' }));
  }

  // ── their history ─────────────────────────────────────────────────────────
  // Only YOUR postings are loaded at boot now, so somebody else's history is
  // fetched here. It said "No postings listed" for everyone until this was
  // caught on Linda's card, which shows nine.
  const hist = el('div.person-hist');
  hist.appendChild(el('h4', { text: 'Where they’ve been' }));
  const histBody = el('div');
  hist.appendChild(histBody);
  card.appendChild(hist);

  const drawHistory = (postings, schoolOf) => {
    histBody.innerHTML = '';
    if (!postings.length) {
      histBody.appendChild(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'No postings listed.' }));
      return;
    }
    const ul = el('ul');
    postings.slice()
      .sort((a, b) => String(b.START_DATE).localeCompare(String(a.START_DATE)))
      .forEach((p) => {
        const s = schoolOf(p) || {};
        const from = String(p.START_DATE || '').slice(0, 4);
        const to = p.END_DATE ? String(p.END_DATE).slice(0, 4) : 'present';
        ul.appendChild(el('li', {
          html: `<strong>${s.SCHOOL_NAME || p.SCHOOL_ID}</strong><small>${[s.CITY, s.REGION, s.COUNTRY].filter(Boolean).join(', ')} · ${roleCategory(p.POSITION_TITLE)} · ${from}–${to}</small>`,
        }));
      });
    histBody.appendChild(ul);
  };

  const known = idx.postingsByTeacher.get(id) || [];
  if (known.length) {
    drawHistory(known, (p) => idx.schoolById.get(p.SCHOOL_ID));
  } else {
    histBody.appendChild(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'Loading…' }));
    supabase.from('postings')
      .select('id, school_id, role, start_date, end_date, schools(name, city, region, country)')
      .eq('profile_id', id)
      .then(({ data, error }) => {
        if (error || !document.body.contains(histBody)) {
          histBody.innerHTML = '';
          histBody.appendChild(el('p.muted', { style: 'font-size:12.5px;margin:0;', text: 'No postings listed.' }));
          return;
        }
        drawHistory(
          (data || []).map((r) => ({
            SCHOOL_ID: String(r.school_id), POSITION_TITLE: r.role,
            START_DATE: r.start_date, END_DATE: r.end_date, _s: r.schools,
          })),
          (p) => (p._s ? {
            SCHOOL_NAME: p._s.name, CITY: p._s.city || '',
            REGION: p._s.region || '', COUNTRY: p._s.country,
          } : null),
        );
      });
  }

  // Writing to someone belongs here too: you are already looking at them, and
  // this is the moment Linda described — "if I saw we were connected but I had
  // lost touch with you, I'd want to be able to connect".
  if (id !== me && !t.IS_GHOST) {
    const write = el('button.btn.accent', {
      type: 'button', text: `Message ${(t.FIRST_NAME || '').split(' ')[0] || 'them'}`,
    });
    write.addEventListener('click', () => {
      closePersonCard();
      messageSomeone(ctx, id, t.FULL_NAME);
    });

    // Quietly decline this one person. A switch rather than a sentence, and
    // phrased POSITIVELY — "Accept messages" on or off, instead of asking someone
    // to parse "don't accept messages from them" before they can act on it.
    // They are never told either way, which is why the only way back is here or
    // the list in Your details.
    const sw = el('button.switch', {
      type: 'button', role: 'switch', 'aria-checked': 'true', disabled: 'disabled',
      'aria-label': `Accept messages from ${t.FIRST_NAME || 'them'}`,
    }, [el('span.knob')]);
    const swText = el('span.switch-label', { text: 'Accept messages' });
    const paint = (accepting) => {
      sw.setAttribute('aria-checked', accepting ? 'true' : 'false');
      sw.classList.toggle('on', accepting);
      swText.textContent = accepting
        ? `Accepting messages from ${t.FIRST_NAME || 'them'}`
        : `Not accepting messages from ${t.FIRST_NAME || 'them'}`;
      sw.disabled = false;
    };
    supabase.from('message_blocks').select('blocked_id').eq('blocked_id', id).maybeSingle()
      .then(({ data }) => paint(!data), () => paint(true));

    sw.addEventListener('click', async () => {
      const accepting = sw.getAttribute('aria-checked') === 'true';
      sw.disabled = true;
      paint(!accepting);                       // move now; the write is quick
      sw.disabled = true;
      let failed = false;
      if (accepting) {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('message_blocks')
          .insert({ owner_id: user.id, blocked_id: id });
        failed = !!error;
      } else {
        const { error } = await supabase.from('message_blocks').delete().eq('blocked_id', id);
        failed = !!error;
      }
      // Put it back if the database refused, rather than showing a state that is
      // not true — this one decides whether somebody can reach you.
      paint(failed ? accepting : !accepting);
    });

    card.appendChild(el('div.msg-actions', {}, [
      write,
      el('span.switch-row', {}, [sw, swText]),
    ]));
  }

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
