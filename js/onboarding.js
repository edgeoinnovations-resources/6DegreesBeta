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

// ── School picker: country → city → school ──────────────────────────────────
// 2,130 schools is far too many for one list, and the cascade is also how a
// school gets found when its name doesn't contain its city.
function schoolPicker(onPick, initial = {}) {
  const wrap = el('div.school-picker');
  const cSel = el('select', { 'aria-label': 'Country' }, [el('option', { value: '', text: 'Country…' })]);
  const citySel = el('select', { 'aria-label': 'City', disabled: 'disabled' }, [el('option', { value: '', text: 'City…' })]);
  const sSel = el('select', { 'aria-label': 'School', disabled: 'disabled' }, [el('option', { value: '', text: 'School…' })]);
  wrap.append(cSel, citySel, sSel);

  const missing = el('p.muted', { style: 'font-size:11.5px;margin:6px 0 0;' });
  wrap.appendChild(missing);

  let countries = [];

  (async () => {
    // distinct countries, via a lightweight select
    const { data, error } = await supabase.from('schools').select('country').order('country');
    if (error) { missing.textContent = `Couldn’t load schools: ${error.message}`; return; }
    countries = [...new Set((data || []).map((r) => r.country))];
    countries.forEach((c) => cSel.appendChild(el('option', { value: c, text: c })));
    if (initial.country) { cSel.value = initial.country; cSel.dispatchEvent(new Event('change')); }
  })();

  cSel.addEventListener('change', async () => {
    citySel.innerHTML = ''; citySel.appendChild(el('option', { value: '', text: 'City…' }));
    sSel.innerHTML = ''; sSel.appendChild(el('option', { value: '', text: 'School…' }));
    sSel.disabled = true; citySel.disabled = !cSel.value;
    missing.textContent = '';
    if (!cSel.value) return;
    const { data } = await supabase.from('schools')
      .select('city').eq('country', cSel.value).order('city');
    const cities = [...new Set((data || []).map((r) => r.city).filter(Boolean))];
    cities.forEach((c) => citySel.appendChild(el('option', { value: c, text: c })));
    if (initial.city) { citySel.value = initial.city; citySel.dispatchEvent(new Event('change')); }
  });

  citySel.addEventListener('change', async () => {
    sSel.innerHTML = ''; sSel.appendChild(el('option', { value: '', text: 'School…' }));
    sSel.disabled = !citySel.value;
    missing.textContent = '';
    if (!citySel.value) return;
    const { data } = await supabase.from('schools')
      .select('id,name,city_source').eq('country', cSel.value).eq('city', citySel.value).order('name');
    (data || []).forEach((s) => sSel.appendChild(el('option', { value: s.id, text: s.name })));
    // Be honest that some cities are inferred, so a missing school has an explanation.
    const guessed = (data || []).filter((s) => s.city_source === 'fallback-largest-city').length;
    if (guessed) {
      missing.textContent = `${guessed} of these were filed under ${citySel.value} because the source `
        + 'list didn’t say which city. If your school is missing, check another city — or tell Paul.';
    }
    if (initial.school_id) sSel.value = String(initial.school_id);
  });

  sSel.addEventListener('change', () => onPick(sSel.value ? Number(sSel.value) : null));
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

  const status = el('p.auth-msg');
  const save = el('button.btn.accent', { type: 'button', text: isNew ? 'Join 6 Degrees' : 'Save changes' });
  root.append(el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:14px;' }, [save, status]));

  // existing postings
  (async () => {
    if (!profile) { addRow(); return; }
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
      const { error: pErr } = await supabase.from('profiles').upsert({
        id: user.id,
        first_name: f,
        last_initial: initial.value.trim() || null,
        nationality: nationality.value.trim() || null,
        specialization: specialization.value.trim() || null,
      });
      if (pErr) throw pErr;

      await supabase.from('privacy_settings').upsert({ profile_id: user.id }, { onConflict: 'profile_id' });

      // Replace postings wholesale: simpler than diffing, and the trigger
      // recomputes degrees either way.
      const { error: dErr } = await supabase.from('postings').delete().eq('profile_id', user.id);
      if (dErr) throw dErr;
      const { error: iErr } = await supabase.from('postings').insert(
        wanted.map((s) => ({
          profile_id: user.id,
          school_id: s.school_id,
          role: s.role,
          start_date: s.start,
          end_date: s.current ? null : s.end,
        })),
      );
      if (iErr) throw iErr;

      status.className = 'auth-msg ok';
      status.textContent = 'Saved.';
      onDone();
    } catch (err) {
      status.className = 'auth-msg error';
      status.textContent = err.message || String(err);
      save.disabled = false;
      save.textContent = isNew ? 'Join 6 Degrees' : 'Save changes';
    }
  });

  return root;
}
