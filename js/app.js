// app.js — loads data ONCE, builds shared context, runs the tab router, mounts views.
//
// NAV SHAPE (beta feedback, Sept 2026): three people independently said the eight
// equal-weight dashboards felt like "navigating consilience" (Sarah), that the analysis
// is interesting "but as a teacher user I'm not sure I care" (Linda), and that "the most
// simple ones will be the most popular" (Dee). So the nav is now:
//
//   PRIMARY  — the four views that answer a teacher's actual questions.
//   EXPLORE  — one nav entry leading to a landing screen; the four analytical views
//              live behind it. Nothing is deleted, only de-ranked.
import { loadData, loadMyGraph, invalidate } from './loadData.js';
import { requireSession, loadMyProfile, signOut } from './auth.js';
import { friendlyDbError, logError } from './supabaseClient.js';
import { BUILD } from './config.js';
import { connectionsIcon } from './connectionsInbox.js';
import { openInvitePanel } from './invites.js';
import { onboardingView } from './onboarding.js';
import {
  buildIndexes, buildAdjacency, connectionCounts, confirmBadge,
} from './degrees.js';
import { el } from './widgets.js';

import { view as egoView } from './views/egoGraph.js';
import { view as networkView } from './views/network.js';
import { view as matrixView } from './views/matrix.js';
import { view as chordView } from './views/chord.js';
import { view as mapView } from './views/map.js';
import { view as timelineView } from './views/timeline.js';
import { view as insightsView } from './views/insights.js';
import { view as searchView } from './views/search.js';

// Order here IS the nav order.
// Paul, 12 Sep 2026: "I'm thinking the Network graph is unnecessary." Dee agreed
// ("although it's super fun to play with lol!"). Demoted into Explore rather than
// deleted — at 1,200 people it was a hairball, but the work survives if wanted.
const PRIMARY = [egoView, searchView, mapView];
const EXPLORE = [matrixView, timelineView, chordView, insightsView, networkView];

// One-line "why you'd open this" for each Explore card.
const EXPLORE_BLURB = {
  matrix: 'Which two schools share the most people. Pick the schools on each axis yourself.',
  network: 'The whole community as one force-directed web. Fun to pull apart; hard to read.',
  timeline: 'Two careers side by side on one time axis — see exactly where they overlapped.',
  chord: 'Where teachers move next, aggregated into country-to-country flows.',
  insights: 'The community in aggregate: average separation, tenure by region, top corridors.',
};

// The Explore landing screen is itself a view, so the router treats it like any other.
const exploreView = {
  id: 'explore', num: 5, title: 'Explore',
  render(root, ctx) {
    root.appendChild(el('div.view-head', {}, [
      el('h2', { text: 'Explore the community' }),
      el('p', { html: 'The analytical views. These answer questions <em>about the community as a whole</em> rather than about you — useful, but not where most people will start.' }),
    ]));
    const grid = el('div.explore-grid');
    EXPLORE.forEach((v) => {
      const card = el('button.explore-card', { type: 'button' }, [
        el('div.ec-title', { text: v.title }),
        el('div.ec-blurb', { text: EXPLORE_BLURB[v.id] || '' }),
        el('span.ec-go', { text: 'Open →' }),
      ]);
      card.addEventListener('click', () => ctx.navigateTo(v.id));
      grid.appendChild(card);
    });
    root.appendChild(grid);
  },
};

// Editing your own history. The registration form already handled an existing
// profile, but nothing led back to it once you had joined — Linda registered, then
// realised she'd left out a school, and had no way in. Reached from your name in
// the header; not a nav tab, because it is about you, not about the community.
const meView = {
  id: 'me', num: '✎', title: 'Your details',
  render(root, ctx) {
    root.appendChild(onboardingView(ctx.user, ctx.profile, () => ctx.reload()));
  },
};

const NAV = [...PRIMARY, exploreView];
const ALL_VIEWS = [...PRIMARY, exploreView, ...EXPLORE, meView];

// ── Shared tooltip helper, handed to every view via ctx ─────────────────────
const tipEl = document.getElementById('tooltip');
const tooltip = {
  show(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
    tipEl.classList.add('show');
  },
  hide() { tipEl.classList.remove('show'); },
};

// ── Hash <-> {viewId, params} ───────────────────────────────────────────────
// Dave: "Is there a way to utilize the back button to the previous page? If you go from
// one section to another, any parameters you enter reset." So view + params now live in
// the URL, which makes Back/Forward work and makes any state shareable as a link.
function encodeHash(viewId, params) {
  const qs = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v != null && v !== '')
  ).toString();
  return `#${viewId}${qs ? `?${qs}` : ''}`;
}
function decodeHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  if (!raw) return { viewId: null, params: {} };
  const [viewId, qs] = raw.split('?');
  return { viewId, params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function boot() {
  const container = document.getElementById('view-container');

  // ── Gate ────────────────────────────────────────────────────────────────
  // Nothing renders without a session. ("Nothing. Redirect to sign-in.")
  await requireSession(container);

  // A session is not a profile. Someone signed in with no row in profiles has
  // not registered yet, and registering is the only thing they can do.
  let { user, profile } = await loadMyProfile();
  if (!profile) {
    container.innerHTML = '';
    container.appendChild(onboardingView(user, null, () => { invalidate(); location.reload(); }));
    document.getElementById('tab-nav').innerHTML = '';
    mountHeaderAccount(user, null);
    return;
  }

  let data;
  try {
    // Only your own neighbourhood. The whole network is fetched later, and only
    // by the views that genuinely need it — see needsFullGraph below.
    data = await loadMyGraph();
  } catch (err) {
    container.innerHTML = `<div class="view"><div class="error-box">
      ${friendlyDbError(err, 'load the community')}
    </div></div>`;
    return;
  }

  // Build shared analytical structures ONCE.
  const idx = buildIndexes(data);
  const adj = buildAdjacency(data.colleagueships);
  // With only your own neighbourhood loaded, node sizes cannot be counted from
  // the edges in hand — the database sends each person's real total with the
  // connection. Fall back to counting locally once the whole graph is present.
  const counts = data.counts || connectionCounts(adj);

  // Cross-view state: the focused teacher and a generic param bag.
  // Default to a real member of the beta group rather than a fictional teacher, so the
  // first thing anyone sees is someone they know. (Dee: "if I meet someone at a
  // conference … 'look, we were both here!'" — that only lands with real people in it.)
  // You are the centre of your own graph, always. (Dee, 12 Sep 2026: "Do we keep
  // it focused on 'me' ... it's always tied to the user who is logged in".)
  const state = { egoTeacher: user.id, me: user.id, profile, params: {} };

  const ctx = {
    data, idx, adj, counts, tooltip, state,
    me: user.id, user, profile,
    reload: async () => { invalidate(); location.reload(); },
    navigateTo(viewId, params = {}) { activate(viewId, params); },
  };

  mountHeaderAccount(user, profile, ctx);

  // Header ego readout.
  const headerEgo = document.getElementById('header-ego');
  const refreshHeader = () => {
    const t = idx.teacherById.get(state.egoTeacher);
    headerEgo.innerHTML = t
      ? `Focused on <strong>${t.FULL_NAME}</strong>${confirmBadge(t)}`
      : '';
  };
  ctx.refreshHeader = refreshHeader;

  // Build tab nav.
  const nav = document.getElementById('tab-nav');
  nav.innerHTML = '';
  let current = null;
  const buttons = new Map();

  // `push` is false when we're reacting to the hash changing (back/forward), so we
  // don't push a duplicate history entry for a navigation the browser just performed.
  function activate(viewId, params = {}, { push = true } = {}) {
    const v = ALL_VIEWS.find((x) => x.id === viewId) || PRIMARY[0];

    state.params = params;
    if (params.teacher) state.egoTeacher = params.teacher;

    const hash = encodeHash(v.id, params);
    if (push && location.hash !== hash) {
      history.pushState(null, '', hash);
    }

    if (current && current.teardown) { try { current.teardown(); } catch {} }

    // An Explore sub-view highlights the Explore nav entry, since that's where it lives.
    const navId = EXPLORE.some((x) => x.id === v.id) ? 'explore' : v.id;
    for (const [id, btn] of buttons) btn.classList.toggle('active', id === navId);

    container.innerHTML = '';
    const root = el('div.view');

    // Sub-views get a way back up to the Explore screen.
    if (EXPLORE.some((x) => x.id === v.id)) {
      const back = el('button.back-link', { type: 'button', text: '← All explore views' });
      back.addEventListener('click', () => activate('explore'));
      root.appendChild(back);
    }

    container.appendChild(root);
    refreshHeader();
    current = v;
    window.__6degView = v.id;   // tags logged errors with the screen they happened on
    try {
      if (NEEDS_EVERYONE.has(v.id)) {
        // Render after the data lands, so a view never draws an empty community
        // and then jumps.
        ensureFullGraph(root).then((ok) => {
          if (!ok || current !== v) return;
          try {
            v.render(root, ctx);
          } catch (err) {
            console.error(`[6deg] view "${v.id}" failed:`, err);
            logError({ action: `render ${v.id}`, code: err?.name || 'Error', message: err?.message || String(err), stack: err?.stack || '' });
            root.appendChild(el('div.error-box', { text: `Something went wrong showing ${v.title}. Reload the page, and if it keeps happening let Paul know.` }));
          }
        });
        return;
      }
      v.render(root, ctx);
    } catch (err) {
      console.error(`[6deg] view "${v.id}" failed:`, err);
      logError({ action: `render ${v.id}`, code: err?.name || 'Error', message: err?.message || String(err), stack: err?.stack || '' });
      root.appendChild(el('div.error-box', { text: `Something went wrong showing ${v.title}. Reload the page, and if it keeps happening let Paul know. Reference: ${err?.name || 'render'}.` }));
    }
  }
  // Views that genuinely need everyone. The three primary screens do not: the
  // rings are your own neighbourhood and the card is one pair. These analyse the
  // whole community, so they pay for the full download themselves — once.
  const NEEDS_EVERYONE = new Set(['map', 'search', 'matrix', 'timeline', 'chord', 'insights', 'network']);

  async function ensureFullGraph(root) {
    if (!ctx.data.partial) return true;
    const note = el('div.loading', { text: 'Loading the whole community…' });
    root.appendChild(note);
    try {
      const full = await loadData();
      ctx.data = full;
      ctx.idx = buildIndexes(full);
      ctx.adj = buildAdjacency(full.colleagueships);
      ctx.counts = connectionCounts(ctx.adj);
      note.remove();
      return true;
    } catch (err) {
      note.remove();
      logError({ action: 'load full graph', code: err?.code, message: err?.message });
      root.appendChild(el('div.error-box', { text: friendlyDbError(err, 'load the community') }));
      return false;
    }
  }

  ctx.activate = activate;

  // Numbered by POSITION, not by a field on the view.
  //
  // Each view carried its own hard-coded `num` from the eight-view layout, and when
  // Network moved out of the primary nav nobody renumbered Explore. The tabs read
  // 1, 2, 3, 5 on Paul's screen for a week. A number that describes where something
  // sits should be derived from where it sits.
  NAV.forEach((v, i) => {
    const btn = el('button.tab-btn', { type: 'button' }, [
      el('span.tab-num', { text: String(i + 1) }),
      el('span.tab-label', { text: v.title }),
    ]);
    btn.addEventListener('click', () => activate(v.id));
    nav.appendChild(btn);
    buttons.set(v.id, btn);
  });

  // Back/forward and hand-edited URLs.
  window.addEventListener('popstate', () => {
    const { viewId, params } = decodeHash(location.hash);
    activate(viewId || PRIMARY[0].id, params, { push: false });
  });

  const { viewId, params } = decodeHash(location.hash);
  activate(viewId || PRIMARY[0].id, params, { push: false });
}

boot();


// ── Header account controls ─────────────────────────────────────────────────
function mountHeaderAccount(user, profile, ctx) {
  const host = document.getElementById('header-account');
  if (!host) return;
  host.innerHTML = '';

  // Paul, 13 Sep 2026: a small icon at the top that says "Connections" on hover,
  // opening a window to validate and edit them.
  if (ctx) host.appendChild(connectionsIcon(ctx));

  // Your name opens a menu. Paul, 13 Sep 2026: "I want the user to be able to
  // click their name at the top and then a drop down menu to emerge where they can
  // edit their details" — rather than an "Edit details" label sitting on the page.
  const label = profile ? profile.display_name : (user.email || 'Account');
  const wrap = el('div.acct-menu-wrap');
  const trigger = el('button.acct-trigger', {
    type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, [el('span', { text: label }), el('span.acct-caret', { text: '▾', 'aria-hidden': 'true' })]);

  const menu = el('div.acct-menu', { role: 'menu' });
  menu.hidden = true;

  const item = (text, onClick) => {
    const b = el('button.acct-item', { type: 'button', role: 'menuitem', text });
    b.addEventListener('click', () => { close(); onClick(); });
    return b;
  };
  if (profile && ctx) menu.appendChild(item('Your details', () => ctx.navigateTo('me')));
  // Growth is the bottleneck, not features: eight views and seven people. Putting
  // this in the menu means nobody has to ask Paul to run SQL again.
  if (profile && ctx) menu.appendChild(item('Invite someone', () => openInvitePanel(ctx)));
  menu.appendChild(item('About 6 Degrees', () => { window.location.href = './about.html'; }));
  menu.appendChild(item('Sign out', signOut));
  // The build stamp is for diagnosing "did the fix reach you?" — useful, but not
  // something that belongs on the main screen.
  menu.appendChild(el('div.acct-build', { text: BUILD, title: 'Which version of the app you are running' }));

  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); trigger.focus(); } };
  function open() {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    const first = menu.querySelector('.acct-item');
    if (first) first.focus();
  }
  function close() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  }
  trigger.addEventListener('click', () => (menu.hidden ? open() : close()));

  wrap.append(trigger, menu);
  host.appendChild(wrap);
}
