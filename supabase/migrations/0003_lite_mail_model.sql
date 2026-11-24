-- Marketing OS Lite: private server-only application tables.
create extension if not exists pgcrypto;
create type public.mail_campaign_status as enum ('draft','queued','sending','completed','partially_failed','failed','cancelled');

create table public.mail_settings (
  id boolean primary key default true check (id), sender_name text not null, from_email text not null, reply_to text,
  company_name text not null, physical_address text not null, resend_api_key_ciphertext text not null,
  webhook_secret_ciphertext text not null, verified_domain text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.mail_contacts (
  id uuid primary key default gen_random_uuid(), email text not null, normalized_email text generated always as (lower(trim(email))) stored,
  name text, consent_source text not null, consented_at timestamptz not null, imported_at timestamptz not null default now(),
  unique(normalized_email)
);
create table public.mail_suppressions (
  id uuid primary key default gen_random_uuid(), normalized_email text not null unique, reason text not null,
  source text not null, created_at timestamptz not null default now()
);
create table public.mail_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null, sender_name text not null, from_email text not null,
  reply_to text, subject text not null, preheader text, content_html text, content_text text, status public.mail_campaign_status not null default 'draft',
  total_count integer not null default 0, accepted_count integer not null default 0, delivered_count integer not null default 0,
  opened_count integer not null default 0, clicked_count integer not null default 0, failed_count integer not null default 0, blocked_count integer not null default 0,
  created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz
);
create table public.mail_recipients (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.mail_campaigns(id) on delete cascade,
  contact_id uuid references public.mail_contacts(id), email text not null, name text, status text not null default 'queued',
  provider_message_id text, error_message text, reserved_at timestamptz, accepted_at timestamptz, delivered_at timestamptz,
  latest_event_at timestamptz, unique(campaign_id, email)
);
create table public.mail_events (
  id uuid primary key default gen_random_uuid(), provider_event_id text not null unique, campaign_id uuid references public.mail_campaigns(id) on delete set null,
  recipient_id uuid references public.mail_recipients(id) on delete set null, email text, event_type text not null, event_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index mail_campaigns_status_created_idx on public.mail_campaigns(status, created_at desc);
create index mail_recipients_claim_idx on public.mail_recipients(status, reserved_at);
create index mail_recipients_campaign_status_idx on public.mail_recipients(campaign_id, status);
create index mail_recipients_provider_idx on public.mail_recipients(provider_message_id);
create index mail_events_recipient_time_idx on public.mail_events(recipient_id, event_at desc);
create index mail_events_campaign_time_idx on public.mail_events(campaign_id, event_at desc);

alter table public.mail_settings enable row level security;
alter table public.mail_contacts enable row level security;
alter table public.mail_suppressions enable row level security;
alter table public.mail_campaigns enable row level security;
alter table public.mail_recipients enable row level security;
alter table public.mail_events enable row level security;
-- No anon/authenticated policies: all access is through trusted server routes or the worker.
