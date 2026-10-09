-- Remembers times the owner deliberately moved or removed, so re-publishing the weekly schedule (or auto-fill) never brings them back.
create table if not exists slot_exceptions (
  season_id uuid not null references seasons(id) on delete cascade,
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (season_id, starts_at)
);
