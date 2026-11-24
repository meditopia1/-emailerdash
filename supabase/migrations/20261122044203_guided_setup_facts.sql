-- Read-only setup evidence. No provider calls, queue inserts, or configuration changes.
begin;
create or replace function public.mail_guided_setup_facts()
returns jsonb language plpgsql stable security invoker
set search_path=public,pg_temp set statement_timeout='8s' as $$
declare draft record; preview jsonb; audience_verified boolean := true; content_ok boolean; approval_current boolean := false;
begin
  -- Prefer a usable saved draft. Return only one, and never transfer message bodies.
  select c.id,c.name,c.subject,c.content_text,c.content_html,c.sender_name,c.from_email,c.audience_selection,c.audience_contact_ids,c.revision
  into draft from public.mail_campaigns c where c.status='draft'
  order by (length(trim(c.name))>0 and length(trim(c.subject))>0
    and length(trim(coalesce(nullif(c.content_text,''),c.content_html,'')))>0
    and (cardinality(c.audience_contact_ids)>0 or c.audience_selection->>'type' in ('segment','list','filter'))
    and exists(select 1 from public.mail_sender_identities s where s.from_email=c.from_email)) desc,
    c.created_at desc,c.id desc limit 1;
  if draft.id is not null then
    content_ok := length(trim(draft.name)) between 1 and 200 and length(trim(draft.subject)) between 1 and 998
      and length(trim(draft.sender_name)) between 1 and 200
      and length(trim(coalesce(nullif(draft.content_text,''),draft.content_html,''))) between 1 and 500000;
    begin
      preview := public.mail_preview_campaign_audience(draft.audience_selection,draft.audience_contact_ids);
    exception when others then
      -- Failed eligibility verification is unknown, never an empty or approved audience.
      audience_verified := false; preview := null;
    end;
    select exists(select 1 from public.mail_campaign_audience_approvals a where a.campaign_id=draft.id
      and a.campaign_revision=draft.revision and a.fingerprint=preview->>'fingerprint') into approval_current;
  end if;
  return jsonb_build_object(
    'domains',coalesce((select jsonb_agg(to_jsonb(d)) from (
      select id,domain,verification_status,verification_source,verified_credential_version,open_tracking,click_tracking
      from public.mail_sending_domains order by is_default desc,created_at,id limit 100) d),'[]'::jsonb),
    'identities',coalesce((select jsonb_agg(to_jsonb(s)) from (
      select id,domain_id,sender_name,from_email,company_name,physical_address,is_default,tested_credential_version,last_test_at
      from public.mail_sender_identities order by is_default desc,created_at,id limit 100) s),'[]'::jsonb),
    'configuration_truncated',exists(select 1 from public.mail_sending_domains offset 100 limit 1)
      or exists(select 1 from public.mail_sender_identities offset 100 limit 1),
    'contacts',(select jsonb_build_object('total',count(*),'eligible',count(*) filter(where eligible))
      from public.mail_contact_audience where archived_at is null),
    'draft',case when draft.id is null then null else jsonb_build_object(
      'id',draft.id,'name',draft.name,'from_email',draft.from_email,'content_valid',content_ok,
      'audience_configured',cardinality(draft.audience_contact_ids)>0 or draft.audience_selection->>'type' in ('segment','list','filter'),
      'audience_verified',audience_verified,'eligible',coalesce((preview->>'eligible')::integer,0),
      'excluded',coalesce((preview->>'excluded')::integer,0),'approved',approval_current) end,
    'prepared_campaign',exists(select 1 from public.mail_campaigns c where c.status<>'draft'
      and length(trim(c.name)) between 1 and 200 and length(trim(c.subject)) between 1 and 998
      and length(trim(c.sender_name)) between 1 and 200 and c.from_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and length(trim(coalesce(nullif(c.content_text,''),c.content_html,''))) between 1 and 500000
      and exists(select 1 from public.mail_recipients r where r.campaign_id=c.id)),
    'submitted',exists(select 1 from public.mail_campaigns c where c.status in ('queued','sending','completed','partially_failed','failed','cancelled')
      and exists(select 1 from public.mail_recipients r where r.campaign_id=c.id))
  );
end; $$;
revoke all on function public.mail_guided_setup_facts() from public,anon,authenticated;
grant execute on function public.mail_guided_setup_facts() to service_role;
notify pgrst,'reload schema';
commit;
