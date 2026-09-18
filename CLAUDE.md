# 6 Degrees — Claude Code session protocol

**Read this whole file before doing anything in this repo.** It is loaded
automatically at the start of every session. It exists so that every session
follows up on errors and maintains the site the same way.

## What this is

A professional network for international school teachers. People are connected by
**relationship degree**, derived only from shared place and time:

| | same time | different time |
|---|---|---|
| same school | **1** | **2** |
| same city   | **3** | **4** |
| same country| **5** | **6** |

For a pair, the strongest (lowest) degree across all their postings wins. **The six
degrees are fixed** (Paul's rule). A mutually approved tag adds an *acknowledged*
connection alongside; it never changes a degree.

- **Live site:** https://edgeoinnovations-resources.github.io/6DegreesBeta/ (GitHub Pages, `main`, repo root)
- **Backend:** Supabase project `tyukcebfecdwnnbrjbvr` (free tier, ap-southeast-2)
- **Client:** buildless ES modules, no bundler. `js/loadData.js` is the only data layer.
- **Owner:** Paul. Beta group: Paul, Linda, Dee, Sarah, Dave, Melissa (+ Robb). Invite only.

**The database holds REAL people's career histories.** The GitHub repo is PUBLIC.

---

## 1. Start of every session — in this order

1. **Run the health check.** It is read-only and takes about two minutes.
   ```bash
   bash tools/healthcheck.sh
   ```
   If section 1 says the CLI isn't logged in, stop and ask Paul to run
   `~/.local/bin/supabase login` **in a separate Terminal window**. It needs a real TTY
   and fails inside Claude Code's `!` bash mode.

2. **Review member-reported errors.**
   ```bash
   bash tools/errors.sh            # grouped, most recent first
   bash tools/errors.sh code <C>   # every occurrence of one code, with stacks
   ```

3. **Tell Paul what you found before starting new work.** Cover open errors, any
   FAIL or WARN lines, and new members. Fix errors before building features unless
   he says otherwise.

## 2. Fixing a reported error

1. Read every occurrence: `bash tools/errors.sh code <C>`. Note the `view`, `build` and stack.
2. Check the `build`. If it's older than the current one, the bug may already be fixed.
   Confirm it still reproduces before changing anything.
3. **Reproduce it in the database as the real role**, never as `postgres`, which
   bypasses RLS. Use a transaction you roll back:
   ```sql
   begin;
   select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true);
   set local role authenticated;
   -- the failing operation
   rollback;
   ```
4. Fix the root cause, deploy (§4), and verify on the live site.
5. Close it: `bash tools/errors.sh resolve <code> "what fixed it"`.

## 3. Hard rules

- **Never write a member's email address** into a migration, commit, file or command
  output. Mask emails when querying: `left(email,2)||'***@'||split_part(email,'@',2)`.
  The pre-commit hook blocks real-looking addresses. Never bypass it with `--no-verify`.
- **Never run `supabase config push`.** It compares against the CLI's built-in
  defaults, and against this project it tried to disable MFA and Twilio SMS. Auth
  settings are changed in the Supabase dashboard by Paul.
- **Never commit a `service_role` key or DB password.** The anon key in `js/config.js`
  is public by design. RLS is what protects the data.
- **Ask Paul before changing a real member's data** (merging schools, editing
  postings, deleting anything). Diagnostic test rows must be deleted afterwards
  and confirmed gone.
- **Test RLS with data present.** An empty result looks identical to a correctly
  denied one. That is how a leaking view nearly shipped.
- **Every new view needs `with (security_invoker = true)`.** Every new function
  gets an explicit `grant execute` to only the roles that need it, because
  functions are not executable by default here.
- **Never re-derive degrees in the client.** One implementation lives in Postgres:
  `recompute_for_profile`, run by triggers on `postings` and `schools`.

## 4. Deploying a change

**Client (`js/`, `css/`, `index.html`):**
```bash
bash tools/stamp-build.sh          # writes the build time into js/config.js
git add -A && git commit           # the privacy hook runs here
git push origin main
```
Then verify the change is actually live. Pages caches JS for about 10 minutes and
ignores `?v=` cache busting:
```bash
curl -s -H "Cache-Control: no-cache" "https://edgeoinnovations-resources.github.io/6DegreesBeta/js/config.js" | grep BUILD
```
Tell members to hard-refresh (⌘⇧R). The build stamp is at the bottom of the name
menu and on the sign-in screen. Ask for it whenever someone reports a bug.

**Database:**
1. Add `supabase/migrations/<YYYYMMDDHHMMSS>_<what>.sql`. Never edit an applied migration.
2. Test it against a local scratch database first when it touches RLS, grants or
   triggers:
   ```bash
   bash tools/scratch-db.sh          # throwaway Postgres, every migration applied
   psql -h /tmp/6dpg -p 55433 -U postgres -d sixdeg
   bash tools/scratch-db.sh stop
   ```
   It stubs `auth.users`, `auth.uid()`, `auth.role()`, `auth.jwt()` and the four
   roles. Inside it, **test as the real role, never as `postgres`**, which bypasses
   RLS — see §2.3 for the `set_config` incantation. A test member needs an invite
   row *before* the `auth.users` row, or the invite-only trigger rejects it.
3. `~/.local/bin/supabase db push`
4. Re-run `bash tools/healthcheck.sh`. Sections 5 and 6 catch security and integrity regressions.

**Testing in a browser:** headless `--dump-dom` snapshots the page before ES modules
load, so it can't tell a broken page from an unfinished one. Drive Chrome over CDP
instead, or use the Claude in Chrome extension if it's connected. You cannot sign
in as a member, so say plainly which UI paths you verified and which you didn't.

## 5. Regular maintenance

**Every session:** §1.

**Before any migration that touches real data, and weekly:**
```bash
bash tools/backup.sh          # writes to ~/6DegreesBackups, never the repo
bash tools/backup.sh --list
```
The free tier gives no downloadable backups and `supabase db dump` needs Docker,
which isn't installed here — this goes through the authenticated CLI instead. It
saves only what the migrations cannot rebuild; `colleagueships` and
`shared_contexts` are derived and restored with `select public.recompute_all();`.
Each backup carries a RESTORE.md. **It cannot save `auth.users`**, so a restore
means re-inviting everyone and remapping profile ids — read the RESTORE.md before
relying on it.

**Weekly, or before the group tests:**
- **Project paused?** The free tier pauses after 7 idle days. The health check shows
  it; Paul restores it from the dashboard.
- **Member-added schools** (health check §6): check each for spelling, correct city,
  and near-duplicates. Mark good ones `is_verified = true`. Merge duplicates only
  with Paul's yes.
- **Duplicate schools** must be zero. A duplicate silently turns same-school
  colleagues from degree 1 into degree 3.
- **Integrity:** if §6 reports contradictory degrees, run `select public.recompute_all();`
  and find out what bypassed the triggers.
- **Invites:** people who were invited but never signed in may need a nudge or the
  right address.

**When something breaks sign-in email:** email goes through Gmail SMTP from the EdGeo
Innovations Gmail account using a Google **app password**. Changing that account's
password revokes the app password and silently stops all sign-in emails. The fix is
a new app password, entered by Paul in Supabase → Authentication → Emails → SMTP.

## 6. Accepted advisor findings (baseline, 13 Sep 2026)

The health check fails only on findings **not** listed here:

- `authenticated_security_definer_function_executable`: `save_my_profile`, `ghost_me`,
  `is_member`. These are intentional: the app calls the first two, and RLS policies call the third.
- `auth_leaked_password_protection`: not applicable, because sign-in is magic link only.
- `rls_auto_enable`: managed by Supabase, not ours.
- **Performance only:** `auth_rls_initplan` and `multiple_permissive_policies`. These
  are irrelevant at this scale. Revisit if membership reaches the hundreds.

To accept a new finding, get Paul's agreement, then add it here **and** to the
`accepted` set in `tools/healthcheck.sh`.

## 7. Where things are

| Path | What |
|---|---|
| `supabase/migrations/` | the schema, in order. Read the headers — they explain each decision |
| `js/supabaseClient.js` | client, `friendlyDbError`, `logError`, global error handlers |
| `js/auth.js`, `js/onboarding.js` | magic-link gate; registration and "Your details" |
| `js/loadData.js` | the only data layer |
| `js/views/egoGraph.js` | the Connections rings. See the README for why the geometry is what it is |
| `js/tags.js`, `js/connectionsInbox.js`, `js/personCard.js` | tags, notes, the Connections icon, the click-for-details card |
| `tools/healthcheck.sh`, `tools/errors.sh` | maintenance |
| `tools/stamp-build.sh`, `tools/install-hooks.sh` | deploy stamp; privacy pre-commit hook |
| `README.md` | design history and rationale |

The Supabase CLI binary is at `~/.local/bin/supabase` (Homebrew can't install it on this Mac).
Query with `supabase db query "<sql>" --linked`. Output is JSON; parse from the first `{`.

## 8. Known open items

Not bugs. These are decisions and gaps, so raise them with Paul rather than acting on them alone:

- **Backups are manual.** `bash tools/backup.sh` (§5). Nothing runs it on a schedule, and it
  cannot capture `auth.users` — a real restore means re-inviting everyone and remapping ids.
- **Governance of the school list** (Dave): who may edit or delete schools? Members can currently only add.
- **Delhi vs New Delhi**, and other metro splits: two city names for one place turn a
  degree 3 into a degree 5.
- School search matches words in the name, not acronyms: "AES" finds nothing, "embassy" does.
- In-app contact between members is **deliberately not built** (June meeting: liability).
  `contact_requests` exists in the schema but has no UI.
- The "confirmed connection" inner ring was built as the alternative to Paul's 3D ego
  graph idea. His verdict on it is still pending.

## 9. Reporting back to Paul

Plain language. Say what you verified and how, and what you could not verify. Name
mistakes you made plainly. When a member hits a problem, ask for the exact message
and the build stamp; a description alone isn't enough.
