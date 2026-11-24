-- Lite campaign dispatch. Apply after 0010_dashboard_read.sql.
begin;

alter table public.mail_recipients
  add column if not exists attempts integer not null default 0 check (attempts >= 0 and attempts <= 10),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text;

create index if not exists mail_recipients_dispatch_idx
  on public.mail_recipients(status, next_attempt_at, reserved_at, id);

create or replace function public.mail_launch_campaign(target uuid, expected_revision integer)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  campaign public.mail_campaigns;
  settings public.mail_settings;
  approval public.mail_campaign_audience_approvals;
  sender_ok boolean;
  sender_address text;
  snapshot_count integer;
  eligible_count integer;
  queued_count integer;
begin
  select * into strict campaign from public.mail_campaigns where id=target for update;
  if campaign.status <> 'draft' then raise exception 'Only a draft campaign can be launched' using errcode='22023'; end if;
  if campaign.revision <> expected_revision then raise exception 'Campaign changed. Reload the draft before launching.' using errcode='22023'; end if;
  if nullif(trim(campaign.from_email),'') is null or nullif(trim(campaign.sender_name),'') is null then raise exception 'Configure a sender identity before launching' using errcode='22023'; end if;
  if nullif(trim(campaign.subject),'') is null or (campaign.content_html is null and campaign.content_text is null) then raise exception 'Add a subject and email content before launching' using errcode='22023'; end if;

  select * into strict settings from public.mail_settings where id=true;
  if settings.connection_disabled or settings.connection_state <> 'connection_validated' then raise exception 'Send a test email successfully before launching a campaign' using errcode='22023'; end if;
  if settings.resend_api_key_ciphertext is null and settings.environment_credential_fingerprint is null then raise exception 'Connect a Resend API key before launching a campaign' using errcode='22023'; end if;
  select i.physical_address into sender_address
    from public.mail_sender_identities i
    join public.mail_sending_domains d on d.id=i.domain_id
    where i.from_email=campaign.from_email
      and i.sender_name=campaign.sender_name
      and i.tested_credential_version=settings.credential_version
      and i.last_test_at is not null
      and d.verification_status='verified'
      and d.verified_credential_version=settings.credential_version;
  sender_ok := sender_address is not null and nullif(trim(sender_address),'') is not null;
  if not sender_ok then raise exception 'Verify and test this sender identity with the current Resend key before launching' using errcode='22023'; end if;

  select * into strict approval
  from public.mail_campaign_audience_approvals
  where campaign_id=target and campaign_revision=campaign.revision
  order by approved_at desc limit 1;
  snapshot_count := jsonb_array_length(approval.recipient_snapshot);
  if snapshot_count < 1 then raise exception 'Approve at least one eligible recipient before launching' using errcode='22023'; end if;

  select count(*) into eligible_count
  from public.mail_contact_audience a
  join jsonb_array_elements(approval.recipient_snapshot) r on (r->>'id')::uuid=a.id
  where a.eligible;
  if eligible_count <> snapshot_count then raise exception 'Audience changed. Validate and approve the audience again before launching' using errcode='22023'; end if;

  insert into public.mail_recipients(campaign_id,contact_id,email,name,status,next_attempt_at)
  select target,(r->>'id')::uuid,lower(trim(r->>'email')),nullif(r->>'name',''),'queued',now()
  from jsonb_array_elements(approval.recipient_snapshot) r
  where (r->>'eligible')::boolean;
  get diagnostics queued_count = row_count;
  if queued_count <> snapshot_count then raise exception 'Recipient snapshot could not be queued completely' using errcode='22023'; end if;

  update public.mail_campaigns set status='queued', total_count=queued_count, accepted_count=0, delivered_count=0,
    opened_count=0, clicked_count=0, failed_count=0, blocked_count=0, started_at=null, completed_at=null
    where id=target;
  return jsonb_build_object('campaign_id',target,'queued',queued_count,'status','queued');
exception when no_data_found then
  raise exception 'Save and approve the current audience before launching' using errcode='22023';
end;
$$;

create or replace function public.mail_record_dispatch_result(target uuid, result text, provider_id text default null, safe_error text default null, retry_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare r public.mail_recipients; c public.mail_campaigns; pending integer; accepted integer; failed integer; blocked integer; next_status public.mail_campaign_status;
begin
  select * into strict r from public.mail_recipients where id=target for update;
  select * into strict c from public.mail_campaigns where id=r.campaign_id for update;
  if r.status <> 'processing' then return jsonb_build_object('status',r.status,'ignored',true); end if;
  if result='retry' then
    update public.mail_recipients set status='queued',reserved_at=null,claimed_at=null,next_attempt_at=retry_at,last_error=safe_error where id=target;
    return jsonb_build_object('status','queued','retry',true);
  elsif result='accepted' then
    update public.mail_recipients set status='accepted',provider_message_id=provider_id,accepted_at=coalesce(accepted_at,now()),reserved_at=null,claimed_at=null,next_attempt_at=null,last_error=null where id=target;
    insert into public.mail_events(provider_event_id,campaign_id,recipient_id,email,event_type,event_at,payload)
      values('internal-send:'||target::text||':'||r.attempts,r.campaign_id,target,r.email,'sent',now(),jsonb_build_object('provider_message_id',provider_id)) on conflict do nothing;
  elsif result in ('failed','blocked') then
    update public.mail_recipients set status=result,reserved_at=null,claimed_at=null,next_attempt_at=null,last_error=safe_error,failed_at=case when result='failed' then coalesce(failed_at,now()) else failed_at end,suppressed_at=case when result='blocked' then coalesce(suppressed_at,now()) else suppressed_at end where id=target;
  else raise exception 'Invalid dispatch result' using errcode='22023';
  end if;
  select count(*) filter(where status in ('queued','processing'))::integer,count(*) filter(where accepted_at is not null)::integer,count(*) filter(where status='failed')::integer,count(*) filter(where status='blocked')::integer into pending,accepted,failed,blocked from public.mail_recipients where campaign_id=r.campaign_id;
  update public.mail_campaigns set accepted_count=accepted,failed_count=failed,blocked_count=blocked where id=r.campaign_id;
  if pending=0 then
    next_status := case when accepted=0 and (failed+blocked)>0 then 'failed'::public.mail_campaign_status when (failed+blocked)>0 then 'partially_failed'::public.mail_campaign_status else 'completed'::public.mail_campaign_status end;
    update public.mail_campaigns set status=next_status,completed_at=now() where id=r.campaign_id and status in ('queued','sending');
  else
    update public.mail_campaigns set status='sending',started_at=coalesce(started_at,now()) where id=r.campaign_id and status='queued';
  end if;
  return jsonb_build_object('status',result,'pending',pending,'accepted',accepted,'failed',failed,'blocked',blocked);
exception when no_data_found then
  return jsonb_build_object('status','missing','ignored',true);
end;
$$;

revoke all on function public.mail_launch_campaign(uuid,integer), public.mail_record_dispatch_result(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mail_launch_campaign(uuid,integer), public.mail_record_dispatch_result(uuid,text,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
