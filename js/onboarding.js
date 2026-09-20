// onboarding.js — registering yourself, and editing your own history later.
//
// This is where the first REAL data in the project comes from, so it is
// deliberately careful: it shows exactly what will be visible to others, it
// never asks for anything the app does not use, and it lets you leave.
//
// Shape follows what the group settled on:
//   * First and last name. (Originally first name + last initial only; Paul changed
//     that on 13 Sep 2026: "we enter full last names instead of just the initial".)
//   * Country → city → school, in that order. (Linda, 6 Sep 2025: "Country
//     dropdown first / City dropdown next / Then school dropdown?")
//   * Role is one of four basics, never a job title or subject. (Linda, 7 Jun
//     2026: "we talked about NOT having teaching assignment".)
//   * Months and years. (Paul: "I think we can do months and years.")
import { supabase, friendlyDbError, friendlyAuthError } from './supabaseClient.js';
import { el, append } from './widgets.js';

const ROLES = ['Faculty', 'Staff', 'Administrator', 'Student'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ── Reference data ──────────────────────────────────────────────────────────
// Paginated past PostgREST's 1,000-row default cap, because querying a level at a
// time silently dropped everything past it (which is how Venezuela went missing).
// `where` narrows the query server-side.
async function fetchAll(table, cols, order, where) {
  const page = 1000;
  const out = [];
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(cols);
    if (where) q = where(q);
    for (const o of order) q = q.order(o);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}

const CITY_COLS = 'id,name,admin1,region,country_code,latitude,longitude,population';

// Cache the PROMISE, not the resolved value.
//
// `x ??= await fetch()` looks like memoisation and is not: every caller that
// arrives before the first one resolves still sees null and starts its own
// request. Each posting row builds its own picker, so opening "Your details"
// with three postings fetched the 2,120-school catalogue three times over —
// nine requests — and the regions table three times. Linda has nine postings.
// Holding the promise means the second caller awaits the first one's request.
let _schoolsP = null, _regionsP = null, _countriesP = null;
const _citiesByCountry = new Map();

// Caching a promise means caching a FAILED one too, which would leave the picker
// empty for the rest of the session over one dropped request. Evict on rejection
// so the next caller retries.
const schoolCatalogue = () => (_schoolsP ??= fetchAll('schools', 'id,name,city,region,country,country_code,city_source', ['country', 'city', 'name'])
  .catch((e) => { _schoolsP = null; throw e; }));

// Cities ONE COUNTRY AT A TIME, not all of them.
//
// This used to download the whole gazetteer before the form could do anything:
// 34 pages of cities plus 3 of schools, each awaited after the last — 37 round
// trips before a school name could appear in a dropdown. That is what Melissa
// reported on 15 Sep 2026: "when I went back to my profile to add one more
// school, the previous school names weren't listed, just the dates I was there."
// It was diagnosed as load speed and left, on the hope that a paid database would
// fix it. It would not have: the round trips are in the client, and they get
// worse with every city added to the gazetteer.
//
// Now: 3 requests at open, and one more the first time a country is picked.
const citiesIn = (cc) => {
  if (!cc) return Promise.resolve([]);
  if (!_citiesByCountry.has(cc)) {
    _citiesByCountry.set(cc, fetchAll('cities', CITY_COLS, ['name'], (q) => q.eq('country_code', cc))
      .catch((e) => { _citiesByCountry.delete(cc); throw e; }));
  }
  return _citiesByCountry.get(cc);
};

// Every country on Earth, 252 of them, not the 167 that happen to have a school
// in the catalogue. Sarah asked for Benin on 19 Sep; Benin had never been on the
// list, because the list was derived from the schools. Nor had 84 others, and
// nobody asked about those — a person who cannot find their country assumes the
// site is not for them and closes it.
const countryCatalogue = () => (_countriesP ??= fetchAll('countries', 'code,name,continent', ['name'])
  .catch((e) => { _countriesP = null; throw e; }));

// States and provinces, with an approximate centre each. Linda, 13 Sep 2026:
// "I worked in Annandale, MN, but it puts me in Annandale, VA." 51 rows.
const regionCatalogue = () => (_regionsP ??= fetchAll('regions', 'country_code,code,name,latitude,longitude', ['country_code', 'code'])
  .catch((e) => { _regionsP = null; throw e; }));

export function invalidateCatalogue() { _schoolsP = null; _citiesByCountry.clear(); }

// ── Who may write to you ────────────────────────────────────────────────────
//
// Paul, 19 Sep 2026: a toggle that says "Allow People to Message Me".
//
// ON by default, deliberately. Off by default is a feature nobody finds, and the
// use case it exists for — Linda reaching someone she has lost touch with — dies
// if the other person never flipped a switch they did not know about.
function messagePrefs() {
  const card = el('div.card');
  const box = el('input', { type: 'checkbox', autocomplete: 'off' });
  const msg = el('p.auth-msg', { style: 'margin:6px 0 0;' });
  const blocked = el('div', { style: 'margin-top:10px;' });

  append(card,
    el('h4', { text: 'Messages' }),
    el('div.control-group', {}, [el('label', {}, [box, ' Allow people to message me'])]),
    el('p.muted', {
      style: 'font-size:11.5px;margin:4px 0 0;max-width:70ch;',
      text: 'Any member can write to you. Nobody ever sees your email address — '
          + 'messages stay on the site, and you get a note by email saying one is waiting.',
    }),
    msg,
    blocked,
  );

  (async () => {
    const { data } = await supabase.from('privacy_settings')
      .select('accepts_messages').maybeSingle();
    box.checked = data?.accepts_messages !== false;
    box.dataset.ready = '1';
  })();

  box.addEventListener('change', async () => {
    if (!box.dataset.ready) return;
    msg.className = 'auth-msg';
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('privacy_settings')
      .update({ accepts_messages: box.checked }).eq('profile_id', user.id);
    if (error) {
      box.checked = !box.checked;
      msg.className = 'auth-msg error';
      msg.textContent = friendlyDbError(error, 'save that');
      return;
    }
    msg.className = 'auth-msg ok';
    msg.textContent = box.checked ? 'People can message you.' : 'Nobody can message you.';
  });

  // People you have quietly declined. Listed here because this is the only place
  // you could undo it — they are invisible everywhere else by design.
  (async () => {
    const { data } = await supabase.from('message_blocks').select('blocked_id');
    if (!data?.length) return;
    const ids = data.map((r) => r.blocked_id);
    const { data: who } = await supabase.from('public_profiles')
      .select('id, display_name').in('id', ids);
    blocked.appendChild(el('p.muted', {
      style: 'font-size:11.5px;margin:0 0 4px;',
      text: 'Not accepting messages from:',
    }));
    (who || []).forEach((w) => {
      const row = el('div.conn-row');
      const undo = el('button.btn.ghost', { type: 'button', text: 'allow again' });
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        await supabase.from('message_blocks').delete().eq('blocked_id', w.id);
        row.remove();
      });
      append(row, el('span', { text: w.display_name }),
        el('span', { style: 'margin-left:auto;' }, [undo]));
      blocked.appendChild(row);
    });
  })();

  return card;
}

// ── Final destination ───────────────────────────────────────────────────────
//
// Asked for by a member: international teachers scatter, and when they stop
// moving they would like to know who else stopped nearby.
//
// Two questions, because one cannot write the sentence: WHERE, and whether they
// are there yet. "Retired in Chiang Mai" and "Plans to retire in Chiang Mai" are
// different facts and guessing between them would be wrong half the time.
//
// Not a degree. The six come from where people WORKED; this is searchable and
// mappable and touches the degree engine nowhere.
function finalDestination(profile) {
  const card = el('div.card');
  const has = !!profile?.final_city;

  const country = el('select', { 'aria-label': 'Country' }, [el('option', { value: '', text: 'Country…' })]);
  const city = el('select', { 'aria-label': 'Town or city', disabled: 'disabled' },
    [el('option', { value: '', text: 'Town or city…' })]);
  const state = el('select', { 'aria-label': 'Already there?' }, [
    el('option', { value: 'there', text: 'I already live there' }),
    el('option', { value: 'planned', text: 'That’s the plan' }),
  ]);
  const shown = el('input', { type: 'checkbox', autocomplete: 'off' });
  shown.checked = profile?.final_public !== false;
  const save = el('button.btn', { type: 'button', text: 'Save' });
  const clear = el('button.btn.ghost', { type: 'button', text: 'Remove' });
  const msg = el('p.auth-msg', { style: 'margin:8px 0 0;' });

  if (profile?.final_status) state.value = profile.final_status;

  append(card,
    el('h4', { text: 'Final destination' }),
    el('p.muted', {
      style: 'font-size:12.5px;margin:0 0 10px;max-width:70ch;',
      text: 'Where you have retired, or expect to. Other members can find who else '
          + 'landed in the same place. It never changes anyone’s degree — those come '
          + 'from where you worked.',
    }),
    el('div.controls', {}, [
      el('div.control-group', {}, [el('label', { text: 'Country' }), country]),
      el('div.control-group', {}, [el('label', { text: 'Town or city' }), city]),
      el('div.control-group', {}, [el('label', { text: 'Status' }), state]),
    ]),
    el('div.control-group', { style: 'margin-top:4px;' },
      [el('label', {}, [shown, ' Show this to other members'])]),
    el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:10px;' },
      has ? [save, clear] : [save]),
    msg,
  );

  // Countries come from the school catalogue; towns from the gazetteer, so a
  // retirement town is as structured as a school's city and can be mapped.
  (async () => {
    try {
      const [schools, all] = await Promise.all([
        schoolCatalogue(), countryCatalogue().catch(() => []),
      ]);
      // Retiring somewhere nobody has taught is the normal case, not the odd
      // one — this list has always needed every country more than the postings
      // list did.
      const cc = new Map();
      for (const c of all) cc.set(c.name, c.code);
      for (const r of schools) if (r.country_code) cc.set(r.country, r.country_code);
      const names = all.length ? all.map((c) => c.name)
                               : [...new Set(schools.map((r) => r.country))].sort();
      names.forEach((n) => country.appendChild(el('option', { value: n, text: n })));

      const fillCities = async (countryName, preselect) => {
        city.innerHTML = '';
        city.appendChild(el('option', { value: '', text: 'Town or city…' }));
        const rows = await citiesIn(cc.get(countryName)).catch(() => []);
        rows.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => {
          const label = c.region ? `${c.name}, ${c.region}` : c.name;
          const o = el('option', { value: c.name, text: label });
          if (c.region) o.dataset.region = c.region;
          city.appendChild(o);
        });
        city.disabled = !rows.length;
        if (preselect) {
          const o = [...city.options].find((x) => x.value === preselect);
          if (o) o.selected = true;
        }
      };

      country.addEventListener('change', () => fillCities(country.value, null));
      if (profile?.final_country) {
        country.value = profile.final_country;
        await fillCities(profile.final_country, profile.final_city);
      }
    } catch (err) {
      msg.className = 'auth-msg error';
      msg.textContent = friendlyDbError(err, 'load the place list');
    }
  })();

  const write = async (wipe) => {
    msg.className = 'auth-msg';
    if (!wipe && (!country.value || !city.value)) {
      msg.className = 'auth-msg error';
      msg.textContent = 'Pick a country and a town.';
      return;
    }
    save.disabled = true; clear.disabled = true;
    const region = city.selectedOptions[0]?.dataset.region || null;
    const { error } = await supabase.rpc('save_final_destination', {
      p_city: wipe ? null : city.value,
      p_region: wipe ? null : region,
      p_country: wipe ? null : country.value,
      p_state: wipe ? null : state.value,
      p_public: shown.checked,
    });
    save.disabled = false; clear.disabled = false;
    if (error) {
      msg.className = 'auth-msg error';
      msg.textContent = friendlyDbError(error, 'save your final destination');
      return;
    }
    msg.className = 'auth-msg ok';
    msg.textContent = wipe ? 'Removed.' : 'Saved.';
    if (wipe) { country.value = ''; city.innerHTML = ''; city.disabled = true; }
  };
  save.addEventListener('click', () => write(false));
  clear.addEventListener('click', () => write(true));

  return card;
}

// ── Your sign-in address ────────────────────────────────────────────────────
//
// Linda, 19 Sep 2026: what if she registered with her work email and then left
// for another school — can she change it without losing her connections?
//
// Yes, and it has always been possible: a profile is keyed to the auth user's
// ID, not their address. Change the address, the ID stays, and every posting,
// connection and tag is untouched. There was simply no way to ask.
//
// It is the likeliest way for someone here to lose their account. Half this
// group registered on @asdubai.org, in a network whose defining feature is that
// people change schools every few years. The day that address stops working,
// so does the only key to a career history.
//
// ONE ADDRESS, NOT A LIST. Supabase gives an account exactly one email, so this
// is a change rather than "add a second and retire the first".
//
// DO IT BEFORE YOU LOSE THE OLD ONE. Confirmation may be sent to both addresses
// depending on the project's security setting. Anyone already locked out needs
// Paul to move them by hand.
function emailBlock(user) {
  const wrap = el('div', { style: 'margin:10px 2px 0;' });
  const line = el('p.muted', { style: 'font-size:12px;margin:0;' });
  line.innerHTML = `Signed in as <strong>${user.email}</strong> — this is never shown to anyone else. `;
  const change = el('button.acct-edit', { type: 'button', text: 'Change it' });
  line.appendChild(change);
  wrap.appendChild(line);

  const form = el('div', { style: 'margin-top:8px;' });
  form.hidden = true;
  const next = el('input', {
    type: 'email', autocomplete: 'off', 'aria-label': 'New email address',
    placeholder: 'your personal address',
  });
  const go = el('button.btn', { type: 'button', text: 'Send confirmation' });
  const msg = el('p.auth-msg', { style: 'margin:8px 0 0;' });
  append(form,
    el('p.muted', {
      style: 'font-size:11.5px;margin:0 0 6px;max-width:62ch;',
      html: 'Use a <strong>personal</strong> address, not a school one — schools close your '
        + 'account when you leave, and this is the only key to your history. '
        + 'Your connections, postings and tags all stay exactly as they are.',
    }),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [next, go]),
    msg,
  );
  wrap.appendChild(form);

  change.addEventListener('click', () => {
    form.hidden = !form.hidden;
    change.textContent = form.hidden ? 'Change it' : 'Cancel';
    if (!form.hidden) next.focus();
  });

  go.addEventListener('click', async () => {
    const addr = next.value.trim();
    msg.className = 'auth-msg';
    if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      msg.className = 'auth-msg error'; msg.textContent = 'That does not look like an email address.'; return;
    }
    if (addr.toLowerCase() === (user.email || '').toLowerCase()) {
      msg.className = 'auth-msg error'; msg.textContent = 'That is already your address.'; return;
    }
    go.disabled = true; go.textContent = 'Sending…';
    const { error } = await supabase.auth.updateUser(
      { email: addr },
      { emailRedirectTo: `${location.origin}${location.pathname}` },
    );
    go.disabled = false; go.textContent = 'Send confirmation';
    if (error) {
      msg.className = 'auth-msg error';
      msg.textContent = friendlyAuthError
        ? friendlyAuthError(error)
        : (error.message || 'That did not go through.');
      return;
    }
    msg.className = 'auth-msg ok';
    msg.textContent = `Check ${addr} for a confirmation link. `
      + 'Until you click it, keep signing in with your current address. '
      + 'You may also get a confirmation at your old address — click both.';
  });

  return wrap;
}

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

  // Search by NAME, regardless of city. The cities were inferred from school names
  // and are wrong in places — AES was filed under "Delhi" while Linda looked under
  // "New Delhi" — so a city-first cascade alone lets people conclude a school is
  // missing when it isn't. Melissa asked for this in Sep 2025: "start to type the
  // country, school name, and have the dropdown catch up to that typing?"
  const searchWrap = el('div.school-search');
  const search = el('input', {
    type: 'search', placeholder: 'Or type part of the school’s name…',
    'aria-label': 'Search schools by name', autocomplete: 'off',
  });
  const results = el('div.school-results');
  results.hidden = true;
  searchWrap.append(search, results);
  wrap.prepend(searchWrap);
  wrap.append(note, addBox);

  // `cities` holds ONLY the currently selected country's cities, refreshed when
  // the country changes. It used to be all 33,885 of them.
  let schools = [], cities = [], regions = [], ccOf = new Map();

  const COUNTRY_NEW = '__newcountry__';
  const CITY_OTHER = '__other__';
  const CITY_NEW = '__newcity__';
  const SCHOOL_NEW = '__new__';

  // A city is a NAME PLUS A REGION now, because "Annandale, United States" names
  // two towns a thousand miles apart. The <select> can only carry a string, so the
  // region rides along on the option and is read back from it.
  const cityRegion = () => citySel.selectedOptions[0]?.dataset.region || '';
  const sameRegion = (a, b) => !a || !b || a === b;   // unknown never blocks a match
  const cityLabel = (name, region) => (region ? `${name}, ${region}` : name);
  const cityOption = (name, region) => {
    const o = el('option', { value: name, text: cityLabel(name, region) });
    if (region) o.dataset.region = region;
    return o;
  };

  (async () => {
    let allCountries = [];
    try {
      [schools, regions, allCountries] = await Promise.all([
        schoolCatalogue(), regionCatalogue().catch(() => []), countryCatalogue().catch(() => []),
      ]);
    } catch (err) { note.textContent = friendlyDbError(err, 'load the school list'); return; }
    // EVERY COUNTRY, not the ones that happen to have a school already. The list
    // used to be derived from the catalogue, so 85 countries — Benin among them,
    // which is what Sarah asked for — had never appeared at all. A country with
    // no schools yet is not a dead end: its cities come from the gazetteer and
    // the school gets added by the person who worked there.
    for (const c of allCountries) ccOf.set(c.name, c.code);
    for (const s of schools) if (s.country_code) ccOf.set(s.country, s.country_code);
    const withSchools = new Set(schools.map((r) => r.country));
    const countries = allCountries.length
      ? allCountries.map((c) => c.name)
      : [...withSchools].sort();
    countries.forEach((c) => cSel.appendChild(el('option', { value: c, text: c })));
    // Still offered, even now that every country is there: it catches a country
    // somebody cannot find under the name they expect.
    cSel.appendChild(el('option', { value: COUNTRY_NEW, text: '+ I can’t find my country…' }));
    note.textContent = `${schools.length.toLocaleString()} schools in ${withSchools.size} countries, `
      + `and every country on Earth to add one in.`;
    if (initial.country) { cSel.value = initial.country; initial.country = null; cSel.dispatchEvent(new Event('change')); }
  })();

  const resetSchools = () => {
    sSel.innerHTML = ''; sSel.appendChild(el('option', { value: '', text: 'School…' }));
    addBox.style.display = 'none'; addBox.innerHTML = '';
  };

  cSel.addEventListener('change', async () => {
    if (cSel.value === COUNTRY_NEW) { showAskCountry(); onPick(null); return; }
    citySel.innerHTML = ''; citySel.appendChild(el('option', { value: '', text: 'City…' }));
    resetSchools();
    sSel.disabled = true; citySel.disabled = !cSel.value;
    onPick(null);
    if (!cSel.value) return;

    // One request, for this country only. Fire it now; the list below is built
    // from the schools we already have, so nothing waits on it.
    const pending = citiesIn(ccOf.get(cSel.value)).catch(() => []);

    // cities that already have schools, then everywhere else in that country
    const seen = new Set();
    schools.filter((r) => r.country === cSel.value && r.city)
      .map((r) => [r.city, r.region || ''])
      .filter(([c, rg]) => { const k = `${c}|${rg}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => cityLabel(...a).localeCompare(cityLabel(...b)))
      .forEach(([c, rg]) => citySel.appendChild(cityOption(c, rg)));
    citySel.appendChild(el('option', { value: CITY_OTHER, text: '— another city in this country —' }));
    citySel.appendChild(el('option', { value: CITY_NEW, text: '+ My city isn’t listed…' }));
    // Nobody has listed a school in this country yet — 85 countries are in that
    // position now that all of them are offered. Don't hand them a dropdown with
    // two apologies in it: show the country's real cities straight away.
    const anyHere = schools.some((r) => r.country === cSel.value);
    if (!anyHere) {
      cities = await pending;
      await showAllCities();
      return;
    }
    if (initial.city) {
      const want = initial.region || '';
      const opt = [...citySel.options].find((o) => o.value === initial.city
        && (o.dataset.region || '') === want)
        || [...citySel.options].find((o) => o.value === initial.city);
      initial.city = null; initial.region = null;
      if (opt) { opt.selected = true; citySel.dispatchEvent(new Event('change')); }
    }
    // Keep the country's gazetteer to hand for "another city" and for the
    // coordinates a newly added school needs.
    cities = await pending;
  });

  // The full gazetteer for a country, shown only when the listed cities don't cover it.
  async function showAllCities() {
    const cc = ccOf.get(cSel.value);
    citySel.innerHTML = '';
    citySel.appendChild(el('option', { value: '', text: 'Loading cities…' }));
    const pool = await citiesIn(cc).catch(() => []);
    cities = pool;
    citySel.innerHTML = '';
    citySel.appendChild(el('option', { value: '', text: `City… (${pool.length.toLocaleString()} in ${cSel.value})` }));
    pool.slice().sort((a, b) => cityLabel(a.name, a.region).localeCompare(cityLabel(b.name, b.region)))
      .forEach((c) => citySel.appendChild(cityOption(c.name, c.region || '')));
    citySel.appendChild(el('option', { value: CITY_NEW, text: '+ My city isn’t listed…' }));
    note.textContent = `Showing every city in ${cSel.value}. Pick yours, then add your school.`;
  }

  // ── A country that isn't there at all ─────────────────────────────────────
  // A member cannot create a country: it is the top of the cascade and the list
  // is derived from the schools. What they CAN do is tell us, in one line, and
  // carry on with the rest of their history rather than stopping dead. Paul
  // gets an email the same minute and adds the country's schools.
  function showAskCountry() {
    addBox.innerHTML = '';
    addBox.style.display = '';
    citySel.disabled = true; sSel.disabled = true;

    const nameInput = el('input', {
      type: 'text', autocomplete: 'off', 'aria-label': 'Country',
      placeholder: 'Which country?',
    });
    const noteInput = el('input', {
      type: 'text', autocomplete: 'off', 'aria-label': 'The school, if you know it',
      placeholder: 'And the school, if you like — we’ll look it up',
      style: 'min-width:260px;',
    });
    const go = el('button.btn', { type: 'button', text: 'Tell Paul' });
    const status = el('span.muted', { style: 'font-size:12px;' });
    addBox.append(
      el('p.muted', { style: 'font-size:11.5px;margin:0 0 6px;',
        text: 'No school anywhere in that country has been listed yet, so it isn’t in the list. '
            + 'Tell us and it will be added — usually the same day.' }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' },
        [nameInput, noteInput, go, status]),
    );

    go.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (name.length < 2) { status.textContent = 'Which country?'; return; }
      go.disabled = true; status.textContent = 'Sending…';
      try {
        const { data, error } = await supabase.rpc('request_country', {
          p_country: name, p_note: noteInput.value.trim() || null,
        });
        if (error) throw error;
        if (data) await supabase.functions.invoke('notify-addition', { body: { id: data } });
        status.textContent = '';
        addBox.innerHTML = '';
        addBox.appendChild(el('p', { style: 'font-size:12.5px;margin:0;color:#1f7a3f;',
          text: `Thank you — Paul has been told about ${name}. `
              + 'Carry on with the rest of your history; you can add that one when it appears.' }));
        cSel.value = '';
      } catch (err) {
        status.textContent = friendlyDbError(err, 'send that');
        go.disabled = false;
      }
    });
    nameInput.focus();
  }

  // ── Adding a city the gazetteer has never heard of ────────────────────────
  // Annandale, Minnesota has about 3,300 people and is below the GeoNames
  // threshold, so no amount of fixing the city list would ever have offered it to
  // Linda. She has to be able to say where she worked.
  function showAddCity() {
    addBox.innerHTML = '';
    addBox.style.display = '';
    const cc = ccOf.get(cSel.value);
    const here = regions.filter((r) => r.country_code === cc)
      .sort((a, b) => a.name.localeCompare(b.name));

    const nameInput = el('input', {
      type: 'text', autocomplete: 'off', 'aria-label': 'City or town',
      placeholder: 'City or town',
    });
    const regionSel = here.length
      ? el('select', { 'aria-label': 'State or province' },
        [el('option', { value: '', text: 'State…' }),
          ...here.map((r) => el('option', { value: r.code, text: `${r.name} (${r.code})` }))])
      : null;
    const go = el('button.btn', { type: 'button', text: 'Add it' });
    const status = el('span.muted', { style: 'font-size:12px;' });

    addBox.append(
      el('p.muted', {
        style: 'font-size:11.5px;margin:0 0 6px;',
        text: here.length
          ? `Adding a town in ${cSel.value}. Pick the state so it isn’t confused with a town of the same name somewhere else.`
          : `Adding a town in ${cSel.value}. Everyone will be able to pick it.`,
      }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' },
        [nameInput, regionSel, go, status].filter(Boolean)),
    );

    go.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (name.length < 2) { status.textContent = 'Give it a name.'; return; }
      if (regionSel && !regionSel.value) { status.textContent = 'Pick the state.'; return; }
      go.disabled = true; status.textContent = 'Adding…';

      // The centre of the state, not of the town: it puts the map dot in the right
      // state instead of the wrong one. Degrees come from city NAMES, never from
      // coordinates, so an approximate point costs nothing but map precision.
      const centre = regions.find((r) => r.country_code === cc && r.code === regionSel?.value);
      const { data, error } = await supabase.from('cities').insert({
        name,
        country_code: cc,
        admin1: regionSel?.value || null,
        region: regionSel?.value || null,
        latitude: centre?.latitude ?? null,
        longitude: centre?.longitude ?? null,
        population: 0,
      }).select('id,name,admin1,region,country_code,latitude,longitude,population').single();

      if (error) {
        const dup = (error.message || '').match(/ALREADY_LISTED\|([^|]*)\|([^|]*)/);
        status.textContent = dup
          ? `${dup[1]}${dup[2] ? `, ${dup[2]}` : ''} is already listed — pick it from the list.`
          : friendlyDbError(error, 'add that city');
        go.disabled = false;
        return;
      }

      tellPaul();
      // Put it in the per-country cache so it survives switching country and back.
      cities = await citiesIn(cc);
      cities.push(data);            // the cached array, so it survives switching country
      const opt = cityOption(data.name, data.region || '');
      citySel.appendChild(opt);
      citySel.value = data.name;
      opt.selected = true;
      addBox.style.display = 'none'; addBox.innerHTML = '';
      citySel.dispatchEvent(new Event('change'));
    });
    nameInput.focus();
  }

  citySel.addEventListener('change', () => {
    if (citySel.value === CITY_OTHER) { showAllCities(); onPick(null); return; }
    if (citySel.value === CITY_NEW) { showAddCity(); onPick(null); return; }
    resetSchools();
    sSel.disabled = !citySel.value;
    onPick(null);
    if (!citySel.value) return;

    const rg = cityRegion();
    const here = schools.filter((r) => r.country === cSel.value && r.city === citySel.value
      && sameRegion(r.region || '', rg));
    here.forEach((r) => sSel.appendChild(el('option', { value: r.id, text: r.name })));
    sSel.appendChild(el('option', { value: SCHOOL_NEW, text: '+ My school isn’t listed…' }));

    const guessed = here.filter((r) => r.city_source === 'fallback-largest-city').length;
    note.textContent = here.length
      ? (guessed
        ? `${here.length} here. ${guessed} were filed under ${citySel.value} because the source list didn’t say which city.`
        : `${here.length} school${here.length === 1 ? '' : 's'} in ${citySel.value}.`)
      : `No schools listed in ${citySel.value} yet — add yours.`;
    // Apply the pre-filled values ONCE. Re-applying them on every change would
    // re-select a stale school when someone edits a posting's country or city.
    if (initial.school_id) {
      const sid = initial.school_id;
      initial.school_id = null;
      sSel.value = String(sid);
      if (sSel.value === String(sid)) onPick(Number(sid));
    }
  });

  // ── Adding a school ───────────────────────────────────────────────────────
  function showAddSchool() {
    addBox.innerHTML = '';
    addBox.style.display = '';
    // No example name here. This box used to say "Escola Americana de Campinas" —
    // Paul's own school — and Linda read the grey text as a prefilled value:
    // "When I try to add a school it's prefilled with your Brazilian school."
    // The hint asks for what Dee asked for instead: the full name, not an acronym.
    const nameInput = el('input', {
      type: 'text', autocomplete: 'off', 'aria-label': 'School name',
      placeholder: 'Full name, not an abbreviation',
    });
    const go = el('button.btn', { type: 'button', text: 'Add it' });
    const status = el('span.muted', { style: 'font-size:12px;' });
    addBox.append(
      el('p.muted', { style: 'font-size:11.5px;margin:0 0 6px;', text: `Adding a school in ${citySel.value}, ${cSel.value}. Everyone will be able to pick it.` }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [nameInput, go, status]),
    );

    // Near matches, shown BEFORE anything is created. "International School of
    // Choueifat, Lahore" was added on 20 Sep and filed under Lebanon while
    // "International School Choueifat", Lahore, PAKISTAN was already listed —
    // and a trailing ", Lahore" was enough that no automatic check saw it. A
    // duplicate school turns same-school colleagues from degree 1 into degree
    // 3, silently, which is the most expensive mistake this database can make.
    const maybe = el('div', { style: 'margin-top:8px;' });
    addBox.appendChild(maybe);
    let dismissed = false;
    const askFirst = async (name) => {
      maybe.innerHTML = '';
      if (dismissed || name.length < 3) return false;
      const { data } = await supabase.rpc('schools_like', { p_name: name, p_country: cSel.value });
      const hits = (data || []).slice(0, 5);
      if (!hits.length) return false;
      maybe.appendChild(el('p', {
        style: 'font-size:12.5px;margin:0 0 6px;font-weight:600;',
        text: hits.length === 1 ? 'Is it this one?' : 'Is it one of these?',
      }));
      hits.forEach((h) => {
        const b = el('button.focus-row', { type: 'button' });
        b.appendChild(el('span', {
          html: `<strong>${h.name}</strong><br><small class="muted">${h.city || ''}`
            + `${h.city && h.country ? ', ' : ''}${h.country || ''}</small>`,
        }));
        b.addEventListener('click', () => {
          const row = schools.find((r) => r.id === h.id);
          if (row) { selectSchool(row); addBox.style.display = 'none'; note.textContent = `Picked ${h.name}.`; }
        });
        maybe.appendChild(b);
      });
      const no = el('button.btn', {
        type: 'button', text: 'No — mine is different, add it',
        style: 'margin-top:6px;font-size:12.5px;',
      });
      no.addEventListener('click', () => { dismissed = true; maybe.innerHTML = ''; go.click(); });
      maybe.appendChild(no);
      return true;
    };

    go.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (name.length < 2) { status.textContent = 'Give it a name.'; return; }
      status.textContent = '';
      if (await askFirst(name)) return;      // they answer, then this runs again
      go.disabled = true; status.textContent = 'Adding…';

      const cc = ccOf.get(cSel.value);
      const rg = cityRegion();
      // Match the region too, or a school in Annandale MN takes Annandale VA's
      // coordinates — which is exactly the bug this is fixing.
      const city = (await citiesIn(cc).catch(() => []))
        .find((c) => c.name === citySel.value && (c.region || '') === rg);
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase.from('schools').insert({
        name,
        city: citySel.value,
        region: rg || null,
        country: cSel.value,
        country_code: cc || null,
        latitude: city?.latitude ?? null,
        longitude: city?.longitude ?? null,
        city_source: 'manual',
        // The city was picked from the gazetteer by somebody who WORKED there,
        // which is the strongest evidence this database has. Left null, as it
        // was, the city is treated as unknown and degrees 3 and 4 can never
        // form from it — seven schools added on 20 Sep were all in that state.
        city_confidence: 'high',
        is_verified: false,
        added_by: user.id,
      }).select('id,name,city,region,country,country_code,city_source').single();

      if (error) {
        const m = error.message || '';
        const dup = m.match(/ALREADY_LISTED\|([^|]*)\|([^|]*)/);
        if (dup) {
          // It exists — possibly filed under a different city than the one being
          // looked at. Take them straight to it rather than saying "pick it from
          // the list" about a list where it doesn't appear.
          const existing = schools.find((r) => r.country === cSel.value && r.name === dup[1]);
          if (existing) {
            selectSchool(existing);
            note.textContent = `That school is already listed as “${existing.name}”`
              + (existing.city ? `, filed under ${existing.city}` : '') + ' — selected it for you.';
            go.disabled = false;
            return;
          }
          status.textContent = `Already listed as “${dup[1]}”${dup[2] ? ` under ${dup[2]}` : ''}.`;
        } else {
          status.textContent = friendlyDbError(error, 'add that school');
        }
        go.disabled = false;
        return;
      }
      // `schools` IS the array the catalogue promise resolved to, so pushing
      // into it updates the cache. There used to be an assignment to a
      // `_schools` that does not exist; in a module that is a ReferenceError,
      // and it threw right here - after the school had been created but before
      // the option was added, the school selected, or the box closed. Whoever
      // added a school saw nothing happen and no error.
      schools.push(data);
      tellPaul();
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

  // Drive the cascade to one specific school. The change handlers are synchronous
  // (everything is in memory), so each step's options exist before the next.
  function selectSchool(row) {
    cSel.value = row.country;
    cSel.dispatchEvent(new Event('change'));
    const rg = row.region || '';
    // Match on region too: two options can legitimately share a city name now.
    let opt = [...citySel.options].find((o) => o.value === row.city && (o.dataset.region || '') === rg);
    if (row.city && !opt) {
      opt = cityOption(row.city, rg);
      citySel.insertBefore(opt, citySel.lastElementChild);
    }
    if (opt) opt.selected = true; else citySel.value = '';
    citySel.dispatchEvent(new Event('change'));
    sSel.value = String(row.id);
    onPick(row.id);
    addBox.style.display = 'none';
  }

  const fold = (x) => (x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const closeResults = () => { results.hidden = true; results.innerHTML = ''; };
  search.addEventListener('input', () => {
    const terms = fold(search.value).split(/\s+/).filter((t) => t.length > 1);
    results.innerHTML = '';
    if (!terms.length) { closeResults(); return; }
    const inCountry = cSel.value && cSel.value !== '';
    const hits = schools
      .filter((r) => !inCountry || r.country === cSel.value)
      .filter((r) => { const h = fold(`${r.name} ${r.city} ${r.region || ''} ${r.country}`); return terms.every((t) => h.includes(t)); })
      .slice(0, 12);
    if (!hits.length) {
      results.appendChild(el('div.school-result.empty', {
        text: inCountry ? `Nothing matching in ${cSel.value}. Pick a city below and add it.` : 'Nothing matching. Pick a country and city below and add it.',
      }));
    }
    hits.forEach((r) => {
      const row = el('button.school-result', { type: 'button' }, [
        el('strong', { text: r.name }),
        el('small', { text: [r.city, r.region, r.country].filter(Boolean).join(', ') }),
      ]);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectSchool(r);
        search.value = '';
        closeResults();
        note.textContent = `Selected ${r.name} (${[r.city, r.region, r.country].filter(Boolean).join(', ')}).`;
      });
      results.appendChild(row);
    });
    results.hidden = false;
  });
  search.addEventListener('blur', () => setTimeout(closeResults, 150));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; closeResults(); } });

  wrap._selectSchool = selectSchool;
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
    country: posting?._country, city: posting?._city, region: posting?._region,
    school_id: posting?.school_id,
  }));

  const roleSel = el('select', { 'aria-label': 'Role' },
    ROLES.map((r) => el('option', { value: r, text: r, selected: r === state.role ? 'selected' : null })));
  roleSel.addEventListener('change', () => { state.role = roleSel.value; });

  // Month and year as a pair on ONE line, not stacked.
  //
  // They used to be a vertical column each — the label, then the month, then the
  // year underneath — so "STARTED / September / 2011" ran downwards while "ENDED"
  // ran downwards beside it, and the two years ended up on a line of their own
  // with nothing saying what they were. Paul, 19 Sep 2026: read it left to right.
  const ymPair = (label, onChange, val) => {
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
    return { m, y };
  };

  const started = ymPair('Started', (v) => { state.start = v; }, state.start);
  const ended = ymPair('Ended', (v) => { state.end = v; }, state.end);

  const curCb = el('input', { type: 'checkbox', autocomplete: 'off' });
  const remove = el('button.btn.ghost', { type: 'button', text: 'Remove' });
  remove.addEventListener('click', () => onRemove(row));

  // Three lines, in the order somebody fills them in.
  const line1 = el('div.pw-line', {}, [
    el('span.pw-label', { text: 'Role' }), roleSel,
    el('span.pw-label', { text: 'Started' }), started.m, started.y,
  ]);
  const line2 = el('div.pw-line', {}, [
    el('span.pw-label', { text: 'Ended' }), ended.m, ended.y,
  ]);
  const line3 = el('div.pw-line', {}, [
    el('label.still-here', {}, [curCb, ' I’m still here']),
    el('span', { style: 'margin-left:auto;' }, [remove]),
  ]);

  if (state.current) { curCb.checked = true; line2.style.display = 'none'; }
  curCb.addEventListener('change', () => {
    state.current = curCb.checked;
    line2.style.display = curCb.checked ? 'none' : '';
    if (curCb.checked) state.end = '';
  });

  row.append(el('div.posting-when', {}, [line1, line2, line3]));
  return row;
}

// ── Draft autosave ──────────────────────────────────────────────────────────
// This form is long, and the two ways out of it — a reload, or a sign-in that
// expired while you were typing — both used to throw the lot away. Keep a draft
// locally so neither does. It never leaves the browser.
// Paul hears the same day about anything a member had to add themselves.
// Best-effort on purpose: the log is written by a trigger in Postgres and
// cannot be skipped, so a mail server having a bad minute costs a notification,
// never the addition — and never the member's place in the form.
async function tellPaul() {
  try {
    const { data } = await supabase.rpc('my_latest_addition');
    if (data) await supabase.functions.invoke('notify-addition', { body: { id: data } });
  } catch { /* the trigger already recorded it; tools/additions.sh will show it */ }
}

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
        ? 'This is the real thing now, so only what the map actually needs. Everyone in the group sees your <strong>first and last name</strong>, where you’ve worked and when. <strong>Nobody ever sees your email address.</strong>'
        : 'Edit your history. Connections recompute the moment you save.',
    }),
  ]));

  // identity
  //
  // NO EXAMPLE VALUES in these boxes. They used to be placeholder:'Paul' and
  // placeholder:'Morgan', and on 13-14 Sep Linda and Dee both reported Paul's name
  // "autofilled" into their own form. It was never autofill: it was grey example
  // text that reads exactly like a filled field. Labels say what each box is, so
  // an example earns nothing and costs confusion.
  const first = el('input', {
    type: 'text', required: 'required', autocomplete: 'off', value: profile?.first_name || '',
  });
  // Full last name. Someone who registered while only an initial was asked for has
  // last_name = null; the box starts empty and says why.
  const lastName = el('input', {
    type: 'text', maxlength: '80', autocomplete: 'off', value: profile?.last_name || '',
  });
  const hadOnlyInitial = !!(profile && !profile.last_name && profile.last_initial);
  // Dee, 14 Sep 2026: "could we add a 'commonly used name' field? Like my name is
  // Deanna but 99% of the world knows me as Dee." Optional; when set it replaces
  // the first name everywhere the app shows a name.
  const preferred = el('input', {
    type: 'text', maxlength: '60', autocomplete: 'off', value: profile?.preferred_name || '',
  });

  const who = el('div.card');
  append(who,
    el('h4', { text: 'You' }),
    el('div.controls', {}, [
      el('div.control-group', {}, [el('label', { text: 'First name' }), first]),
      el('div.control-group', {}, [el('label', { text: 'Last name' }), lastName]),
      el('div.control-group', {}, [
        el('label', { text: 'Goes by (optional)' }), preferred,
        el('small.muted', { style: 'font-size:11px;', text: 'If people know you by another name — Deanna who goes by Dee.' }),
      ]),
    ]),
    hadOnlyInitial
      ? el('p.auth-msg', { style: 'margin:6px 2px 0;', text: `We now ask for your full last name — until you add it you show as “${profile.display_name}”.` })
      : null,
    emailBlock(user),
  );
  root.appendChild(who);

  root.appendChild(messagePrefs());
  root.appendChild(finalDestination(profile));

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
    first: first.value, last: lastName.value, preferred: preferred.value,
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
        first.value = d.first || ''; lastName.value = d.last || '';
        preferred.value = d.preferred || '';
        // Postings need their school ids resolved back to country/city to re-populate
        // the cascade, so rebuild from the catalogue.
        const cat = await schoolCatalogue().catch(() => []);
        const byId = new Map(cat.map((x) => [x.id, x]));
        (d.postings || []).filter((p) => p.school_id || p.start).forEach((p) => {
          const sc = byId.get(p.school_id);
          addRow({
            school_id: p.school_id, role: p.role,
            start_date: p.start, end_date: p.current ? null : p.end,
            _country: sc?.country, _city: sc?.city, _region: sc?.region,
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
      .select('id, school_id, role, start_date, end_date, schools(name, city, region, country)')
      .eq('profile_id', profile.id)
      .order('start_date');
    if (data?.length) {
      data.forEach((p) => addRow({ ...p,
        _country: p.schools?.country, _city: p.schools?.city, _region: p.schools?.region }));
    } else addRow();
  })();

  save.addEventListener('click', async () => {
    status.className = 'auth-msg';
    const f = first.value.trim();
    if (!f) { status.className = 'auth-msg error'; status.textContent = 'First name is required.'; return; }
    if (!lastName.value.trim()) {
      status.className = 'auth-msg error';
      status.textContent = 'Last name is required.';
      lastName.focus();
      return;
    }

    // A HALF-FILLED ROW IS NOT SILENTLY THROWN AWAY.
    //
    // This used to be `.filter(s => s.school_id && s.start)` — anything missing a
    // school or a start date simply vanished at save time, with nothing said.
    // Sarah entered three postings on 13 Sep and two arrived; she told the group
    // "probably user error" and blamed herself. It was not: her Addis row lost its
    // school (most likely while the school list was still loading, which used to
    // take 37 sequential requests) and the save discarded it without a word. She
    // has been the only member with no current posting ever since.
    //
    // A row nobody has touched is fine to ignore. A row somebody started and did
    // not finish must stop the save and say which one.
    const all = [...rows.children].map((r, i) => ({ r, i, st: r._state }));
    const touched = all.filter(({ st }) => st.school_id || st.start || st.end || st.current);
    const incomplete = touched.filter(({ st }) => !st.school_id || !st.start);

    all.forEach(({ r }) => r.classList.remove('row-problem'));
    if (incomplete.length) {
      incomplete.forEach(({ r }) => r.classList.add('row-problem'));
      incomplete[0].r.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const which = incomplete.map(({ i }) => `#${i + 1}`).join(', ');
      const missing = !incomplete[0].st.school_id ? 'a school' : 'a start date';
      status.className = 'auth-msg error';
      status.textContent = incomplete.length === 1
        ? `Posting ${which} still needs ${missing}. Nothing has been saved.`
        : `Postings ${which} are missing a school or a start date. Nothing has been saved.`;
      return;
    }

    const wanted = touched.map(({ st }) => st);
    if (!wanted.length) {
      status.className = 'auth-msg error';
      status.textContent = 'Add at least one posting — a school and a start date.';
      return;
    }
    const badIdx = touched.findIndex(({ st }) => !st.current && !st.end);
    if (badIdx >= 0) {
      touched[badIdx].r.classList.add('row-problem');
      touched[badIdx].r.scrollIntoView({ block: 'center', behavior: 'smooth' });
      status.className = 'auth-msg error';
      status.textContent = `Posting #${touched[badIdx].i + 1} needs an end date, or “I’m still here” ticked.`;
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
        p_last_name: lastName.value.trim(),
        p_preferred_name: preferred.value.trim() || null,
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
      // What they typed is kept in the draft, so it's safe to tell them to reload.
      status.textContent = friendlyDbError(err, 'save your details');
      save.disabled = false;
      save.textContent = isNew ? 'Join 6 Degrees' : 'Save changes';
    }
  });

  return root;
}
