-- infernoflow Supabase schema
-- Paste this into your Supabase project → SQL Editor → Run.
--
-- This schema matches what is currently deployed to the canonical infernoflow
-- Supabase project. It supports two write paths:
--
--   1. Anonymous-token writes (current default) — the CLI runs `infernoflow log`,
--      derives a stable `user_token` from the user's GitHub identity, and POSTs
--      with the public anon key. `user_id` stays NULL. RLS is permissive enough
--      to allow this. This is the path used today; it works fine for a solo
--      project but exposes inserts to anyone with the anon key.
--
--   2. Authenticated writes (future) — pass a Supabase JWT instead of the anon
--      key. `user_id` is set from `auth.uid()` and the per-user RLS policy
--      restricts reads/writes. This path is currently dormant; the policy is
--      preserved so flipping the switch later is a CLI-only change.
--
-- See lib/cloud/supabase.mjs `pushEntry` for the matching client code.

-- Enable UUID extension (usually already on)
create extension if not exists "pgcrypto";

-- ── entries table ─────────────────────────────────────────────────────────────
create table if not exists entries (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users,                    -- NULL for anon-token writes
  user_token  text,                                                 -- stable per-user identifier (GitHub id), set by CLI
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

-- ── Row-level security ────────────────────────────────────────────────────────
-- RLS is enabled, but the policy below only matches authenticated writes
-- (auth.uid() = user_id). Anonymous-token writes bypass it because user_id
-- is NULL on insert; this is intentional for the current single-user model.
-- When moving to fully authenticated mode, drop the anon write privilege
-- on this table at the role level (Supabase Studio → Database → Tables →
-- entries → grant settings).
alter table entries enable row level security;

-- Authenticated users can read/write their own entries.
drop policy if exists "Users own their entries" on entries;
create policy "Users own their entries"
  on entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anyone with the anon key can insert (current dev mode).
-- Remove this policy when switching to authenticated-only writes.
drop policy if exists "Anon can insert (dev mode)" on entries;
create policy "Anon can insert (dev mode)"
  on entries for insert
  to anon
  with check (true);

-- ── team_members table (reserved for future team-sync feature) ────────────────
-- Kept as a stub so the schema is forward-compatible. The CLI does not write to
-- this table yet — wiring lives behind a future `infernoflow team-sync` command.
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
-- Reserved for Sprint 2 team sharing. Currently just a passthrough.
create or replace view project_entries as
  select e.*, tm.project_id as team_project_id
  from entries e
  left join team_members tm
    on tm.user_id = e.user_id and tm.project_id = e.project_id;

-- ── indexes ───────────────────────────────────────────────────────────────────
-- Lookup by user_token (anon-mode) and by authenticated user_id.
create index if not exists entries_user_token_project
  on entries (user_token, project_id, ts desc);

create index if not exists entries_user_id_project
  on entries (user_id, project_id, ts desc);

create index if not exists entries_type
  on entries (type, ts desc);

create index if not exists entries_project_ts
  on entries (project_id, ts desc);
