-- One bounded read instead of eight HTTP requests per contact profile.
-- Private administrator routes only; never exposed to browser database roles.
begin;
create function public.mail_contact_profile(target uuid, page_number integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  contact_record jsonb;
  events jsonb;
  consents jsonb;
  history jsonb;
  recipients jsonb;
  row_offset integer;
begin
  if page_number is null or page_number < 0 or page_number > 10000 then
    raise exception 'Use a profile page between 0 and 10000.' using errcode = '22023';
  end if;
  row_offset := page_number * 25;
  select jsonb_build_object(
    'id',c.id,'email',c.email,'name',c.name,'first_name',c.first_name,'last_name',c.last_name,
    'phone',c.phone,'company',c.company,'job_title',c.job_title,'lifecycle_status',c.lifecycle_status,
    'lead_source',c.lead_source,'notes',c.notes,'consent_status',c.consent_status,
    'consent_source',c.consent_source,'consented_at',c.consented_at,'consent_method',c.consent_method,
    'consent_evidence',c.consent_evidence,'imported_at',c.imported_at,'updated_at',c.updated_at,
    'archived_at',c.archived_at,'last_contacted_at',c.last_contacted_at,'last_opened_at',c.last_opened_at,
    'last_clicked_at',c.last_clicked_at,'campaign_count',c.campaign_count,'eligible',c.eligible,
    'reason',c.reason,'suppression_reason',c.suppression_reason,
    'tags',coalesce((select jsonb_agg(t.name order by t.name) from
      (select t.name from public.mail_contact_tag_memberships m join public.mail_contact_tags t on t.id=m.tag_id where m.contact_id=c.id order by t.name limit 20) t),'[]'::jsonb),
    'list_ids',coalesce((select jsonb_agg(m.list_id) from
      (select list_id from public.mail_contact_list_memberships where contact_id=c.id order by list_id limit 100) m),'[]'::jsonb),
    'custom_fields',coalesce((select jsonb_object_agg(v.field_id::text,v.value) from
      (select field_id,value from public.mail_contact_field_values where contact_id=c.id order by field_id limit 50) v),'{}'::jsonb)
  ) into contact_record from public.mail_contact_audience c where c.id=target;
  if contact_record is null then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into events from (
    select e.id,e.event_type,e.event_at,e.email,e.payload,e.campaign_id,c.name as campaign_name
    from public.mail_events e left join public.mail_campaigns c on c.id=e.campaign_id
    where e.email=contact_record->>'email' order by e.event_at desc,e.id desc limit 26 offset row_offset
  ) e;
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into consents from (
    select id,status,method,source,happened_at,evidence,recorded_at from public.mail_contact_consents
    where contact_id=target order by recorded_at desc,id desc limit 26 offset row_offset
  ) c;
  select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) into history from (
    select id,action,detail,created_at from public.mail_contact_history where contact_id=target
    order by created_at desc,id desc limit 26 offset row_offset
  ) h;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into recipients from (
    select r.id,r.campaign_id,r.status,r.accepted_at,r.delivered_at,r.opened_at,r.clicked_at,
      r.bounced_at,r.failed_at,r.suppressed_at,c.name as campaign_name
    from public.mail_recipients r left join public.mail_campaigns c on c.id=r.campaign_id
    where r.contact_id=target order by r.accepted_at desc nulls last,r.id desc limit 26 offset row_offset
  ) r;
  return jsonb_build_object('contact',contact_record,'events',events,'consents',consents,
    'history',history,'recipient_campaigns',recipients,'page',page_number);
end;
$$;
revoke all on function public.mail_contact_profile(uuid,integer) from public,anon,authenticated;
grant execute on function public.mail_contact_profile(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
