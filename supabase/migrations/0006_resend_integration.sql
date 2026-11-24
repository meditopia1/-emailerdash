-- Additive, private single-admin integration. Run after 0005. No provider/DNS writes.
begin;
alter table public.mail_settings
  alter column sender_name set default '', alter column from_email set default '',
  alter column company_name set default '', alter column physical_address set default '',
  alter column resend_api_key_ciphertext drop not null,
  alter column webhook_secret_ciphertext drop not null,
  add column if not exists connection_state text not null default 'configuration_saved'
    check (connection_state in ('not_configured','configuration_saved','connection_validated','validation_failed','needs_attention')),
  add column if not exists credential_version uuid not null default gen_random_uuid(),
  add column if not exists environment_credential_fingerprint text,
  add column if not exists connection_disabled boolean not null default false,
  add column if not exists managed_domains boolean not null default false,
  add column if not exists last_validated_at timestamptz,
  add column if not exists last_test_at timestamptz,
  add column if not exists last_connection_error text,
  add column if not exists last_webhook_at timestamptz;

create table if not exists public.mail_sending_domains (
  id uuid primary key default gen_random_uuid(), connection_id boolean not null default true references public.mail_settings(id),
  domain text not null unique check (domain = lower(trim(domain)) and length(domain) between 3 and 253),
  provider_domain_id text, verification_status text not null default 'self_reported',
  verification_source text not null default 'manual' check (verification_source in ('manual','provider')),
  verified_credential_version uuid, last_checked_at timestamptz, is_default boolean not null default false,
  dns_records jsonb not null default '[]', open_tracking boolean, click_tracking boolean,
  created_at timestamptz not null default now()
);
create unique index if not exists mail_domain_default_idx on public.mail_sending_domains(is_default) where is_default;
create table if not exists public.mail_sender_identities (
  id uuid primary key default gen_random_uuid(), domain_id uuid not null references public.mail_sending_domains(id) on delete cascade,
  sender_name text not null, from_email text not null unique, reply_to text, company_name text not null, physical_address text not null,
  is_default boolean not null default false, tested_credential_version uuid, last_test_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_email = lower(trim(from_email)))
);
create unique index if not exists mail_sender_default_idx on public.mail_sender_identities(is_default) where is_default;
create index if not exists mail_sender_domain_idx on public.mail_sender_identities(domain_id);
create table if not exists public.mail_integration_audit (
  id uuid primary key default gen_random_uuid(), action text not null, entity_id text,
  outcome text not null default 'success', created_at timestamptz not null default now()
);
create index if not exists mail_integration_audit_time_idx on public.mail_integration_audit(created_at desc);
create table if not exists public.mail_test_sends (
  id uuid primary key, sender_identity_id uuid references public.mail_sender_identities(id) on delete set null,
  credential_version uuid not null, from_email text not null, destination text not null, content_hash text not null,
  status text not null default 'pending' check (status in ('pending','accepted','failed','unknown')),
  provider_message_id text unique, error_message text, last_event_type text, last_event_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mail_test_time_idx on public.mail_test_sends(created_at desc);
create table if not exists public.mail_integration_limits (
  bucket text primary key, started_at timestamptz not null default now(), attempts integer not null default 1
);
do $$ declare t text; begin
  foreach t in array array['mail_sending_domains','mail_sender_identities','mail_integration_audit','mail_test_sends','mail_integration_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

alter table public.mail_recipients
  add column if not exists opened_at timestamptz, add column if not exists clicked_at timestamptz,
  add column if not exists bounced_at timestamptz, add column if not exists complained_at timestamptz,
  add column if not exists failed_at timestamptz, add column if not exists suppressed_at timestamptz;
create unique index if not exists mail_recipient_unique_provider_idx on public.mail_recipients(provider_message_id) where provider_message_id is not null;
-- Backfill only actual recorded events; no invented engagement or changed campaign snapshots.
update public.mail_recipients r set
  opened_at = coalesce(r.opened_at, e.opened_at), clicked_at = coalesce(r.clicked_at, e.clicked_at),
  bounced_at = coalesce(r.bounced_at, e.bounced_at), complained_at = coalesce(r.complained_at, e.complained_at)
from (select recipient_id,
  min(event_at) filter (where event_type in ('opened','email.opened')) as opened_at,
  min(event_at) filter (where event_type in ('clicked','email.clicked')) as clicked_at,
  min(event_at) filter (where event_type in ('bounced','email.bounced')) as bounced_at,
  min(event_at) filter (where event_type in ('complained','email.complained')) as complained_at
  from public.mail_events where recipient_id is not null group by recipient_id) e where r.id = e.recipient_id;

create or replace function public.mail_integration_rate_limit(target_bucket text, max_attempts integer, window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare used integer; begin
  insert into public.mail_integration_limits(bucket) values(target_bucket)
  on conflict(bucket) do update set
    attempts = case when mail_integration_limits.started_at < now() - make_interval(secs => window_seconds) then 1 else mail_integration_limits.attempts + 1 end,
    started_at = case when mail_integration_limits.started_at < now() - make_interval(secs => window_seconds) then now() else mail_integration_limits.started_at end
  returning attempts into used;
  return used <= max_attempts;
end $$;

-- Defaults/rotation are atomic. No secrets in the audit table. Called only by authenticated server actions.
create or replace function public.mail_integration_action(operation text, details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare target uuid; sender public.mail_sender_identities; begin
  insert into public.mail_settings(id) values(true) on conflict do nothing;
  perform 1 from public.mail_settings where id = true for update;
  if operation = 'connect' then
    update public.mail_settings set resend_api_key_ciphertext = details->>'ciphertext', credential_version = gen_random_uuid(),
      connection_disabled = false, managed_domains = coalesce((details->>'managed')::boolean,false),
      connection_state = 'configuration_saved', last_connection_error = null, last_validated_at = null where id;
  elsif operation = 'disconnect' then
    update public.mail_settings set resend_api_key_ciphertext = null, connection_disabled = true, managed_domains = false,
      credential_version = gen_random_uuid(), connection_state = 'not_configured', last_validated_at = null where id;
  elsif operation = 'management' then
    update public.mail_settings set managed_domains = (details->>'enabled')::boolean where id;
  elsif operation = 'webhook_secret' then
    update public.mail_settings set webhook_secret_ciphertext = details->>'ciphertext', last_webhook_at = null where id;
  elsif operation = 'default_domain' then
    target := (details->>'id')::uuid;
    if not exists(select 1 from public.mail_sending_domains where id = target) then raise exception 'Domain not found'; end if;
    update public.mail_sending_domains set is_default = false where is_default;
    update public.mail_sending_domains set is_default = true where id = target;
  elsif operation = 'remove_domain' then
    target := (details->>'id')::uuid;
    if exists(select 1 from public.mail_sender_identities where domain_id = target and is_default) then
      update public.mail_settings set sender_name = '', from_email = '', reply_to = null, verified_domain = null where id;
    end if;
    delete from public.mail_sending_domains where id = target;
  elsif operation = 'default_sender' then
    target := (details->>'id')::uuid;
    select * into strict sender from public.mail_sender_identities where id = target;
    update public.mail_sender_identities set is_default = false where is_default;
    update public.mail_sender_identities set is_default = true where id = target;
    update public.mail_settings set sender_name = sender.sender_name, from_email = sender.from_email, reply_to = sender.reply_to,
      company_name = sender.company_name, physical_address = sender.physical_address, verified_domain = null where id;
  else raise exception 'Unsupported action'; end if;
  insert into public.mail_integration_audit(action,entity_id) values(operation,details->>'id');
end $$;

-- Environment credentials can rotate outside the UI. Synchronize only on explicit actions.
create or replace function public.sync_mail_environment_credential(fingerprint text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_fingerprint text;
begin
  select environment_credential_fingerprint into previous_fingerprint from public.mail_settings where id for update;
  update public.mail_settings set environment_credential_fingerprint = fingerprint,
    credential_version = gen_random_uuid(), connection_state = 'configuration_saved',
    last_validated_at = null, last_connection_error = null
    where id and not connection_disabled and resend_api_key_ciphertext is null
      and environment_credential_fingerprint is distinct from fingerprint;
  if found and previous_fingerprint is not null then insert into public.mail_integration_audit(action) values('environment_credential_changed'); end if;
end $$;

-- Locks the recipient/campaign; dedup, timestamps, suppression and counters commit together.
create or replace function public.record_mail_provider_event(event_id text, message_id text, event_kind text, happened_at timestamptz, metadata jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.mail_recipients; test_id uuid; inserted uuid; begin
  if event_kind not in ('sent','delivered','opened','clicked','bounced','complained','failed','delivery_delayed','suppressed') then return 'ignored'; end if;
  perform 1 from public.mail_settings where id for update;
  select * into r from public.mail_recipients where provider_message_id = message_id for update;
  if r.id is null then
    select id into test_id from public.mail_test_sends where provider_message_id = message_id for update;
    if test_id is null then return 'unmatched'; end if;
  else
    perform 1 from public.mail_campaigns where id = r.campaign_id for update;
  end if;
  insert into public.mail_events(provider_event_id,campaign_id,recipient_id,email,event_type,event_at,payload)
    values(event_id,r.campaign_id,r.id,r.email,event_kind,happened_at,jsonb_build_object('test_id',test_id,'provider_message_id',message_id) || metadata)
    on conflict(provider_event_id) do nothing returning id into inserted;
  update public.mail_settings set last_webhook_at = now() where id;
  if inserted is null then return 'duplicate'; end if;
  if test_id is not null then
    update public.mail_test_sends set last_event_type = event_kind, last_event_at = happened_at
      where id = test_id and (last_event_at is null or last_event_at <= happened_at);
    return 'test';
  end if;
  update public.mail_recipients set
    accepted_at = case when event_kind = 'sent' then coalesce(accepted_at,happened_at) else accepted_at end,
    delivered_at = case when event_kind = 'delivered' then coalesce(delivered_at,happened_at) else delivered_at end,
    opened_at = case when event_kind = 'opened' then coalesce(opened_at,happened_at) else opened_at end,
    clicked_at = case when event_kind = 'clicked' then coalesce(clicked_at,happened_at) else clicked_at end,
    bounced_at = case when event_kind = 'bounced' then coalesce(bounced_at,happened_at) else bounced_at end,
    complained_at = case when event_kind = 'complained' then coalesce(complained_at,happened_at) else complained_at end,
    failed_at = case when event_kind in ('bounced','failed') then coalesce(failed_at,happened_at) else failed_at end,
    suppressed_at = case when event_kind in ('complained','suppressed') then coalesce(suppressed_at,happened_at) else suppressed_at end,
    latest_event_at = greatest(latest_event_at,happened_at)
  where id = r.id;
  -- Never regress to accepted on a late/reordered event or unblock a terminal suppression.
  update public.mail_recipients set status = case
    when suppressed_at is not null then 'blocked' when failed_at is not null then 'failed'
    when clicked_at is not null then 'clicked' when opened_at is not null then 'opened'
    when delivered_at is not null then 'delivered' when accepted_at is not null then 'accepted' else status end
  where id = r.id;
  -- Resend email.bounced represents permanent rejection; temporary issues use delivery_delayed.
  if event_kind in ('complained','suppressed','bounced') then
    insert into public.mail_suppressions(normalized_email,reason,source) values(lower(trim(r.email)),event_kind,'resend_webhook')
      on conflict(normalized_email) do nothing;
  end if;
  update public.mail_campaigns c set
    accepted_count = s.accepted, delivered_count = s.delivered, opened_count = s.opened, clicked_count = s.clicked,
    failed_count = s.failed, blocked_count = s.blocked
  from (select count(*) filter(where accepted_at is not null)::integer accepted,
    count(*) filter(where delivered_at is not null)::integer delivered, count(*) filter(where opened_at is not null)::integer opened,
    count(*) filter(where clicked_at is not null)::integer clicked, count(*) filter(where status = 'failed')::integer failed,
    count(*) filter(where status = 'blocked')::integer blocked from public.mail_recipients where campaign_id = r.campaign_id) s
  where c.id = r.campaign_id;
  return 'recorded';
end $$;

create or replace function public.mail_dashboard_totals()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('campaigns',(select count(*) from public.mail_campaigns),'contacts',(select count(*) from public.mail_contacts),
    'queued',count(*) filter(where status = 'queued'),'processing',count(*) filter(where status = 'processing'),
    'accepted',count(*) filter(where accepted_at is not null),'delivered',count(*) filter(where delivered_at is not null),
    'opened',count(*) filter(where opened_at is not null),'clicked',count(*) filter(where clicked_at is not null),
    'failed',count(*) filter(where status = 'failed'),'bounced',count(*) filter(where bounced_at is not null),
    'complained',count(*) filter(where complained_at is not null),'suppressed',(select count(*) from public.mail_suppressions)) from public.mail_recipients;
$$;

create or replace function public.finish_mail_test(test_id uuid, result_status text, provider_id text, safe_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.mail_test_sends; begin
  perform 1 from public.mail_settings where id for update;
  select * into strict t from public.mail_test_sends where id = test_id for update;
  if t.status <> 'pending' then return; end if;
  if result_status not in ('accepted','failed','unknown') then raise exception 'Invalid result'; end if;
  update public.mail_test_sends set status = result_status, provider_message_id = provider_id, error_message = safe_error where id = test_id;
  update public.mail_settings set last_test_at = now(),
    connection_state = case when result_status = 'accepted' then 'connection_validated' when result_status = 'unknown' then 'needs_attention' else 'validation_failed' end,
    last_connection_error = safe_error,
    last_validated_at = case when result_status = 'accepted' then now() else last_validated_at end
    where id and credential_version = t.credential_version and not connection_disabled;
  if result_status = 'accepted' then
    update public.mail_sender_identities set tested_credential_version = t.credential_version, last_test_at = now()
      where id = t.sender_identity_id and from_email = t.from_email;
  end if;
  insert into public.mail_integration_audit(action,entity_id,outcome) values('test_email',test_id::text,result_status);
end $$;

revoke all on function public.mail_integration_rate_limit(text,integer,integer), public.mail_integration_action(text,jsonb),
  public.record_mail_provider_event(text,text,text,timestamptz,jsonb), public.mail_dashboard_totals(), public.finish_mail_test(uuid,text,text,text), public.sync_mail_environment_credential(text) from public,anon,authenticated;
grant execute on function public.mail_integration_rate_limit(text,integer,integer), public.mail_integration_action(text,jsonb),
  public.record_mail_provider_event(text,text,text,timestamptz,jsonb), public.mail_dashboard_totals(), public.finish_mail_test(uuid,text,text,text), public.sync_mail_environment_credential(text) to service_role;
commit;
