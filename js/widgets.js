// widgets.js — tiny shared DOM helpers (no framework).

// el('div.foo#bar', {attr}, [children|string])
export function el(spec, attrs = {}, children = []) {
  const m = spec.match(/^([a-z0-9]+)?/i);
  const tag = (m && m[1]) || 'div';
  const node = document.createElement(tag);
  const idm = spec.match(/#([\w-]+)/);
  if (idm) node.id = idm[1];
  const classes = [...spec.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// Search-as-you-type teacher picker. Calls onPick(teacherId) on selection.
export function teacherTypeahead(teachers, idx, onPick, { placeholder = 'Search a teacher…', value = '' } = {}) {
  const wrap = el('div.typeahead');
  const input = el('input', { type: 'search', placeholder, autocomplete: 'off' });
  if (value) {
    const t = idx.teacherById.get(value);
    if (t) input.value = t.FULL_NAME;
  }
  const results = el('div.results');
  results.style.display = 'none';
  wrap.append(input, results);

  let hl = -1, matches = [];
  const close = () => { results.style.display = 'none'; hl = -1; };

  function render() {
    const q = input.value.trim().toLowerCase();
    matches = !q ? teachers.slice(0, 30) : teachers.filter((t) =>
      t.FULL_NAME.toLowerCase().includes(q) ||
      (t.SPECIALIZATION || '').toLowerCase().includes(q) ||
      (t.NATIONALITY || '').toLowerCase().includes(q)
    ).slice(0, 30);
    results.innerHTML = '';
    matches.forEach((t, i) => {
      const row = el('div', { html: `${t.FULL_NAME} <small>· ${t.SPECIALIZATION} · ${t.TEACHER_ID}</small>` });
      if (i === hl) row.classList.add('hl');
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(t); });
      results.appendChild(row);
    });
    results.style.display = matches.length ? 'block' : 'none';
  }
  function pick(t) { input.value = t.FULL_NAME; close(); onPick(t.TEACHER_ID); }

  input.addEventListener('focus', render);
  input.addEventListener('input', () => { hl = -1; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, matches.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[hl]) { pick(matches[hl]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return wrap;
}
