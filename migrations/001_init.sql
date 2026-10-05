-- Xan's Eye mini sessions: initial schema.
-- Money is integer cents. Instants are timestamptz (UTC); display timezone lives in settings.

create table app_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  mime text not null,
  bytes bytea not null,
  width int,
  height int,
  alt text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  draft jsonb not null,
  published jsonb,
  published_version int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table season_versions (
  id bigserial primary key,
  season_id uuid not null references seasons(id) on delete cascade,
  version int not null,
  content jsonb not null,
  note text,
  published_at timestamptz not null default now(),
  unique (season_id, version)
);

-- Owner-published bookable times. buffer_end = ends_at + buffer; the half-open range
-- [starts_at, buffer_end) is what no other open slot may overlap (capacity is one photographer).
create table slots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  buffer_end timestamptz not null,
  state text not null default 'open' check (state in ('open','closed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (buffer_end >= ends_at),
  constraint slots_no_overlap exclude using gist (tstzrange(starts_at, buffer_end) with &&) where (state = 'open')
);
create index slots_starts_idx on slots (starts_at);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  slot_id uuid not null references slots(id),
  season_id uuid not null references seasons(id),
  status text not null check (status in ('hold','confirmed','canceled','expired','review')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','paid','refund_pending','refunded','failed')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  buffer_end timestamptz not null,
  hold_expires_at timestamptz,
  quote jsonb not null,
  terms jsonb not null,
  claim_hash text,
  stripe_session_id text,
  stripe_payment_intent text,
  paid_cents int not null default 0,
  recovery_email text,
  recovery_email_verified boolean not null default false,
  contact_missing boolean not null default false,
  intake_version int not null default 0,
  workflow_state text not null default 'booked'
    check (workflow_state in ('booked','photographed','backed_up','selecting','editing','gallery_sent','completed')),
  checklist jsonb not null default '{}'::jsonb,
  gallery_url text,
  gallery_due date,
  owner_notes text not null default '',
  calendar_event_id text,
  calendar_version int not null default 0,
  doc_id text,
  doc_url text,
  folder_id text,
  doc_version int not null default 0,
  doc_folder_key text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  -- Only live holds and confirmed bookings occupy time. 'review' (paid but slot lost) does not.
  constraint bookings_no_overlap exclude using gist (tstzrange(starts_at, buffer_end) with &&)
    where (status in ('hold','confirmed'))
);
create index bookings_status_idx on bookings (status, starts_at);
create index bookings_session_idx on bookings (stripe_session_id);

create table intake_revisions (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  version int not null,
  data jsonb not null,
  changes jsonb not null default '[]'::jsonb,
  source text not null default 'client',
  created_at timestamptz not null default now(),
  unique (booking_id, version)
);

create table payments (
  id bigserial primary key,
  booking_id uuid not null references bookings(id),
  stripe_session_id text,
  stripe_payment_intent text,
  amount_cents int not null,
  currency text not null,
  status text not null check (status in ('paid','failed','refunded','anomaly')),
  note text,
  created_at timestamptz not null default now()
);

create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create table access_tokens (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  kind text not null check (kind in ('manage','recovery','verify_email')),
  token_hash text not null unique,
  meta jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table access_sessions (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table owner_sessions (
  id bigserial primary key,
  session_hash text not null unique,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table integrations (
  provider text primary key,
  status text not null default 'disconnected',
  account_email text,
  tokens_enc text,
  meta jsonb not null default '{}'::jsonb,
  last_error text,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Durable side-effect queue. dedupe_key makes enqueueing idempotent.
create table outbox (
  id bigserial primary key,
  kind text not null,
  booking_id uuid references bookings(id) on delete cascade,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed','blocked','canceled')),
  attempts int not null default 0,
  run_at timestamptz not null default now(),
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index outbox_due_idx on outbox (status, run_at);

create table notifications (
  id bigserial primary key,
  outbox_id bigint references outbox(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  to_addr text not null,
  subject text not null,
  body_text text not null,
  provider text not null,
  provider_id text,
  status text not null,
  created_at timestamptz not null default now()
);

create table tasks (
  id bigserial primary key,
  booking_id uuid references bookings(id) on delete cascade,
  kind text not null,
  message text not null,
  dedupe_key text unique,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  booking_id uuid,
  meta jsonb not null default '{}'::jsonb
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
