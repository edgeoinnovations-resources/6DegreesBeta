// config.js — public configuration.
//
// These two values are PUBLIC BY DESIGN. The anon key is a JWT that says nothing
// more than "an anonymous caller of this project"; it ships to every browser that
// loads the site and appears in the network tab. What protects the data is Row
// Level Security in the database, not secrecy here.
//
// Verified 13 Sep 2026: with this key and no session, every table and view in the
// project returns `42501 permission denied`.
//
// The service_role key is a different matter entirely — it bypasses RLS. It must
// never appear in this repo, in this file, or in anything the browser loads.
export const SUPABASE_URL = 'https://tyukcebfecdwnnbrjbvr.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5dWtjZWJmZWNkd25uYnJqYnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTE4MjIsImV4cCI6MjA5NTEyNzgyMn0.5EdE_QL2mqy2mK6JdZFydaPLmDn2h6vGEewXV3BL60c';

// Where magic links come back to. Must match a redirect URL allowed in the
// dashboard under Authentication → URL Configuration, or the link bounces.
export const REDIRECT_URL = `${location.origin}${location.pathname}`;

// Build stamp, shown in the header. GitHub Pages caches JS for ~10 minutes, so
// after a deploy a browser can be running a MIX of old and new modules — which
// makes "did my fix reach you?" unanswerable without it. Updated by
// tools/stamp-build.sh on every commit.
export const BUILD = '13 Sep 12:38 UTC';
