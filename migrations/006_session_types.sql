-- Session types: each type (e.g. "Mini Session", "Family Session") has its own length, price, hours, rules and link.
-- Capacity stays ONE photographer across all types (the existing overlap constraints still apply to every slot and booking).
create table session_types (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  color text not null default '#1F4D37',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_types_season_idx on session_types (season_id, sort_order);

alter table slots add column session_type_id uuid references session_types(id) on delete set null;
alter table bookings add column session_type_id uuid references session_types(id) on delete set null;
create index slots_type_idx on slots (session_type_id, starts_at);
