-- infernoflow Supabase schema
-- Paste this into your Supabase project → SQL Editor → Run.
--
-- This schema is idempotent — safe to re-run as the schema evolves.
--
-- ── Auth model (v0.40+) ─────────────────────────────────────────────────
-- Two coexisting write paths, transparently selected by the CLI:
--
--   1. Authenticated (preferred, post `infernoflow login`)
--      The CLI POSTs with the user's Supabase JWT in Authorization. user_id
--      is set server-side from the auth.uid() default. The "Users own their
--      entries" RLS policy is enforced.
--
--   2. Anon-token (fallback; legacy + `infernoflow login --device-flow`)
--      The CLI POSTs with the public anon key, sending a `user_token` text
--      column derived from the user's GitHub identity. Allowed by the
--      explicit "Anon can insert (dev mode)" policy. Fine for solo dev,
--      not a security boundary.
--
-- To force authenticated-only, drop the dev-mode policy:
--   drop policy "Anon can insert (dev mode)" on entries;
--
-- For setup outside the canonical project: also enable the GitHub auth
-- provider in Authentication → Providers, and add http://localhost:47655
-- (and the rest of the PORT_RANGE in lib/commands/login.mjs) to the
-- Authentication → URL Configuration → Redirect URLs allow-list.

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── entries table ─────────────────────────────────────────────────────────────
create table if not exists entries (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users default auth.uid(),  -- auto-populated for authenticated writes
  user_token  text,                                                  -- anon-mode identifier (GitHub id), null for authenticated rows
  project_id  text        not null,
  ts          timestamptz not null,
  type        text        not null default 'note',
  summary     text        not null,
  result      text,
  source      text,
  auto        boolean     default false,
  agent       text,
  created_at  timestamptz default now()
);

-- If running over an older deployment that didn't have auth.uid() as the
-- column default, add it. (Idempotent.)
alter table entries alter column user_id set default auth.uid();

-- Make sure user_token exists even on older deployments.
alter table entries add column if not exists user_token text;

-- ── Row-level security ────────────────────────────────────────────────────────
alter table entries enable row level security;

-- Authenticated path: each user can read/write their own rows.
drop policy if exists "Users own their entries" on entries;
create policy "Users own their entries"
  on entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anon fallback path (dev mode). Drop this when going strict-auth-only.
drop policy if exists "Anon can insert (dev mode)" on entries;
create policy "Anon can insert (dev mode)"
  on entries for insert
  to anon
  with check (true);

-- ── team_members table (reserved for future team-sync feature) ────────────────
create table if not exists team_members (
  id          uuid default gen_random_uuid() primary key,
  project_id  text not null,
  user_id     uuid references auth.users not null,
  role        text not null default 'member',  -- owner | member
  joined_at   timestamptz default now(),
  unique (project_id, user_id)
);

alter table team_members enable row level security;

drop policy if exists "Team members can read their project" on team_members;
create policy "Team members can read their project"
  on team_members for select
  using (auth.uid() = user_id);

-- ── project_entries view ──────────────────────────────────────────────────────
-- Reserved for Sprint 2 team sharing. Currently a passthrough.
create or replace view project_entries as
  select e.*, tm.project_id as team_project_id
  from entries e
  left join team_members tm
    on tm.user_id = e.user_id and tm.project_id = e.project_id;

-- ── indexes ───────────────────────────────────────────────────────────────────
create index if not exists entries_user_id_project    on entries (user_id, project_id, ts desc);
create index if not exists entries_user_token_project on entries (user_token, project_id, ts desc);
create index if not exists entries_project_ts         on entries (project_id, ts desc);
create index if not exists entries_type               on entries (type, ts desc);
