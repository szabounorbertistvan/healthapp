-- HealthApp schema · 06 coaching: conversations, messages, feedback

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  client_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (coach_id, client_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

-- Polymorphic reference (decision left open in the doc, resolved in the plan §4):
-- one feedback timeline per client, one query for "needs my feedback".
create table public.coach_feedback (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  client_id uuid not null references public.users (id) on delete cascade,
  reference_type feedback_reference not null,
  reference_id uuid not null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index coach_feedback_client_idx on public.coach_feedback (client_id, created_at desc);
create index coach_feedback_ref_idx on public.coach_feedback (reference_type, reference_id);
