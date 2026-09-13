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
import { loadData, invalidate } from './loadData.js';
import { requireSession, loadMyProfile, signOut } from './auth.js';
import { BUILD } from './config.js';
import { connectionsIcon } from './connectionsInbox.js';
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
    data = await loadData();
  } catch (err) {
    container.innerHTML = `<div class="view"><div class="error-box">
      Could not load your data from Supabase.<br>${err.message}<br><br>
      If this says <code>permission denied</code>, your sign-in may have expired —
      try signing out and back in.
    </div></div>`;
    return;
  }

  // Build shared analytical structures ONCE.
  const idx = buildIndexes(data);
  const adj = buildAdjacency(data.colleagueships);
  const counts = connectionCounts(adj);

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
    try {
      v.render(root, ctx);
    } catch (err) {
      console.error(`[6deg] view "${v.id}" failed:`, err);
      root.appendChild(el('div.error-box', { html: `View <b>${v.title}</b> failed to render: ${err.message}` }));
    }
  }
  ctx.activate = activate;

  NAV.forEach((v) => {
    const btn = el('button.tab-btn', { type: 'button' }, [
      el('span.tab-num', { text: String(v.num) }),
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

  // Your name is the way into your own details.
  const who = profile && ctx
    ? el('button.acct-who.acct-edit', {
        type: 'button', title: 'Edit your details and postings',
        text: `${profile.display_name} · Edit details`,
      })
    : el('span.acct-who', { text: profile ? profile.display_name : (user.email || '') });
  if (profile && ctx) who.addEventListener('click', () => ctx.navigateTo('me'));
  const build = el('span.acct-build', { text: BUILD, title: 'Which version of the app you are running' });
  const out = el('button.acct-btn', { type: 'button', text: 'Sign out', title: 'Sign out' });
  out.addEventListener('click', signOut);
  host.append(build, who, out);
}
