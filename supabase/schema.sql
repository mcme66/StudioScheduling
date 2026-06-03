-- Lesson Scheduling: run once in Supabase SQL Editor
-- Dashboard → SQL → New query → paste → Run

create table if not exists public.schedule (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.schedule (id, data)
values (
  'main',
  '{
    "slots": {
      "Monday": [],
      "Tuesday": [],
      "Wednesday": [],
      "Thursday": [],
      "Friday": []
    },
    "bookings": {},
    "pending": []
  }'::jsonb
)
on conflict (id) do nothing;

alter table public.schedule enable row level security;

-- No public RLS policies: only the server (service_role key) reads/writes this table.
