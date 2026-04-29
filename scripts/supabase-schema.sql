-- infernoflow Supabase schema
-- Paste this into your Supabase project → SQL Editor → Run

-- Enable UUID extension (usually already on)
create extension if not exists "pgcrypto";

-- ── entries table ─────────────────────────────────────────────────────────────
create table if not exists entries (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users not null,
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
alter table entries enable row level security;

-- Users can only read/write their own entries
create policy "Users own their entries"
  on entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── team_members table ────────────────────────────────────────────────────────
-- (for Sprint 2 — team sharing)
create table if not exists team_members (
  id          uuid default gen_random_uuid() primary key,
  project_id  text not null,
  user_id     uuid references auth.users not null,
  role        text not null default 'member',  -- owner | member
  joined_at   timestamptz default now(),
  unique (project_id, user_id)
);

alter table team_members enable row level security;

-- Team members can see who else is on their project
create policy "Team members can read their project"
  on team_members for select
  using (auth.uid() = user_id);

-- ── project_entries view ───────────────────────────────────────────────────────
-- (will expand in Sprint 2 — lets teammates see shared entries)
-- For now just a passthrough view
create or replace view project_entries as
  select e.*, tm.project_id as team_project_id
  from entries e
  left join team_members tm
    on tm.user_id = e.user_id and tm.project_id = e.project_id;

-- ── indexes ───────────────────────────────────────────────────────────────────
create index if not exists entries_user_project
  on entries (user_id, project_id, ts desc);

create index if not exists entries_type
  on entries (type, ts desc);
