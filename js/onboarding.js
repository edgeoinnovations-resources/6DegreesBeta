// onboarding.js — registering yourself, and editing your own history later.
//
// This is where the first REAL data in the project comes from, so it is
// deliberately careful: it shows exactly what will be visible to others, it
// never asks for anything the app does not use, and it lets you leave.
//
// Shape follows what the group settled on:
//   * First name + last initial only. (Paul, 12 Sep 2026.)
//   * Country → city → school, in that order. (Linda, 6 Sep 2025: "Country
//     dropdown first / City dropdown next / Then school dropdown?")
//   * Role is one of four basics, never a job title or subject. (Linda, 7 Jun
//     2026: "we talked about NOT having teaching assignment".)
//   * Months and years. (Paul: "I think we can do months and years.")
import { supabase } from './supabaseClient.js';
import { el } from './widgets.js';

const ROLES = ['Faculty', 'Staff', 'Administrator', 'Student'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ── Reference data, fetched once ────────────────────────────────────────────
// One request each, paginated past PostgREST's 1,000-row default cap — there are
// 2,130 schools and 32,966 cities, and querying a level at a time silently
// dropped everything past the cap (which is how Venezuela went missing).
async function fetchAll(table, cols, order) {
  const page = 1000;
  const out = [];
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(cols);
    for (const o of order) q = q.order(o);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}

let _schools = null, _cities = null;
const schoolCatalogue = async () => (_schools ??= await fetchAll('schools', 'id,name,city,country,country_code,city_source', ['country', 'city', 'name']));
const cityCatalogue  = async () => (_cities  ??= await fetchAll('cities', 'id,name,country_code,latitude,longitude,population', ['country_code', 'name']));
export function invalidateCatalogue() { _schools = null; }

// ── School picker: country → city → school, with escape hatches ─────────────
// Linda, 6 Sep 2025: "Country dropdown first / City dropdown next / Then school
// dropdown?" — plus her other request from the same day, "with the option to add
// a school that's not listed", which is what the two "not listed" paths are.
function schoolPicker(onPick, initial = {}) {
  const wrap = el('div.school-picker');
  const cSel = el('select', { 'aria-label': 'Country' }, [el('option', { value: '', text: 'Country…' })]);
  const citySel = el('select', { 'aria-label': 'City', disabled: 'disabled' }, [el('option', { value: '', text: 'City…' })]);
  const sSel = el('select', { 'aria-label': 'School', disabled: 'disabled' }, [el('option', { value: '', text: 'School…' })]);
  wrap.append(cSel, citySel, sSel);

  const note = el('p.muted', { style: 'font-size:11.5px;margin:6px 0 0;flex:1 1 100%;' });
  const addBox = el('div.add-school');
  addBox.style.display = 'none';
  wrap.append(note, addBox);

  let schools = [], cities = [], ccOf = new Map();

  const CITY_OTHER = '__other__';
  const SCHOOL_NEW = '__new__';

  (async () => {
    try {
      [schools, cities] = await Promise.all([schoolCatalogue(), cityCatalogue()]);
    } catch (err) { note.textContent = `Couldn’t load the lists: ${err.message}`; return; }
    for (const s of schools) if (s.country_code) ccOf.set(s.country, s.country_code);
    const countries = [...new Set(schools.map((r) => r.country))].sort();
    countries.forEach((c) => cSel.appendChild(el('option', { value: c, text: c })));
    note.textContent = `${schools.length.toLocaleString()} schools in ${countries.length} countries.`;
    if (initial.country) { cSel.value = initial.country; cSel.dispatchEvent(new Event('change')); }
  })();

  const resetSchools = () => {
    sSel.innerHTML = ''; sSel.appendChild(el('option', { value: '', text: 'School…' }));
    addBox.style.display = 'none'; addBox.innerHTML = '';
  };

  cSel.addEventListener('change', () => {
    citySel.innerHTML = ''; citySel.appendChild(el('option', { value: '', text: 'City…' }));
    resetSchools();
    sSel.disabled = true; citySel.disabled = !cSel.value;
    onPick(null);
    if (!cSel.value) return;

    // cities that already have schools, then everywhere else in that country
    const withSchools = [...new Set(schools.filter((r) => r.country === cSel.value)
      .map((r) => r.city).filter(Boolean))].sort();
    withSchools.forEach((c) => citySel.appendChild(el('option', { value: c, text: c })));
    citySel.appendChild(el('option', { value: CITY_OTHER, text: '— another city in this country —' }));
    if (initial.city) { citySel.value = initial.city; citySel.dispatchEvent(new Event('change')); }
  });

  // The full gazetteer for a country, shown only when the listed cities don't cover it.
  function showAllCities() {
    const cc = ccOf.get(cSel.value);
    const pool = cities.filter((c) => c.country_code === cc)
      .sort((a, b) => b.population - a.population);
    citySel.innerHTML = '';
    citySel.appendChild(el('option', { value: '', text: `City… (${pool.length.toLocaleString()} in ${cSel.value})` }));
    pool.slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach((c) => citySel.appendChild(el('option', { value: c.name, text: c.name })));
    note.textContent = `Showing every city in ${cSel.value}. Pick yours, then add your school.`;
  }

  citySel.addEventListener('change', () => {
    if (citySel.value === CITY_OTHER) { showAllCities(); onPick(null); return; }
    resetSchools();
    sSel.disabled = !citySel.value;
    onPick(null);
    if (!citySel.value) return;

    const here = schools.filter((r) => r.country === cSel.value && r.city === citySel.value);
    here.forEach((r) => sSel.appendChild(el('option', { value: r.id, text: r.name })));
    sSel.appendChild(el('option', { value: SCHOOL_NEW, text: '+ My school isn’t listed…' }));

    const guessed = here.filter((r) => r.city_source === 'fallback-largest-city').length;
    note.textContent = here.length
      ? (guessed
        ? `${here.length} here. ${guessed} were filed under ${citySel.value} because the source list didn’t say which city.`
        : `${here.length} school${here.length === 1 ? '' : 's'} in ${citySel.value}.`)
      : `No schools listed in ${citySel.value} yet — add yours.`;
    if (initial.school_id) { sSel.value = String(initial.school_id); onPick(Number(initial.school_id)); }
  });

  // ── Adding a school ───────────────────────────────────────────────────────
  function showAddSchool() {
    addBox.innerHTML = '';
    addBox.style.display = '';
    const nameInput = el('input', { type: 'text', placeholder: 'Escola Americana de Campinas', 'aria-label': 'School name' });
    const go = el('button.btn', { type: 'button', text: 'Add it' });
    const status = el('span.muted', { style: 'font-size:12px;' });
    addBox.append(
      el('p.muted', { style: 'font-size:11.5px;margin:0 0 6px;', text: `Adding a school in ${citySel.value}, ${cSel.value}. Everyone will be able to pick it.` }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [nameInput, go, status]),
    );

    go.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (name.length < 2) { status.textContent = 'Give it a name.'; return; }
      go.disabled = true; status.textContent = 'Adding…';

      const cc = ccOf.get(cSel.value);
      const city = cities.find((c) => c.country_code === cc && c.name === citySel.value);
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase.from('schools').insert({
        name,
        city: citySel.value,
        country: cSel.value,
        country_code: cc || null,
        latitude: city?.latitude ?? null,
        longitude: city?.longitude ?? null,
        city_source: 'manual',
        is_verified: false,
        added_by: user.id,
      }).select('id,name,city,country,country_code,city_source').single();

      if (error) {
        status.textContent = error.message.replace(/^.*?:\s*/, '');
        go.disabled = false;
        return;
      }
      schools.push(data);
      _schools = schools;
      const opt = el('option', { value: data.id, text: data.name });
      sSel.insertBefore(opt, sSel.lastElementChild);
      sSel.value = String(data.id);
      onPick(data.id);
      addBox.style.display = 'none';
      note.textContent = `Added ${data.name}. Others can pick it now too.`;
    });
  }

  sSel.addEventListener('change', () => {
    if (sSel.value === SCHOOL_NEW) { showAddSchool(); onPick(null); return; }
    addBox.style.display = 'none';
    onPick(sSel.value ? Number(sSel.value) : null);
  });

  return wrap;
}

// ── One posting row ─────────────────────────────────────────────────────────
function postingRow(posting, onRemove) {
  const row = el('div.posting-row');
  const state = {
    school_id: posting?.school_id ?? null,
    role: posting?.role ?? 'Faculty',
    start: posting?.start_date ?? '',
    end: posting?.end_date ?? '',
    current: posting ? !posting.end_date : false,
    id: posting?.id ?? null,
  };
  row._state = state;

  row.appendChild(schoolPicker((id) => { state.school_id = id; }, {
    country: posting?._country, city: posting?._city, school_id: posting?.school_id,
  }));

  const roleSel = el('select', { 'aria-label': 'Role' },
    ROLES.map((r) => el('option', { value: r, text: r, selected: r === state.role ? 'selected' : null })));
  roleSel.addEventListener('change', () => { state.role = roleSel.value; });

  const ym = (label, onChange, val) => {
    const now = new Date().getFullYear();
    const m = el('select', { 'aria-label': `${label} month` },
      [el('option', { value: '', text: 'Month' }),
        ...MONTHS.map((n, i) => el('option', { value: String(i + 1).padStart(2, '0'), text: n }))]);
    const y = el('select', { 'aria-label': `${label} year` },
      [el('option', { value: '', text: 'Year' }),
        ...Array.from({ length: now - 1959 }, (_, k) => now - k).map((v) => el('option', { value: String(v), text: String(v) }))]);
    if (val) { y.value = val.slice(0, 4); m.value = val.slice(5, 7); }
    const fire = () => onChange(y.value && m.value ? `${y.value}-${m.value}-01` : '');
    m.addEventListener('change', fire); y.addEventListener('change', fire);
    return el('div.ym', {}, [el('label', { text: label }), m, y]);
  };

  const endWrap = ym('Ended', (v) => { state.end = v; }, state.end);
  const curCb = el('input', { type: 'checkbox' });
  if (state.current) { curCb.checked = true; endWrap.style.display = 'none'; }
  curCb.addEventListener('change', () => {
    state.current = curCb.checked;
    endWrap.style.display = curCb.checked ? 'none' : '';
    if (curCb.checked) state.end = '';
  });

  const remove = el('button.btn.ghost', { type: 'button', text: 'Remove' });
  remove.addEventListener('click', () => onRemove(row));

  row.append(
    el('div.control-group', {}, [el('label', { text: 'Role' }), roleSel]),
    ym('Started', (v) => { state.start = v; }, state.start),
    endWrap,
    el('label.still-here', {}, [curCb, ' I’m still here']),
    remove,
  );
  return row;
}

// ── Draft autosave ──────────────────────────────────────────────────────────
// This form is long, and the two ways out of it — a reload, or a sign-in that
// expired while you were typing — both used to throw the lot away. Keep a draft
// locally so neither does. It never leaves the browser.
const DRAFT_KEY = 'sixdeg.onboarding.draft';

function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
}
function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// ── The form ────────────────────────────────────────────────────────────────
export function onboardingView(user, profile, onDone) {
  const root = el('div.view');
  const isNew = !profile;

  root.appendChild(el('div.view-head', {}, [
    el('h2', { text: isNew ? 'Welcome — tell us where you’ve been' : 'Your details' }),
    el('p', {
      html: isNew
        ? 'This is the real thing now, so only what the map actually needs. Everyone in the group sees your <strong>first name and last initial</strong>, where you’ve worked and when. <strong>Nobody ever sees your email address.</strong>'
        : 'Edit your history. Connections recompute the moment you save.',
    }),
  ]));

  // identity
  const first = el('input', { type: 'text', required: 'required', placeholder: 'Paul', value: profile?.first_name || '' });
  const initial = el('input', { type: 'text', maxlength: '1', placeholder: 'S', value: profile?.last_initial || '', style: 'width:64px;' });
  const nationality = el('input', { type: 'text', placeholder: 'Canadian', value: profile?.nationality || '' });
  const specialization = el('input', { type: 'text', placeholder: 'Physics', value: profile?.specialization || '' });

  const who = el('div.card');
  who.append(
    el('h4', { text: 'You' }),
    el('div.controls', {}, [
      el('div.control-group', {}, [el('label', { text: 'First name' }), first]),
      el('div.control-group', {}, [el('label', { text: 'Last initial' }), initial]),
      el('div.control-group', {}, [el('label', { text: 'Nationality (optional)' }), nationality]),
      el('div.control-group', {}, [el('label', { text: 'Subject / role (optional)' }), specialization]),
    ]),
    el('p.muted', { style: 'font-size:12px;margin:6px 2px 0;', text: `Signed in as ${user.email} — this is never shown to anyone else.` }),
  );
  root.appendChild(who);

  // postings
  const postWrap = el('div.card');
  postWrap.append(el('h4', { text: 'Where you’ve worked' }),
    el('p.muted', { style: 'font-size:12.5px;margin:0 0 10px;', html: 'Add every posting you want counted — including non-international schools. Paul, 6 Sep 2025: <em>"if the purpose is to see who knows who… US based schools are fair game."</em>' }));
  const rows = el('div');
  postWrap.appendChild(rows);
  const addBtn = el('button.btn', { type: 'button', text: '+ Add a posting' });
  const removeRow = (r) => { r.remove(); if (!rows.children.length) addRow(); };
  const addRow = (p) => rows.appendChild(postingRow(p, removeRow));
  addBtn.addEventListener('click', () => addRow());
  postWrap.appendChild(addBtn);
  root.appendChild(postWrap);

  const snapshot = () => ({
    first: first.value, initial: initial.value,
    nationality: nationality.value, specialization: specialization.value,
    postings: [...rows.children].map((r) => r._state),
  });
  root.addEventListener('change', () => saveDraft(snapshot()));
  root.addEventListener('input', () => saveDraft(snapshot()));

  const status = el('p.auth-msg');
  const save = el('button.btn.accent', { type: 'button', text: isNew ? 'Join 6 Degrees' : 'Save changes' });
  root.append(el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:14px;' }, [save, status]));

  // existing postings
  (async () => {
    if (!profile) {
      const d = readDraft();
      if (d) {
        first.value = d.first || ''; initial.value = d.initial || '';
        nationality.value = d.nationality || ''; specialization.value = d.specialization || '';
        // Postings need their school ids resolved back to country/city to re-populate
        // the cascade, so rebuild from the catalogue.
        const cat = await schoolCatalogue().catch(() => []);
        const byId = new Map(cat.map((x) => [x.id, x]));
        (d.postings || []).filter((p) => p.school_id || p.start).forEach((p) => {
          const sc = byId.get(p.school_id);
          addRow({
            school_id: p.school_id, role: p.role,
            start_date: p.start, end_date: p.current ? null : p.end,
            _country: sc?.country, _city: sc?.city,
          });
        });
        if (!rows.children.length) addRow();
        status.className = 'auth-msg';
        status.textContent = 'Restored what you had typed.';
        return;
      }
      addRow();
      return;
    }
    const { data } = await supabase
      .from('postings')
      .select('id, school_id, role, start_date, end_date, schools(name, city, country)')
      .eq('profile_id', profile.id)
      .order('start_date');
    if (data?.length) {
      data.forEach((p) => addRow({ ...p, _country: p.schools?.country, _city: p.schools?.city }));
    } else addRow();
  })();

  save.addEventListener('click', async () => {
    status.className = 'auth-msg';
    const f = first.value.trim();
    if (!f) { status.className = 'auth-msg error'; status.textContent = 'First name is required.'; return; }

    const wanted = [...rows.children].map((r) => r._state)
      .filter((s) => s.school_id && s.start);
    if (!wanted.length) {
      status.className = 'auth-msg error';
      status.textContent = 'Add at least one posting — a school and a start date.';
      return;
    }
    const bad = wanted.find((s) => !s.current && !s.end);
    if (bad) {
      status.className = 'auth-msg error';
      status.textContent = 'Every posting needs an end date, or “I’m still here” ticked.';
      return;
    }

    save.disabled = true; save.textContent = 'Saving…';
    try {
      // One server-side call. The client deliberately does NOT send an id: the
      // database takes auth.uid() as the only possible answer, so the id it
      // writes and the id RLS checks cannot disagree. Everything is one
      // transaction, so nobody ends up half-registered.
      const { error } = await supabase.rpc('save_my_profile', {
        p_first_name: f,
        p_last_initial: initial.value.trim() || null,
        p_nationality: nationality.value.trim() || null,
        p_specialization: specialization.value.trim() || null,
        p_postings: wanted.map((st) => ({
          school_id: st.school_id,
          role: st.role,
          start_date: st.start,
          end_date: st.current ? null : st.end,
        })),
      });
      if (error) throw error;

      clearDraft();
      status.className = 'auth-msg ok';
      status.textContent = 'Saved.';
      onDone();
    } catch (err) {
      status.className = 'auth-msg error';
      const m = err.message || String(err);
      status.textContent = /not signed in|28000|JWT/i.test(m)
        ? 'Your sign-in expired while you were filling this in. Reload the page — what you typed is saved — then sign in and press Save again.'
        : m;
      console.error('[6deg] save failed:', err);
      save.disabled = false;
      save.textContent = isNew ? 'Join 6 Degrees' : 'Save changes';
    }
  });

  return root;
}
