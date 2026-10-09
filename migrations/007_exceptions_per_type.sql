-- "Moved or removed" memory is now per session type (two types may legitimately offer the same start time).
create table slot_exceptions_v2 (
  session_type_id uuid not null references session_types(id) on delete cascade,
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (session_type_id, starts_at)
);
insert into slot_exceptions_v2 (session_type_id, starts_at)
  select (select t.id from session_types t where t.season_id = e.season_id order by t.sort_order, t.created_at limit 1), e.starts_at
  from slot_exceptions e
  where exists (select 1 from session_types t where t.season_id = e.season_id)
  on conflict do nothing;
drop table slot_exceptions;
alter table slot_exceptions_v2 rename to slot_exceptions;
