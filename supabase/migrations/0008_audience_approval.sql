-- Audience finalization only. Does not create queue jobs or enable campaign dispatch.
begin;
alter table public.mail_campaigns add column audience_selection jsonb not null default '{"type":"contacts"}';
create table public.mail_campaign_audience_approvals (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.mail_campaigns(id) on delete cascade,
  campaign_revision integer not null, fingerprint text not null, source jsonb not null, recipient_snapshot jsonb not null,
  eligible_count integer not null, excluded_count integer not null, approved_at timestamptz not null default now()
);
create index mail_audience_approval_campaign_idx on public.mail_campaign_audience_approvals(campaign_id,approved_at desc);
alter table public.mail_campaign_audience_approvals enable row level security;
alter table public.mail_campaign_audience_approvals force row level security;
revoke all on public.mail_campaign_audience_approvals from public,anon,authenticated;
grant select,insert on public.mail_campaign_audience_approvals to service_role;

create function public.mail_preview_campaign_audience(selection jsonb, individual_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='8s' as $$
declare predicate text; definition jsonb; source jsonb=selection; rows jsonb; eligible integer; requested integer; missing integer=0; begin
  if selection->>'type'='contacts' then
    if cardinality(individual_ids)>1000 then raise exception 'Select at most 1000 contacts' using errcode='22023'; end if;
    predicate=format('c.id=any(%L::uuid[])',individual_ids); requested=(select count(distinct id) from unnest(individual_ids) as id);
  else
    if selection->>'type'='segment' then select filter into strict definition from public.mail_audience_segments where id=(selection->>'id')::uuid; source=selection||jsonb_build_object('definition',definition);
    elsif selection->>'type'='list' then definition=jsonb_build_object('field','list','op','eq','value',selection->>'id'); perform 1 from public.mail_contact_lists where id=(selection->>'id')::uuid; if not found then raise exception 'List no longer exists' using errcode='22023'; end if;
    elsif selection->>'type'='filter' then definition=selection->'filter';
    else raise exception 'Choose a supported audience source' using errcode='22023'; end if;
    predicate=public.mail_audience_filter_sql(definition)||' and c.archived_at is null';
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by r.id),''[]'') from (select c.id,c.email,c.name,c.consent_source,c.consented_at,c.consent_status,c.archived_at,c.eligible,c.reason,
    coalesce((select jsonb_object_agg(f.key,v.value) from public.mail_contact_field_values v join public.mail_contact_fields f on f.id=v.field_id where v.contact_id=c.id),''{}'') as custom_fields
    from public.mail_contact_audience c where %s order by c.id limit 1001) r',predicate) into rows;
  if jsonb_array_length(rows)>1000 then raise exception 'This audience exceeds the existing 1000-recipient campaign limit. Narrow its filters.' using errcode='22023'; end if;
  if selection->>'type'='contacts' then missing=requested-jsonb_array_length(rows); else requested=jsonb_array_length(rows); end if;
  select count(*)::integer into eligible from jsonb_array_elements(rows) r where (r->>'eligible')::boolean;
  return jsonb_build_object('rows',rows,'selected',requested,'eligible',eligible,'excluded',requested-eligible,'missing',missing,'fingerprint',encode(sha256(convert_to(jsonb_build_object('source',source,'rows',rows)::text,'UTF8')),'hex'));
end $$;

create function public.mail_approve_campaign_audience(target uuid, expected_revision integer, expected_hash text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare campaign public.mail_campaigns; preview jsonb; snapshot jsonb; approval uuid; selected_ids uuid[]; begin
  select * into strict campaign from public.mail_campaigns where id=target for update;
  if campaign.status<>'draft' or campaign.revision<>expected_revision then raise exception 'Campaign changed. Save and review the current draft before approving.' using errcode='22023'; end if;
  preview=public.mail_preview_campaign_audience(campaign.audience_selection,campaign.audience_contact_ids);
  if preview->>'fingerprint'<>expected_hash then raise exception 'Audience changed since preview. Refresh the preview and explicitly approve the updated recipients.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(r),'[]') into snapshot from jsonb_array_elements(preview->'rows') r where (r->>'eligible')::boolean;
  if jsonb_array_length(snapshot)=0 then raise exception 'No eligible recipients. Record valid consent and check suppressions first.' using errcode='22023'; end if;
  select coalesce(array_agg((r->>'id')::uuid),'{}') into selected_ids from jsonb_array_elements(preview->'rows') r;
  update public.mail_campaigns set audience_contact_ids=selected_ids where id=target returning * into campaign;
  insert into public.mail_campaign_audience_approvals(campaign_id,campaign_revision,fingerprint,source,recipient_snapshot,eligible_count,excluded_count)
    values(target,campaign.revision,expected_hash,campaign.audience_selection,snapshot,(preview->>'eligible')::integer,(preview->>'excluded')::integer) returning id into approval;
  return jsonb_build_object('id',approval,'campaign_revision',campaign.revision,'contact_ids',selected_ids,'eligible',preview->'eligible','excluded',preview->'excluded','approved_at',now());
end $$;

create or replace function public.bump_mail_campaign_builder_revisions()
returns trigger language plpgsql set search_path=public as $$
begin
  if row(new.name,new.sender_name,new.from_email,new.reply_to,new.subject,new.preheader,new.content_html,new.content_text,new.status,new.audience_contact_ids,new.audience_selection)
    is distinct from row(old.name,old.sender_name,old.from_email,old.reply_to,old.subject,old.preheader,old.content_html,old.content_text,old.status,old.audience_contact_ids,old.audience_selection) then new.revision=old.revision+1; else new.revision=old.revision; end if;
  new.layout_revision=old.layout_revision+case when new.workflow_layout is distinct from old.workflow_layout then 1 else 0 end;
  return new;
end $$;
revoke all on function public.mail_preview_campaign_audience(jsonb,uuid[]),public.mail_approve_campaign_audience(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.mail_preview_campaign_audience(jsonb,uuid[]),public.mail_approve_campaign_audience(uuid,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
