-- Preserve dashboard metrics while reducing remote database round trips.
begin;
create function public.mail_dashboard_snapshot(sending_only boolean default false)
returns jsonb language sql stable security invoker set search_path=public,pg_temp set statement_timeout='8s' as $$
select jsonb_build_object(
  'campaigns',coalesce((select jsonb_agg(to_jsonb(c)) from (
    select c.id,c.name,c.status,c.total_count,c.accepted_count,c.delivered_count,c.opened_count,
      c.clicked_count,c.failed_count,c.blocked_count,c.created_at,c.started_at,c.completed_at,
      (select count(*) from public.mail_recipients r where r.campaign_id=c.id) as recipient_count,
      (select count(*) from public.mail_recipients r where r.campaign_id=c.id and r.status='queued') as queued_count,
      (select count(*) from public.mail_recipients r where r.campaign_id=c.id and r.status in
        ('accepted','delivered','opened','clicked','failed','blocked','cancelled')) as processed_count
    from public.mail_campaigns c where not sending_only or c.status in ('queued','sending')
    order by c.created_at desc,c.id desc limit 20
  ) c),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e)) from (
    select e.id,e.event_type,e.email,e.event_at,e.campaign_id,e.payload,c.name as campaign_name
    from public.mail_events e left join public.mail_campaigns c on c.id=e.campaign_id
    where e.campaign_id is not null order by e.event_at desc,e.id desc limit 100
  ) e),'[]'::jsonb),
  'identities',coalesce((select jsonb_agg(to_jsonb(i)) from (
    select id,sender_name,from_email,reply_to,is_default,tested_credential_version,last_test_at
    from public.mail_sender_identities order by created_at,id limit 100
  ) i),'[]'::jsonb),
  'contacts',coalesce((select jsonb_agg(to_jsonb(c)) from (
    select id,email,name,consent_source,consented_at,consent_status,archived_at,imported_at,eligible,reason
    from public.mail_contact_audience where archived_at is null order by imported_at desc,id desc limit 100
  ) c),'[]'::jsonb),
  'totals',public.mail_dashboard_totals() || jsonb_build_object(
    'sending_campaigns',(select count(*) from public.mail_campaigns where status='sending'),
    'opened_delivered',(select count(*) from public.mail_recipients where delivered_at is not null and opened_at is not null))
);
$$;
revoke all on function public.mail_dashboard_snapshot(boolean) from public,anon,authenticated;
grant execute on function public.mail_dashboard_snapshot(boolean) to service_role;
notify pgrst,'reload schema';
commit;
