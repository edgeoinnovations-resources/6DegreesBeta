// View 2 — "Who knows whom".
//
// WHY THIS SHAPE (beta feedback, Jun–Sep 2026):
//
//   Dave: "I really like the 'reverse recruiting' section, but not the name. That's the
//   sort of feature I'd use more than the graphically based ones — who's 'related' to
//   someone I know. That's always the question you ask someone: 'Do you know…?'"
//
//   Linda (day one): "I'm looking at X school — who do I know or who do they know that
//   has been there?"   Dee (day one): "I'm looking at hiring X. Who do I know that's
//   worked with them?"   Dee (Sept): "if I meet someone at a conference … 'look, we were
//   both here!' or 'oh, we both know…'"
//
// Every stated version of the question is anchored on a PERSON or a SCHOOL. Nobody ever
// asked to filter by subject taught — and the one person who raised subjects (Melissa)
// said they "don't have to be searchable". So the old subject/countries "reverse
// recruiting" query builder is gone, and its job is done by the two modes below:
//
//   1. At a school   — everyone who has been there, and the chain of people who
//                      know each other that leads from you to each of them.
//   2. With a person — the chain between you, plus who you both know.
//   3. Find people   — plain faceted list (place / role / experience).
//
// FUTURE — natural-language search. Deliberately not built, and no longer given a tab.
// The plan, for whenever it earns its place: the browser NEVER holds an API key. Client
// POSTs the question to a Supabase Edge Function; that function (key stored as a Supabase
// secret) asks the Anthropic API to turn the question into a STRUCTURED filter (country,
// max_degree, anchor, …); the function runs that filter against Postgres and returns
// rows, which render exactly like the faceted table. The model only ever emits a query
// spec — never data, never a key in the client.
import { el, append, teacherTypeahead, schoolTypeahead } from '../widgets.js';
import { messageSomeone } from '../messages.js';
import { openPersonCard } from '../personCard.js';
import {
  bfsPath, strengthPath, degreeColor, degreeLabel, degreeShort,
  teacherName, roleCategory, rolesOf, ROLE_CATEGORIES, confirmBadge, hasAcknowledged,
  currentPosting, degreeChip, pathsFrom } from '../degrees.js';

export const view = {
  id: 'search', num: 2, title: 'Who knows whom',
  render(root, ctx) {
    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Who knows whom' }),
      el('p', { html: 'The two questions people actually ask: <em>“I’m looking at that school — who do I know there, or who could introduce me?”</em> and <em>“I just met this person — what do we have in common?”</em>' }),
    ]));

    // Sub-tabs.
    const sub = el('div.checkrow', { style: 'margin-bottom:14px;' });
    // Dee, 21 Sep 2026: "Could we have the 'with a person' first (or as the
    // default)? I think that will be how most people search first." She is
    // right, and the school tab was opening on AB Paterson College in
    // Australia — the alphabetically first school in the catalogue — which
    // told her nothing about anybody she knows.
    const sections = [
      ['person', 'With a person'],
      ['school', 'At a school'],
      ['find', 'Find people'],
    ];
    const panes = {};
    const tabs = new Map();
    const select = (id) => {
      Object.entries(panes).forEach(([k, p]) => (p.style.display = k === id ? 'block' : 'none'));
      tabs.forEach((b, k) => b.classList.toggle('sel', k === id));
    };
    sections.forEach(([id, label]) => {
      const btn = el('label', { text: label, style: 'cursor:pointer;' });
      btn.addEventListener('click', () => select(id));
      sub.appendChild(btn);
      tabs.set(id, btn);
    });
    root.appendChild(sub);

    panes.school = whoDoIKnowAt(ctx); root.appendChild(panes.school);
    panes.person = withAPerson(ctx); root.appendChild(panes.person);
    panes.find = findPeople(ctx); root.appendChild(panes.find);

    // Honour a deep-linked sub-tab (?tab=school), else open on the person
    // question — the one Dee says people reach for first.
    const wanted = sections.some(([id]) => id === ctx.state.params.tab) ? ctx.state.params.tab : 'person';
    select(wanted);
  },
};

// Best (lowest-degree) direct edge from `from` to every neighbour.
function bestEdges(adj, from) {
  const best = new Map();
  for (const e of adj.get(from) || []) {
    if (!best.has(e.other) || e.degree < best.get(e.other).degree) best.set(e.other, e);
  }
  return best;
}

// `deg ${d}` with no degree read "deg null" on Dee's screen. An inner-circle
// connection has no number because it has no place or time behind it.
const degPill = (d) => `<span class="pill" style="background:${degreeColor(d)};color:#fff;">${d ? `deg ${d}` : 'inner circle'}</span>`;

// ── 1. At a school — everyone who was there, and who can get you to them ────
//
// Paul, 18 Oct 2026: "a teacher can identify a school and then run an analysis
// that shows who knows who, that was at that school. It would show the link
// between people and the schools so the teacher could reach out to someone in
// that chain to ask questions."
//
// The first version listed only the people at the school you were DIRECTLY
// linked to, and sent you to the other tab for anyone else. But the person you
// want to ask about a school is usually somebody you have never met — the whole
// point is finding out who can introduce you. So this now takes everyone who was
// ever at the school and works out, for each of them, the chain of people who
// know each other that runs from you to them, with the school (or city, or
// country) behind every hop, and says in words who to ask first.
//
// "Know each other" is the dial. A degree-5 link ("we were both in Spain once")
// connects almost everybody and introduces nobody, so by default a hop has to be
// the same school (degree 1 or 2) or a confirmed inner-circle connection. Widen
// it when a chain comes up empty.
function whoDoIKnowAt(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  pane.appendChild(el('p.muted', {
    style: 'margin:4px 2px 12px;',
    text: 'Pick a school you’re curious about. Everyone in the community who has been there is listed, '
        + 'with the chain of people who know each other that leads from you to them — and who to ask first.',
  }));

  // Open on a school of YOUR OWN — the one you are at now, or the last you were
  // at — unless the link you followed named one. (Dee's screen once opened on
  // "AB Paterson College · Australia", the first school alphabetically.)
  const mine = (idx.postingsByTeacher.get(ctx.me) || []).slice()
    .sort((a, b) => String(b.START_DATE || '').localeCompare(String(a.START_DATE || '')));
  const mineCurrent = mine.find((x) => !x.END_DATE) || mine[0];
  let sid = mineCurrent ? mineCurrent.SCHOOL_ID : null;
  if (ctx.state.params.school && idx.schoolById.has(String(ctx.state.params.school))) {
    sid = String(ctx.state.params.school);
  }

  // YOU ARE YOU — see the note that used to sit here: the group rejected
  // "search as Paul" on 12 Sep 2026, and the only place to look at someone
  // else's connections is the Connections page, which is loud about it.
  const fromBox = el('div.control-group', {}, [
    el('label', { text: 'You are' }),
    el('span.you-chip', { text: 'You' }),
  ]);

  // Only schools somebody has actually been at are offered. A school with no
  // member behind it can only ever answer "nobody", and the list the browser
  // holds is exactly those schools.
  const schoolBox = el('div.control-group', {}, [el('label', { text: 'At school' })]);
  schoolBox.appendChild(schoolTypeahead(data.schools, (id) => { sid = id; run(); }, {
    value: sid, placeholder: 'School, city or country…',
  }));

  // What a hop in the chain has to be before it counts as two people knowing
  // each other. Plain words rather than "≤ degree 2", for the people Paul says
  // need reminding what they are looking at.
  let md = 2;
  const linkSel = el('select', {}, [
    el('option', { value: 1, text: 'Same school, same time' }),
    el('option', { value: 2, text: 'Same school, any time', selected: 'selected' }),
    el('option', { value: 3, text: 'Same city, same time' }),
    el('option', { value: 4, text: 'Same city, any time' }),
    el('option', { value: 5, text: 'Same country, same time' }),
    el('option', { value: 6, text: 'Same country, any time' }),
  ]);
  linkSel.title = 'A confirmed inner-circle connection always counts, whatever is chosen here.';
  linkSel.addEventListener('change', () => { md = +linkSel.value; run(); });

  let mode = 'hops';
  const modeSel = el('select', {}, [
    el('option', { value: 'hops', text: 'Fewest people in between' }),
    el('option', { value: 'strength', text: 'Strongest links' }),
  ]);
  modeSel.addEventListener('change', () => { mode = modeSel.value; run(); });

  const controls = el('div.controls');
  controls.append(fromBox, schoolBox,
    el('div.control-group', {}, [el('label', { text: 'Two people know each other if' }), linkSel]),
    el('div.control-group', {}, [el('label', { text: 'Route' }), modeSel]),
    el('button.btn', { text: 'Find', onclick: run }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);

  const isGhost = (id) => !!(idx.teacherById.get(id) || {}).IS_GHOST;
  const firstNameOf = (id) => {
    const t = idx.teacherById.get(id) || {};
    return (t.FIRST_NAME || t.FULL_NAME || '').split(' ')[0] || 'them';
  };

  function run() {
    out.innerHTML = '';
    if (!sid) {
      out.appendChild(el('div.card', { text: 'Start typing the name of a school above — or a city or country, if the name escapes you.' }));
      return;
    }
    const s = idx.schoolById.get(sid) || {};
    const everyone = [...(idx.teachersBySchool.get(sid) || new Set())].filter((p) => p !== ctx.me);

    // One search from you reaches everybody; each person at the school then
    // reads their own way back.
    const routes = pathsFrom(adj, ctx.me, {
      allowEdge: (e) => e.acknowledged || (e.degree != null && e.degree <= md),
      allowThrough: (id) => !isGhost(id),
      weighted: mode === 'strength',
    });

    const rows = everyone.map((id) => {
      const chain = routes.pathTo(id);
      const st = stintAt(idx, id, sid);
      return {
        id, chain, ...st,
        between: chain ? chain.length - 2 : null,
        cost: chain ? chain.slice(1).reduce((n, step) => n + (step.edge.degree || 1), 0) : Infinity,
      };
    });
    // Closest first; among equals, whoever is there NOW, then the strongest
    // chain, then whoever was there most recently.
    rows.sort((a, b) => ((a.between ?? 99) - (b.between ?? 99))
      || (Number(b.now) - Number(a.now))
      || (a.cost - b.cost)
      || String(b.latest || '').localeCompare(String(a.latest || '')));

    const reachable = rows.filter((r) => r.chain);
    const myStints = mine.filter((p) => p.SCHOOL_ID === sid);
    const n = everyone.length;
    out.appendChild(el('p.muted', {
      style: 'margin:8px 2px;',
      html: `<strong>${n}</strong> ${n === 1 ? 'person' : 'people'} in the community ${n === 1 ? 'has' : 'have'} been at `
        + `<strong>${s.SCHOOL_NAME || sid}</strong>${myStints.length ? ` — and so have you (${yearsOf(myStints)})` : ''}. `
        + (n ? `You can reach <strong>${reachable.length}</strong> of them through people who know each other.` : ''),
    }));

    if (!n) {
      out.appendChild(el('div.card', { html: `Nobody else in the community has been at <strong>${s.SCHOOL_NAME || 'that school'}</strong> yet. If you know somebody who has, invite them — it is the only way this list grows.` }));
      return;
    }

    // ── You know them directly: a table, with the link that makes it so ──
    const direct = rows.filter((r) => r.between === 0);
    if (direct.length) {
      const card = el('div.card', { style: 'margin-top:10px;' });
      card.appendChild(el('h4', { text: `You know them directly (${direct.length})` }));
      const table = el('table.data');
      table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'When they were there', 'Role there', 'How you know them', ''].map((h) => el('th', { text: h })))]));
      const tb = el('tbody');
      direct.forEach((r) => {
        const t = idx.teacherById.get(r.id) || {};
        const e = r.chain[1].edge;
        tb.appendChild(el('tr', {}, [
          el('td', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}${r.now ? ' <span class="pill">there now</span>' : ''}` }),
          el('td', { text: r.years || '—' }),
          el('td', { text: r.roles || '—' }),
          el('td', { html: `${degPill(e.degree)} ${e.label || ''}<br><small class="muted">${degreeLabel(e.degree)}${e.overlap ? ` · ${e.overlap}` : ''}</small>` }),
          el('td', { style: 'white-space:nowrap;' }, [
            el('button.btn.ghost', { text: 'open →', onclick: () => openPersonCard(ctx, r.id) }),
            ' ',
            messageButton(r.id, t),
          ]),
        ]));
      });
      table.appendChild(tb);
      card.appendChild(table);
      out.appendChild(card);
    }

    // ── Somebody in between: one chain per person, and who to ask ─────────
    const bands = [
      [1, 'One person in between'],
      [2, 'Two people in between'],
      [3, 'Three or more people in between'],
    ];
    bands.forEach(([k, title]) => {
      const list = rows.filter((r) => r.chain && (k < 3 ? r.between === k : r.between >= 3));
      if (!list.length) return;
      out.appendChild(el('h4', { style: 'margin:18px 2px 6px;', text: `${title} (${list.length})` }));
      list.forEach((r) => {
        const t = idx.teacherById.get(r.id) || {};
        const card = el('div.card', { style: 'margin-top:8px;' });
        card.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;' }, [
          el('div', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)} <small class="muted">· ${r.roles ? `${r.roles} at` : 'at'} ${s.SCHOOL_NAME || ''} ${r.years || ''}</small>${r.now ? ' <span class="pill">there now</span>' : ''}` }),
          el('button.btn.ghost', { text: 'open →', onclick: () => openPersonCard(ctx, r.id) }),
        ]));
        // The last node is the person at the school: say so under their name,
        // where the chain otherwise lists roles.
        card.appendChild(renderChain(r.chain, idx, ctx, (id, i) => (
          i === r.chain.length - 1 ? `at ${s.SCHOOL_NAME || 'this school'} ${r.years || ''}`.trim() : rolesOf(idx, id).join(', ')
        )));
        card.appendChild(askLine(r.chain));
        out.appendChild(card);
      });
    });

    // ── Nobody can introduce you, with links this strong ─────────────────
    const none = rows.filter((r) => !r.chain);
    if (none.length) {
      const card = el('div.card', { style: 'margin-top:18px;' });
      card.appendChild(el('h4', { text: none.length === 1 ? 'No chain to this person yet' : `No chain to these ${none.length} people yet` }));
      card.appendChild(el('p.muted', {
        style: 'font-size:12.5px;margin:0 0 8px;',
        text: md < 6
          ? 'Nobody who knows you knows them — not through links this strong. Try a wider setting for “Two people know each other if”, or open them anyway: their card shows whatever you do share.'
          : 'Nobody who knows you knows them, even counting a shared country. You can still open their card and write to them directly.',
      }));
      const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;' });
      none.forEach((r) => {
        const t = idx.teacherById.get(r.id) || {};
        wrap.appendChild(el('button.btn.ghost', {
          html: `${t.FULL_NAME}${r.now ? ' · there now' : r.years ? ` · ${r.years}` : ''}`,
          title: `${t.FULL_NAME}: their history, and how to reach them`,
          onclick: () => openPersonCard(ctx, r.id),
        }));
      });
      card.appendChild(wrap);
      out.appendChild(card);
    }
  }

  // "Message Linda" — straight into a conversation. Not for somebody who has
  // left, and never for you.
  function messageButton(id, t) {
    if (id === ctx.me || !t || t.IS_GHOST) return null;
    return el('button.btn.ghost', {
      text: `Message ${firstNameOf(id)}`,
      title: `Write to ${t.FULL_NAME} inside 6 Degrees`,
      onclick: () => messageSomeone(ctx, id, t.FULL_NAME),
    });
  }

  // The chain in a sentence, ending in who to write to. Paul's brief was that the
  // teacher should be able to "reach out to someone in that chain to ask
  // questions" — this names that someone and says why they are the one.
  function askLine(chain) {
    const name = (i) => (chain[i].id === ctx.me ? 'you' : firstNameOf(chain[i].id));
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    const parts = [];
    for (let i = 1; i < chain.length; i++) {
      parts.push(`${cap(name(i - 1))} and ${name(i)} ${describeLink(chain[i].edge)}`);
    }
    const firstId = chain[1].id;
    const first = idx.teacherById.get(firstId) || {};
    const lead = chain.length === 3 ? `Ask ${firstNameOf(firstId)}.` : `Start with ${firstNameOf(firstId)}.`;
    const row = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:10px;' });
    row.appendChild(el('p.muted', {
      style: 'font-size:12.5px;margin:0;max-width:70ch;',
      html: `<strong>${lead}</strong> ${parts.join('; ')}.`,
    }));
    const btn = messageButton(firstId, first);
    if (btn) row.appendChild(btn);
    return row;
  }

  run();
  return pane;
}

// A link, said out loud: "were both at AES Delhi at the same time (2010–2012)".
function describeLink(e) {
  if (!e || !e.degree) return 'have confirmed knowing each other';
  const where = e.label || 'the same place';
  const at = e.degree <= 2 ? `at ${where}` : `in ${where}`;
  const sameTime = e.degree % 2 === 1;
  return sameTime
    ? `were both ${at} at the same time${e.overlap ? ` (${e.overlap})` : ''}`
    : `were both ${at}, at different times`;
}

// Somebody's time at one school: "2010–2014, 2018–present", whether they are
// still there, their role(s) there, and the latest date, for sorting.
function stintAt(idx, id, sid) {
  const ps = (idx.postingsByTeacher.get(id) || []).filter((p) => p.SCHOOL_ID === sid);
  const roles = [...new Set(ps.map((p) => roleCategory(p.POSITION_TITLE)))].join(', ');
  const latest = ps.reduce((m, p) => {
    const k = p.END_DATE ? String(p.END_DATE) : '9999';
    return k > m ? k : m;
  }, '');
  return { years: yearsOf(ps), now: ps.some((p) => !p.END_DATE), roles, latest };
}

function yearsOf(postings) {
  return postings.slice()
    .sort((a, b) => String(a.START_DATE).localeCompare(String(b.START_DATE)))
    .map((p) => `${String(p.START_DATE || '').slice(0, 4)}–${p.END_DATE ? String(p.END_DATE).slice(0, 4) : 'present'}`)
    .join(', ');
}

// ── 2. With a person — the chain, plus who you both know ────────────────────
function withAPerson(ctx) {
  const { data, idx, adj } = ctx;
  const pane = el('div');
  pane.appendChild(el('p.muted', { style: 'margin:4px 2px 12px;', text: 'You’ve just met someone, or you’re about to work with them. This shows how the two of you are linked and who you already know in common.' }));

  // You, fixed — see the note in whoDoIKnowAt(). "Them" is the part you choose.
  const A = ctx.me;
  // "Them" starts EMPTY.
  //
  // It used to default to a seed id from the demo data — 'B002', or 'T010' if
  // that was missing — neither of which exists in the real community, so the
  // tab opened on a person nobody could see. Yesterday I replaced that with
  // "your strongest connection", and Dee's screen this morning read
  // "Them: Paul Strootman" — she took it for a preset, and she was right to:
  // it is a question about somebody you have just met, and the app cannot know
  // who that is. Worse, the sort compared a null degree and put whichever
  // inner-circle connection existed at the top.
  let B = ctx.state.params.other || null;
  let mode = 'hops';

  const aBox = el('div.control-group', {}, [
    el('label', { text: 'You are' }),
    el('span.you-chip', { text: 'You' }),
  ]);
  const bBox = el('div.control-group', {}, [el('label', { text: 'Them' })]);
  bBox.appendChild(teacherTypeahead(data.teachers, idx, (id) => { B = id; draw(); }, { value: B }));

  const modeSel = el('select', {}, [
    el('option', { value: 'hops', text: 'Fewest people in between' }),
    el('option', { value: 'strength', text: 'Strongest links' }),
  ]);
  modeSel.addEventListener('change', () => { mode = modeSel.value; draw(); });

  const controls = el('div.controls');
  controls.append(aBox, bBox,
    el('div.control-group', {}, [el('label', { text: 'Route' }), modeSel]),
    el('button.btn', { text: 'Show', onclick: draw }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);

  function draw() {
    out.innerHTML = '';
    if (!B) {
      out.appendChild(el('div.card', {
        text: 'Start typing a name in “Them” — you will see how the two of you are '
            + 'linked, and who you already know in common.',
      }));
      return;
    }
    if (A === B) {
      // Now that one side is always you, "pick two different people" was
      // telling somebody off for an instruction they were never given.
      out.appendChild(el('div.card', { text: 'That one is you — pick somebody else.' }));
      return;
    }

    // (a) Any direct link — "look, we were both here!"
    const direct = (adj.get(A) || []).filter((e) => e.other === B).sort((x, y) => x.degree - y.degree);
    if (direct.length) {
      const list = el('ul');
      direct.forEach((e) => list.appendChild(el('li', {
        html: `${degPill(e.degree)} <strong>${e.label || ''}</strong> — ${degreeShort(e.degree)}${e.overlap ? ` · ${e.overlap}` : ''}${e.verified === 'mutual' ? ' <span class="badge-mutual">mutual ✓</span>' : ''}`,
      })));
      const card = el('div.card');
      card.append(el('h4', { text: 'You overlapped directly' }), list);
      out.appendChild(card);
    }

    // (b) The chain.
    const chain = (mode === 'hops' ? bfsPath : strengthPath)(adj, A, B);
    const chainCard = el('div.card');
    chainCard.appendChild(el('h4', { text: 'How you’re linked' }));
    if (!chain) {
      chainCard.appendChild(el('p.muted', { text: 'No route between these two people in the current graph.' }));
    } else {
      chainCard.appendChild(el('p.muted', {
        style: 'margin:0 0 10px;',
        html: `<strong>${chain.length - 2 <= 0 ? 'Direct' : `${chain.length - 2} person(s) in between`}</strong> · ${chain.length - 1} hop(s) · ${mode === 'hops' ? 'fewest people in between' : 'strongest links'}`,
      }));
      chainCard.appendChild(renderChain(chain, idx, ctx));
    }
    out.appendChild(chainCard);

    // (c) Mutual connections — "oh, we both know…"
    const bestA = bestEdges(adj, A), bestB = bestEdges(adj, B);
    const mutual = [...bestA.keys()]
      // Exclude BOTH ends. It excluded only "them", so whenever the two of you
      // were connected to each other you turned up in your own list of people
      // you both know — which is how Paul's name survived on this page even
      // after the "You are" box stopped carrying it.
      .filter((id) => id !== B && id !== A && bestB.has(id))
      .map((id) => ({ id, ea: bestA.get(id), eb: bestB.get(id) }))
      .sort((x, y) => (x.ea.degree + x.eb.degree) - (y.ea.degree + y.eb.degree));

    const mutualCard = el('div.card');
    mutualCard.appendChild(el('h4', { text: `People you both know (${mutual.length})` }));
    if (!mutual.length) {
      mutualCard.appendChild(el('p.muted', { text: 'Nobody in common yet.' }));
    } else {
      const table = el('table.data');
      table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Role', 'Link to you', `Link to ${teacherName(idx, B).split(' ')[0]}`, ''].map((h) => el('th', { text: h })))]));
      const tb = el('tbody');
      mutual.slice(0, 100).forEach((m) => {
        const t = idx.teacherById.get(m.id) || {};
        tb.appendChild(el('tr', {}, [
          el('td', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}` }),
          el('td', { text: rolesOf(idx, m.id).join(', ') }),
          el('td', { html: `${degPill(m.ea.degree)}<br><small class="muted">${m.ea.label || ''}</small>` }),
          el('td', { html: `${degPill(m.eb.degree)}<br><small class="muted">${m.eb.label || ''}</small>` }),
          el('td', {}, [el('button.btn.ghost', { text: 'open →', onclick: () => openPersonCard(ctx, m.id) })]),
        ]));
      });
      table.appendChild(tb);
      mutualCard.appendChild(table);
    }
    out.appendChild(mutualCard);
  }
  draw();
  return pane;
}

// metaFor(id, i) overrides the small line under a name; the school tab uses it
// to say "at <school> 2010–2014" under the person the chain leads to.
function renderChain(chain, idx, ctx, metaFor = null) {
  const wrap = el('div.path-chain');
  chain.forEach((step, i) => {
    if (i > 0) {
      const e = step.edge;
      wrap.appendChild(el('div.path-hop', {}, [
        el('span.arrow', { text: '→' }),
        el('span.deg-pill', { style: `background:${degreeColor(e.degree)}`, text: degreeChip(e.degree) }),
        el('span.ctx', { html: `${degreeShort(e.degree)}<br>${e.label || ''}${e.overlap ? ` · ${e.overlap}` : ''}${e.verified === 'mutual' ? ' ✓' : ''}` }),
      ]));
    }
    const t = idx.teacherById.get(step.id) || {};
    const endpoint = i === 0 || i === chain.length - 1;
    const node = el(`div.path-node${endpoint ? '.endpoint' : ''}`, { style: 'cursor:pointer;' }, [
      // One end of every route is you, and reading your own name back at
      // yourself is the thing Paul asked to be rid of on this page.
      el('div.nm', { text: step.id === ctx.me ? 'You' : (t.FULL_NAME || step.id) }),
      el('div.meta', { text: metaFor ? metaFor(step.id, i) : rolesOf(idx, step.id).join(', ') }),
    ]);
    // Was: navigate to the ego page with a teacher parameter, which that page
    // stopped reading this morning — so it silently showed you your own graph.
    node.addEventListener('click', () => openPersonCard(ctx, step.id));
    wrap.appendChild(node);
  });
  return wrap;
}

// ── 3. Find people — plain faceted list ─────────────────────────────────────
// Facets are place, role category and experience. No subject, no job title: see the
// header note. No curriculum either — Paul, 18 Oct 2026: "We're not collecting
// curriculum data anymore." The schools table never had the column; the filter
// was a leftover of the demo data and could only ever offer "Any curriculum".
function findPeople(ctx) {
  const { data, idx, counts } = ctx;
  const pane = el('div');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const countries = uniq(data.schools.map((s) => s.COUNTRY));
  const cities = uniq(data.schools.map((s) => s.CITY));

  const sel = (label, options) => {
    const s = el('select', {}, [el('option', { value: '', text: `Any ${label}` }), ...options.map((o) => el('option', { value: o, text: o }))]);
    return el('div.control-group', {}, [el('label', { text: label }), s]);
  };
  const fCountry = sel('country', countries), fCity = sel('city', cities),
    fRole = sel('role', ROLE_CATEGORIES);
  const minYears = el('input', { type: 'number', min: 0, max: 40, value: 0, style: 'width:64px;' });
  const verifiedOnly = el('input', { type: 'checkbox' });
  const ackAvailable = hasAcknowledged(data);

  const controls = el('div.controls');
  append(controls, fCountry, fCity, fRole,
    el('div.control-group', {}, [el('label', { text: 'Min years' }), minYears]),
    ackAvailable ? el('div.control-group', {}, [el('label', {}, [verifiedOnly, ' verified (mutual) only'])]) : null,
    el('button.btn', { text: 'Search', onclick: run }));
  pane.appendChild(controls);

  const out = el('div'); pane.appendChild(out);
  const val = (group) => group.querySelector('select').value;

  function run() {
    const c = val(fCountry), city = val(fCity), role = val(fRole);
    const minY = +minYears.value || 0;
    const vOnly = ackAvailable && verifiedOnly.checked;

    const mutualSet = vOnly ? new Set(data.colleagueships.filter((x) => x.VERIFIED === 'mutual')
      .flatMap((x) => [x.TEACHER_A_ID, x.TEACHER_B_ID])) : null;

    const results = data.teachers.filter((t) => {
      // Not you. This is a list of people to find, and you are not lost.
      if (t.TEACHER_ID === ctx.me) return false;
      if ((t.YEARS_EXPERIENCE || 0) < minY) return false;
      if (vOnly && !mutualSet.has(t.TEACHER_ID)) return false;
      const postings = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
      const schoolsT = postings.map((p) => idx.schoolById.get(p.SCHOOL_ID)).filter(Boolean);
      if (c && !schoolsT.some((s) => s.COUNTRY === c)) return false;
      if (city && !schoolsT.some((s) => s.CITY === city)) return false;
      if (role && !postings.some((p) => roleCategory(p.POSITION_TITLE) === role)) return false;
      return true;
    });

    out.innerHTML = '';
    out.appendChild(el('p.muted', { style: 'margin:8px 2px;', text: `${results.length} person(s)` }));

    const table = el('table.data');
    table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Role', 'Yrs', 'Current school', 'Conns', ''].map((h) => el('th', { text: h })))]));
    const tb = el('tbody');
    results.slice(0, 200).forEach((t) => {
      const ps = idx.postingsByTeacher.get(t.TEACHER_ID) || [];
      const cur = currentPosting(ps);
      const sc = cur ? idx.schoolById.get(cur.SCHOOL_ID) : null;
      tb.appendChild(el('tr', {}, [
        el('td', { html: `<strong>${t.FULL_NAME}</strong>${confirmBadge(t)}` }),
        el('td', { text: rolesOf(idx, t.TEACHER_ID).join(', ') }),
        el('td', { text: String(t.YEARS_EXPERIENCE ?? '') }),
        el('td', { text: sc ? `${sc.SCHOOL_NAME}, ${sc.COUNTRY}` : '—' }),
        el('td', { text: String(counts.get(t.TEACHER_ID) || 0) }),
        // THE DOORWAY. Paul, 20 Sep 2026: "there are people that I know but we
        // don't share any degrees. How can I find them and add social
        // connections or professional connections if I know they are on 6
        // Degrees?"
        //
        // Everything needed already existed. The rules have never required a
        // shared degree to confirm a connection; the `connections` view LEFT
        // JOINs colleagueships, so an approved tag with no shared country still
        // produces a row; and the rings already keep ring 0 for exactly that
        // person — "the conference case — who has no degree and so has nowhere
        // else to live". The only missing piece was a way to REACH them: the
        // card opens from the rings, and somebody you share nothing with is by
        // definition not in your rings.
        //
        // This button used to say "connections →" and navigate to the ego page
        // with a teacher parameter that page stopped reading this morning. It
        // opens the person card instead, which carries their history, how you
        // are connected, "Your connection" to confirm you know each other, and
        // Message.
        el('td', {}, [el('button.btn.ghost', {
          text: 'open →',
          title: `${t.FULL_NAME}: their history, and confirm you know each other`,
          onclick: () => openPersonCard(ctx, t.TEACHER_ID),
        })]),
      ]));
    });
    table.appendChild(tb);
    out.appendChild(table);
  }
  run();
  return pane;
}
