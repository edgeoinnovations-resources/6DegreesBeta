// app.js — loads data ONCE, builds shared context, runs the tab router, mounts views.
import { loadData } from './loadData.js';
import {
  buildIndexes, buildAdjacency, connectionCounts,
} from './degrees.js';

import { view as egoView } from './views/egoGraph.js';
import { view as networkView } from './views/network.js';
import { view as matrixView } from './views/matrix.js';
import { view as chordView } from './views/chord.js';
import { view as mapView } from './views/map.js';
import { view as timelineView } from './views/timeline.js';
import { view as insightsView } from './views/insights.js';
import { view as searchView } from './views/search.js';

const VIEWS = [egoView, networkView, matrixView, chordView, mapView, timelineView, insightsView, searchView];

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

async function boot() {
  const container = document.getElementById('view-container');
  let data;
  try {
    data = await loadData();
  } catch (err) {
    container.innerHTML = `<div class="view"><div class="error-box">
      Could not load <code>./data/demo_data.json</code>.<br>${err.message}<br><br>
      If you opened <code>index.html</code> directly, serve it instead:
      <code>python3 -m http.server</code> then open <code>http://localhost:8000/</code>.
    </div></div>`;
    return;
  }

  // Build shared analytical structures ONCE.
  const idx = buildIndexes(data);
  const adj = buildAdjacency(data.colleagueships);
  const counts = connectionCounts(adj);

  // Cross-view state: the focused teacher (default hero T001) and a generic param bag.
  const state = { egoTeacher: 'T001', params: {} };

  const ctx = {
    data, idx, adj, counts, tooltip, state,
    navigateTo(viewId, params = {}) {
      state.params = params;
      if (params.teacher) state.egoTeacher = params.teacher;
      activate(viewId);
    },
  };

  // Header ego readout.
  const headerEgo = document.getElementById('header-ego');
  const refreshHeader = () => {
    const t = idx.teacherById.get(state.egoTeacher);
    headerEgo.innerHTML = t
      ? `Focused on <strong>${t.FULL_NAME}</strong> · ${t.SPECIALIZATION}`
      : '';
  };
  ctx.refreshHeader = refreshHeader;

  // Build tab nav.
  const nav = document.getElementById('tab-nav');
  nav.innerHTML = '';
  let current = null;
  const buttons = new Map();

  function activate(viewId) {
    const v = VIEWS.find((x) => x.id === viewId) || VIEWS[0];
    if (current && current.teardown) { try { current.teardown(); } catch {} }
    for (const [id, btn] of buttons) btn.classList.toggle('active', id === v.id);
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'view';
    container.appendChild(root);
    refreshHeader();
    current = v;
    try {
      v.render(root, ctx);
    } catch (err) {
      console.error(`[6deg] view "${v.id}" failed:`, err);
      root.innerHTML = `<div class="error-box">View <b>${v.title}</b> failed to render: ${err.message}</div>`;
    }
  }
  ctx.activate = activate;

  VIEWS.forEach((v) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.innerHTML = `<span class="tab-num">${v.num}</span><span class="tab-label">${v.title}</span>`;
    btn.addEventListener('click', () => activate(v.id));
    nav.appendChild(btn);
    buttons.set(v.id, btn);
  });

  // Deep-link support via hash (#network etc.).
  const initial = VIEWS.find((v) => v.id === location.hash.slice(1));
  activate(initial ? initial.id : VIEWS[0].id);
}

boot();
