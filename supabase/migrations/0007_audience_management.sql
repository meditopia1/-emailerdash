-- Additive audience management. Existing IDs, campaigns and provider configuration remain intact.
begin;
create extension if not exists pg_trgm;
alter table public.mail_contacts
  alter column consent_source drop not null, alter column consented_at drop not null,
  add column first_name text not null default '', add column last_name text not null default '',
  add column phone text not null default '', add column company text not null default '', add column job_title text not null default '',
  add column lifecycle_status text not null default 'prospect' check (lifecycle_status in ('prospect','lead','customer','inactive')),
  add column lead_source text not null default '', add column notes text not null default '',
  add column consent_status text not null default 'unknown' check (consent_status in ('unknown','granted','denied','revoked','unsubscribed')),
  add column consent_method text not null default '', add column consent_evidence text not null default '',
  add column updated_at timestamptz not null default now(), add column archived_at timestamptz,
  add column last_contacted_at timestamptz, add column last_opened_at timestamptz, add column last_clicked_at timestamptz,
  add column campaign_count integer not null default 0,
  add constraint mail_contact_profile_lengths check (length(first_name)<=100 and length(last_name)<=100 and length(phone)<=40 and length(company)<=200 and length(job_title)<=200 and length(lead_source)<=200 and length(notes)<=5000);

-- Preserve pre-existing permission records; import provenance alone never becomes permission.
update public.mail_contacts c set first_name=left(coalesce(split_part(c.name,' ',1),''),100), last_name=left(coalesce(nullif(substr(c.name,strpos(c.name,' ')+1),c.name),''),100),
  consent_status=case when exists(select 1 from public.mail_suppressions s where s.normalized_email=c.normalized_email and s.reason in ('unsubscribed','unsubscribe')) then 'unsubscribed'
    when nullif(trim(c.consent_source),'') is not null and c.consented_at<=now() and lower(trim(c.consent_source)) not in ('csv','import','upload') then 'granted' else 'unknown' end,
  consent_method='legacy_record';

create table public.mail_contact_tags (id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 50), created_at timestamptz not null default now());
create unique index mail_tag_name_idx on public.mail_contact_tags(lower(name));
create table public.mail_contact_tag_memberships (contact_id uuid not null references public.mail_contacts(id) on delete cascade, tag_id uuid not null references public.mail_contact_tags(id) on delete cascade, primary key(contact_id,tag_id));
create index mail_tag_contacts_idx on public.mail_contact_tag_memberships(tag_id,contact_id);
create table public.mail_contact_fields (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), key text not null unique check(key ~ '^[a-z][a-z0-9_]{0,49}$'), type text not null check(type in ('text','number','date','boolean','single_select','multi_select')), options jsonb not null default '[]' check(jsonb_typeof(options)='array' and jsonb_array_length(options)<=30), created_at timestamptz not null default now());
create table public.mail_contact_field_values (contact_id uuid not null references public.mail_contacts(id) on delete cascade, field_id uuid not null references public.mail_contact_fields(id) on delete cascade, value jsonb not null, primary key(contact_id,field_id));
create index mail_custom_values_lookup_idx on public.mail_contact_field_values(field_id,value);
create table public.mail_audience_segments (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), description text not null default '' check(length(description)<=500), filter jsonb not null default '{"join":"and","conditions":[]}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.mail_contact_lists (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), description text not null default '' check(length(description)<=500), created_at timestamptz not null default now());
create table public.mail_contact_list_memberships (list_id uuid not null references public.mail_contact_lists(id) on delete cascade, contact_id uuid not null references public.mail_contacts(id) on delete cascade, created_at timestamptz not null default now(), primary key(list_id,contact_id));
create index mail_contact_lists_contact_idx on public.mail_contact_list_memberships(contact_id,list_id);
create table public.mail_contact_consents (id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.mail_contacts(id) on delete cascade, status text not null check(status in ('unknown','granted','denied','revoked','unsubscribed')), method text not null default '', source text, happened_at timestamptz, evidence text not null default '', recorded_at timestamptz not null default now());
create index mail_contact_consents_time_idx on public.mail_contact_consents(contact_id,recorded_at desc,id);
insert into public.mail_contact_consents(contact_id,status,method,source,happened_at) select id,consent_status,'legacy_record',consent_source,consented_at from public.mail_contacts;
create table public.mail_contact_history (id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.mail_contacts(id) on delete cascade, action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create index mail_contact_history_time_idx on public.mail_contact_history(contact_id,created_at desc,id);
create table public.mail_contact_imports (
  id uuid primary key, file_name text not null check(length(file_name)<=200), fingerprint text not null check(length(fingerprint)=64), total_rows integer not null check(total_rows between 1 and 100000),
  status text not null default 'uploading' check(status in ('uploading','queued','running','completed','failed','cancelled')), mode text not null check(mode in ('skip','update')),
  mapping jsonb not null, tags text[] not null default '{}', list_id uuid references public.mail_contact_lists(id) on delete set null,
  staged_count integer not null default 0, processed_count integer not null default 0, imported_count integer not null default 0, updated_count integer not null default 0,
  skipped_count integer not null default 0, invalid_count integer not null default 0, duplicate_count integer not null default 0, failed_count integer not null default 0, attempts integer not null default 0,
  last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index mail_contact_imports_status_idx on public.mail_contact_imports(status,created_at);
create table public.mail_contact_import_rows (
  job_id uuid not null references public.mail_contact_imports(id) on delete cascade, row_number integer not null check(row_number>0),
  data jsonb not null, normalized_email text, status text not null default 'pending' check(status in ('pending','imported','updated','skipped','invalid','duplicate','failed')), error text,
  contact_id uuid references public.mail_contacts(id) on delete set null, primary key(job_id,row_number)
);
create index mail_import_pending_idx on public.mail_contact_import_rows(job_id,status,row_number);
create index mail_import_email_idx on public.mail_contact_import_rows(job_id,normalized_email,row_number);

create index mail_contact_created_idx on public.mail_contacts(imported_at desc,id desc);
create index mail_contact_company_idx on public.mail_contacts(company,id);
create index mail_contact_lifecycle_idx on public.mail_contacts(lifecycle_status,imported_at desc);
create index mail_contact_consent_idx on public.mail_contacts(consent_status) where archived_at is null;
create index mail_contact_engagement_idx on public.mail_contacts(last_clicked_at desc nulls last,id);
create index mail_contact_source_idx on public.mail_contacts(lead_source,imported_at desc,id);
create index mail_contact_last_contacted_idx on public.mail_contacts(last_contacted_at desc nulls last,id);
create index mail_contact_last_opened_idx on public.mail_contacts(last_opened_at desc nulls last,id);
create index mail_contact_search_idx on public.mail_contacts using gin ((lower(coalesce(name,'')||' '||email||' '||company||' '||phone)) gin_trgm_ops);
create index mail_recipient_contact_idx on public.mail_recipients(contact_id,campaign_id);
create index mail_event_email_time_idx on public.mail_events(email,event_at desc,id);

-- Read model: permission and suppression are independent and evaluated against current records.
create view public.mail_contact_audience with (security_invoker=true) as
select c.*, s.reason as suppression_reason,
  (c.archived_at is null and c.consent_status='granted' and c.consented_at<=now() and nullif(trim(c.consent_source),'') is not null and s.id is null and c.email ~* '^(?!\.)(?!.*\.\.)([A-Z0-9_''+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$') as eligible,
  case when c.archived_at is not null then 'Archived' when s.id is not null then 'Suppressed: '||s.reason when c.consent_status<>'granted' or c.consented_at is null or c.consented_at>now() or nullif(trim(c.consent_source),'') is null then 'Consent is missing or not granted' when c.email !~* '^(?!\.)(?!.*\.\.)([A-Z0-9_''+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$' then 'Invalid email address' else null end as reason
from public.mail_contacts c left join public.mail_suppressions s on s.normalized_email=c.normalized_email;

-- Compile only an allow-listed AST. Identifiers come from constants; all data uses quoted literals.
create function public.mail_audience_filter_sql(node jsonb, depth integer default 0) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare f text; op text; v text; col text; parts text[]='{}'; child jsonb; kind text; result text; definition public.mail_contact_fields;
begin
  if depth>3 or octet_length(node::text)>20000 then raise exception 'Filter is too complex' using errcode='22023'; end if;
  if node ? 'conditions' then
    if node->>'join' not in ('and','or') or jsonb_typeof(node->'conditions')<>'array' or jsonb_array_length(node->'conditions')>20 then raise exception 'Invalid filter group' using errcode='22023'; end if;
    for child in select value from jsonb_array_elements(node->'conditions') loop parts=array_append(parts,public.mail_audience_filter_sql(child,depth+1)); end loop;
    return case when cardinality(parts)=0 then 'true' else '('||array_to_string(parts,case when node->>'join'='or' then ' OR ' else ' AND ' end)||')' end;
  end if;
  f=node->>'field'; op=node->>'op'; v=node->>'value'; kind='text';
  if length(v)>500 or op not in ('eq','neq','contains','is_empty','is_not_empty','before','after','within_days','gt','lt') then raise exception 'Invalid filter operator' using errcode='22023'; end if;
  if f in ('name','email','phone','company','job_title','lifecycle_status','consent_status','lead_source') then col=format('c.%I',f);
  elsif f in ('imported_at','last_contacted_at','last_opened_at','last_clicked_at') then col=format('c.%I',f); kind='date';
  elsif f='campaign_count' then col='c.campaign_count';kind='number';
  elsif f='eligible' then col='c.eligible';kind='boolean';
  elsif f='archived' then col='(c.archived_at is not null)';kind='boolean';
  elsif f='tags' then
    if op not in ('eq','neq','contains','is_empty','is_not_empty') then raise exception 'Invalid tag filter' using errcode='22023'; end if;
    result='exists(select 1 from public.mail_contact_tag_memberships tm join public.mail_contact_tags t on t.id=tm.tag_id where tm.contact_id=c.id';
    if op not in ('is_empty','is_not_empty') then result=result||format(' and lower(t.name) %s %L',case when op='contains' then 'like' else '=' end,case when op='contains' then '%'||replace(replace(replace(lower(v),'\','\\'),'%','\%'),'_','\_')||'%' else lower(v) end); end if;
    result=result||')'; return case when op in ('neq','is_empty') then 'not '||result else result end;
  elsif f='list' then
    if op not in ('eq','neq') then raise exception 'Choose a static list' using errcode='22023'; end if;
    result=format('exists(select 1 from public.mail_contact_list_memberships lm where lm.contact_id=c.id and lm.list_id=%L::uuid)',v::uuid);
    return case when op='neq' then 'not '||result else result end;
  elsif f ~ '^custom\.[0-9a-f-]{36}$' then
    select * into definition from public.mail_contact_fields where id=substr(f,8)::uuid;
    if not found then raise exception 'Custom field no longer exists' using errcode='22023'; end if;
    col=format('(select cv.value #>> ''{}'' from public.mail_contact_field_values cv where cv.contact_id=c.id and cv.field_id=%L::uuid)',definition.id);
    kind=case when definition.type in ('date','number','boolean') then definition.type else 'text' end;
    if definition.type='multi_select' and op in ('eq','neq','contains') then
      result=format('exists(select 1 from public.mail_contact_field_values cv where cv.contact_id=c.id and cv.field_id=%L::uuid and cv.value @> %L::jsonb)',definition.id,jsonb_build_array(v)::text);
      return case when op='neq' then 'not '||result else result end;
    end if;
    if kind='number' then col='('||col||')::numeric'; elsif kind='date' then col='('||col||')::timestamptz'; elsif kind='boolean' then col='('||col||')::boolean'; end if;
  else raise exception 'Unsupported filter field' using errcode='22023'; end if;
  if op='is_empty' then return case when kind='text' then '('||col||' is null or '||col||'='''')' else col||' is null' end; end if;
  if op='is_not_empty' then return 'not ('||public.mail_audience_filter_sql(jsonb_build_object('field',f,'op','is_empty'),depth)||')'; end if;
  if v is null then raise exception 'Filter needs a value' using errcode='22023'; end if;
  if kind='date' then
    if op='within_days' then if v::integer<1 or v::integer>36500 then raise exception 'Use 1 to 36500 days' using errcode='22023'; end if; return format('(%s >= now()-make_interval(days=>%s) and %s<=now())',col,v::integer,col); end if;
    if op not in ('eq','neq','before','after') then raise exception 'Invalid date condition' using errcode='22023'; end if;
    return format('%s %s %L::timestamptz',col,case op when 'eq' then '=' when 'neq' then '<>' when 'before' then '<' else '>' end,v::timestamptz);
  elsif kind='number' then
    if op not in ('eq','neq','gt','lt') then raise exception 'Invalid numeric condition' using errcode='22023'; end if;
    return format('%s %s %L::numeric',col,case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' else '<' end,v::numeric);
  elsif kind='boolean' then
    if op not in ('eq','neq') then raise exception 'Invalid boolean condition' using errcode='22023'; end if;
    return format('%s %s %L::boolean',col,case when op='eq' then '=' else '<>' end,v::boolean);
  else
    if op not in ('eq','neq','contains') then raise exception 'Invalid text condition' using errcode='22023'; end if;
    return format('lower(coalesce(%s,'''')) %s %L',col,case op when 'eq' then '=' when 'neq' then '<>' else 'like' end,case when op='contains' then '%'||replace(replace(replace(lower(v),'\','\\'),'%','\%'),'_','\_')||'%' else lower(v) end);
  end if;
end $$;

create function public.mail_audience_query(criteria jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp set statement_timeout='8s' as $$
declare predicate text; term text; sort_col text; direction text; total bigint; rows jsonb; p integer; size integer; definition jsonb;
begin
  p=coalesce((criteria->>'page')::integer,0); size=coalesce((criteria->>'page_size')::integer,25);
  if p<0 or p>10000 or size<1 or size>100 then raise exception 'Invalid page' using errcode='22023'; end if;
  definition=coalesce(criteria->'filter','{"join":"and","conditions":[]}'::jsonb);
  if criteria ? 'segment_id' then select filter into strict definition from public.mail_audience_segments where id=(criteria->>'segment_id')::uuid; end if;
  predicate=public.mail_audience_filter_sql(definition);
  if not coalesce((criteria->>'include_archived')::boolean,false) then predicate=predicate||' and c.archived_at is null'; end if;
  if criteria ? 'list_id' then predicate=predicate||' and '||public.mail_audience_filter_sql(jsonb_build_object('field','list','op','eq','value',criteria->>'list_id')); end if;
  term=lower(trim(coalesce(criteria->>'search','')));
  if length(term)>200 then raise exception 'Search is too long' using errcode='22023'; end if;
  if term<>'' then predicate=predicate||format(' and lower(coalesce(c.name,'''')||'' ''||c.email||'' ''||c.company||'' ''||c.phone) like %L','%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%'); end if;
  sort_col=coalesce(criteria->>'sort','imported_at'); direction=case when criteria->>'direction'='asc' then 'asc' else 'desc' end;
  if sort_col not in ('name','email','company','lifecycle_status','consent_status','imported_at','last_contacted_at','last_opened_at','last_clicked_at','campaign_count') then raise exception 'Unsupported sorting field' using errcode='22023'; end if;
  execute 'select count(*) from public.mail_contact_audience c where '||predicate into total;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]'') from (select c.id,c.email,c.name,c.first_name,c.last_name,c.phone,c.company,c.job_title,c.lifecycle_status,c.lead_source,c.consent_status,c.consent_source,c.consented_at,c.imported_at,c.updated_at,c.archived_at,c.last_contacted_at,c.last_opened_at,c.last_clicked_at,c.campaign_count,c.eligible,c.reason,c.suppression_reason,
    coalesce((select jsonb_agg(t.name order by t.name) from public.mail_contact_tag_memberships tm join public.mail_contact_tags t on t.id=tm.tag_id where tm.contact_id=c.id),''[]'') as tags,
    coalesce((select jsonb_agg(lm.list_id) from public.mail_contact_list_memberships lm where lm.contact_id=c.id),''[]'') as list_ids,
    coalesce((select jsonb_object_agg(cv.field_id,cv.value) from public.mail_contact_field_values cv where cv.contact_id=c.id),''{}'') as custom_fields
    from public.mail_contact_audience c where %s order by c.%I %s nulls last,c.id %s limit %s offset %s) r',predicate,sort_col,direction,direction,size,p*size) into rows;
  return jsonb_build_object('contacts',rows,'count',total,'page',p,'page_size',size);
end $$;

create function public.mail_audience_metadata() returns jsonb language sql security definer set search_path=public,pg_temp set statement_timeout='8s' as $$
select jsonb_build_object('metrics',(select jsonb_build_object('total',count(*) filter(where archived_at is null),'eligible',count(*) filter(where eligible),'unsubscribed',count(*) filter(where consent_status='unsubscribed' and archived_at is null),'suppressed',count(*) filter(where suppression_reason is not null and archived_at is null)) from public.mail_contact_audience),
  'resources',jsonb_build_object(
    'fields',coalesce((select jsonb_agg(to_jsonb(f)) from (select id,name,key,type,options from public.mail_contact_fields order by created_at limit 50) f),'[]'),
    'tags',coalesce((select jsonb_agg(to_jsonb(t)) from (select id,name from public.mail_contact_tags order by name limit 500) t),'[]'),
    'segments',coalesce((select jsonb_agg(to_jsonb(s)) from (select id,name,description,filter from public.mail_audience_segments order by created_at desc limit 100) s),'[]'),
    'lists',coalesce((select jsonb_agg(to_jsonb(l)) from (select l.id,l.name,l.description,(select count(*) from public.mail_contact_list_memberships lm where lm.list_id=l.id) as count from public.mail_contact_lists l order by l.created_at desc limit 100) l),'[]')))
$$;

-- All related profile, consent, tag, list and custom-field writes commit together.
create function public.mail_contact_save(payload jsonb, target uuid default null, import_mode boolean default false) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.mail_contacts; cid uuid; existing public.mail_contacts; permission jsonb; tag text; tagid uuid; entry record; f public.mail_contact_fields; val jsonb; name_value text;
begin
  if octet_length(payload::text)>50000 then raise exception 'Contact is too large' using errcode='22023'; end if;
  if lower(trim(payload->>'email')) !~* '^(?!\.)(?!.*\.\.)([A-Z0-9_''+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$' or length(payload->>'email')>320 then raise exception 'Enter a valid email address' using errcode='22023'; end if;
  name_value=nullif(trim(coalesce(payload->>'first_name','')||' '||coalesce(payload->>'last_name','')),'');
  if target is not null then
    select * into strict existing from public.mail_contacts where id=target for update;
    if existing.normalized_email<>lower(trim(payload->>'email')) then raise exception 'Email is fixed to preserve consent and campaign history' using errcode='22023'; end if;
    cid=target;
    update public.mail_contacts set first_name=payload->>'first_name',last_name=payload->>'last_name',name=name_value,phone=payload->>'phone',company=payload->>'company',job_title=payload->>'job_title',lifecycle_status=payload->>'lifecycle_status',lead_source=payload->>'lead_source',notes=coalesce(payload->>'notes',notes),updated_at=now() where id=cid;
  else
    cid=coalesce((payload->>'id')::uuid,gen_random_uuid());
    insert into public.mail_contacts(id,email,name,first_name,last_name,phone,company,job_title,lifecycle_status,lead_source,notes) values(cid,lower(trim(payload->>'email')),name_value,payload->>'first_name',payload->>'last_name',payload->>'phone',payload->>'company',payload->>'job_title',payload->>'lifecycle_status',payload->>'lead_source',coalesce(payload->>'notes',''));
  end if;
  permission=payload->'consent';
  if permission is not null and (not import_mode or target is null) then
    if permission->>'status'='granted' and (nullif(trim(permission->>'method'),'') is null or nullif(trim(permission->>'source'),'') is null or nullif(trim(permission->>'evidence'),'') is null or nullif(permission->>'at','') is null or (permission->>'at')::timestamptz>now() or lower(trim(permission->>'source')) in ('csv','import','upload','manual')) then raise exception 'Record original permission source, timestamp, method and evidence before granting consent' using errcode='22023'; end if;
    if permission->>'status'='granted' and exists(select 1 from public.mail_suppressions where normalized_email=lower(trim(payload->>'email'))) then raise exception 'This address is suppressed. Imports or profile edits cannot override its sending block' using errcode='22023'; end if;
    if permission->>'status'='granted' and target is not null and existing.consent_status in ('revoked','unsubscribed','denied') and import_mode then raise exception 'Imports cannot restore withdrawn permission' using errcode='22023'; end if;
    update public.mail_contacts set consent_status=permission->>'status',consent_source=nullif(permission->>'source',''),consented_at=(permission->>'at')::timestamptz,consent_method=coalesce(permission->>'method',''),consent_evidence=coalesce(permission->>'evidence','') where id=cid;
    insert into public.mail_contact_consents(contact_id,status,method,source,happened_at,evidence) values(cid,permission->>'status',coalesce(permission->>'method',''),permission->>'source',(permission->>'at')::timestamptz,coalesce(permission->>'evidence',''));
    if permission->>'status' in ('unsubscribed','revoked','denied') then insert into public.mail_suppressions(normalized_email,reason,source) values(lower(trim(payload->>'email')),case when permission->>'status'='unsubscribed' then 'unsubscribed' else 'consent_withdrawn' end,'contact permission record') on conflict(normalized_email) do nothing; end if;
  end if;
  if payload ? 'tags' then
    if jsonb_array_length(payload->'tags')>20 then raise exception 'Use at most 20 tags per contact' using errcode='22023'; end if;
    if not import_mode then delete from public.mail_contact_tag_memberships where contact_id=cid; end if;
    for tag in select distinct trim(value) from jsonb_array_elements_text(payload->'tags') loop
      if length(tag) not between 1 and 50 then raise exception 'Invalid tag' using errcode='22023'; end if;
      insert into public.mail_contact_tags(name) values(tag) on conflict(lower(name)) do update set name=mail_contact_tags.name returning id into tagid;
      insert into public.mail_contact_tag_memberships values(cid,tagid) on conflict do nothing;
    end loop;
  end if;
  if payload ? 'list_ids' then
    if jsonb_array_length(payload->'list_ids')>20 then raise exception 'Use at most 20 lists per contact' using errcode='22023'; end if;
    if not import_mode then delete from public.mail_contact_list_memberships where contact_id=cid; end if;
    insert into public.mail_contact_list_memberships(list_id,contact_id) select value::uuid,cid from jsonb_array_elements_text(payload->'list_ids') on conflict do nothing;
  end if;
  for entry in select * from jsonb_each(coalesce(payload->'custom_fields','{}')) loop
    select * into strict f from public.mail_contact_fields where id=entry.key::uuid; val=entry.value;
    if val='null'::jsonb or val='""'::jsonb then delete from public.mail_contact_field_values where contact_id=cid and field_id=f.id; continue; end if;
    if (f.type='text' and (jsonb_typeof(val)<>'string' or length(val#>>'{}')>2000)) or (f.type='number' and jsonb_typeof(val)<>'number') or (f.type='boolean' and jsonb_typeof(val)<>'boolean') or (f.type='date' and (jsonb_typeof(val)<>'string' or (val#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$')) or (f.type='single_select' and not (f.options @> jsonb_build_array(val))) or (f.type='multi_select' and (jsonb_typeof(val)<>'array' or not (f.options @> val))) then raise exception 'Invalid custom field value' using errcode='22023'; end if;
    if f.type='date' then perform (val#>>'{}')::date; end if;
    insert into public.mail_contact_field_values values(cid,f.id,val) on conflict(contact_id,field_id) do update set value=excluded.value;
  end loop;
  insert into public.mail_contact_history(contact_id,action,detail) values(cid,case when target is null then 'created' when import_mode then 'import_updated' else 'updated' end,jsonb_build_object('source',case when import_mode then 'import' else 'administrator' end));
  return cid;
end $$;

create function public.mail_audience_resource_save(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid=coalesce((payload->>'id')::uuid,gen_random_uuid()); field public.mail_contact_fields; begin
  perform pg_advisory_xact_lock(76517007);
  if payload->>'kind'='segment' then
    perform public.mail_audience_filter_sql(payload->'filter');
    if not payload ? 'id' and (select count(*) from public.mail_audience_segments)>=100 then raise exception 'Up to 100 segments are supported' using errcode='22023'; end if;
    insert into public.mail_audience_segments(id,name,description,filter) values(target,payload->>'name',coalesce(payload->>'description',''),payload->'filter') on conflict(id) do update set name=excluded.name,description=excluded.description,filter=excluded.filter,updated_at=now();
  elsif payload->>'kind'='list' then
    if not payload ? 'id' and (select count(*) from public.mail_contact_lists)>=100 then raise exception 'Up to 100 lists are supported' using errcode='22023'; end if;
    insert into public.mail_contact_lists(id,name,description) values(target,payload->>'name',coalesce(payload->>'description','')) on conflict(id) do update set name=excluded.name,description=excluded.description;
  elsif payload->>'kind'='field' then
    if not payload ? 'id' and (select count(*) from public.mail_contact_fields)>=50 then raise exception 'Up to 50 custom fields are supported' using errcode='22023'; end if;
    select * into field from public.mail_contact_fields where id=target;
    if found and (field.type<>payload->>'type' or field.key<>payload->>'key' or not coalesce(payload->'options','[]') @> field.options) then raise exception 'Field type and key are fixed; existing select options cannot be removed' using errcode='22023'; end if;
    insert into public.mail_contact_fields(id,name,key,type,options) values(target,payload->>'name',payload->>'key',payload->>'type',coalesce(payload->'options','[]')) on conflict(id) do update set name=excluded.name,options=excluded.options;
  else raise exception 'Unsupported resource' using errcode='22023'; end if;
  return target;
end $$;

create function public.mail_contact_bulk(action text, ids uuid[], value jsonb default '{}') returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; tag text; tagid uuid; affected integer=0; begin
  if cardinality(ids)>1000 or cardinality(ids)<1 then raise exception 'Select 1 to 1000 contacts' using errcode='22023'; end if;
  for cid in select id from public.mail_contacts where id=any(ids) order by id for update loop
    if action='archive' then update public.mail_contacts set archived_at=now(),updated_at=now() where id=cid;
    elsif action='restore' then update public.mail_contacts set archived_at=null,updated_at=now() where id=cid;
    elsif action='tag' then
      tag=trim(value->>'tag'); if length(tag) not between 1 and 50 then raise exception 'Enter a tag' using errcode='22023'; end if;
      if (select count(*) from public.mail_contact_tag_memberships where contact_id=cid)>=20 then raise exception 'A contact already has 20 tags' using errcode='22023'; end if;
      insert into public.mail_contact_tags(name) values(tag) on conflict(lower(name)) do update set name=mail_contact_tags.name returning id into tagid;
      insert into public.mail_contact_tag_memberships values(cid,tagid) on conflict do nothing;
    elsif action='list' then insert into public.mail_contact_list_memberships(list_id,contact_id) values((value->>'list_id')::uuid,cid) on conflict do nothing;
    elsif action='remove_list' then delete from public.mail_contact_list_memberships where contact_id=cid and list_id=(value->>'list_id')::uuid;
    elsif action='suppress' then insert into public.mail_suppressions(normalized_email,reason,source) select normalized_email,'manual_block','audience administrator' from public.mail_contacts where id=cid on conflict(normalized_email) do nothing;
    else raise exception 'Unsupported bulk action' using errcode='22023'; end if;
    insert into public.mail_contact_history(contact_id,action,detail) values(cid,action,value); affected=affected+1;
  end loop;
  return affected;
end $$;

-- Incremental engagement comes from real recipient rows, not synthetic analytics.
create function public.mail_contact_engagement_refresh() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.contact_id is not null then
    update public.mail_contacts c set last_contacted_at=a.sent,last_opened_at=a.opened,last_clicked_at=a.clicked,campaign_count=a.campaigns
    from (select max(accepted_at) as sent,max(opened_at) as opened,max(clicked_at) as clicked,count(distinct campaign_id) filter(where accepted_at is not null)::integer as campaigns from public.mail_recipients where contact_id=new.contact_id) a where c.id=new.contact_id;
  end if; return new;
end $$;
create trigger mail_contact_engagement after insert or update of accepted_at,opened_at,clicked_at on public.mail_recipients for each row execute function public.mail_contact_engagement_refresh();
update public.mail_contacts c set last_contacted_at=a.sent,last_opened_at=a.opened,last_clicked_at=a.clicked,campaign_count=a.campaigns from (select contact_id,max(accepted_at) as sent,max(opened_at) as opened,max(clicked_at) as clicked,count(distinct campaign_id) filter(where accepted_at is not null)::integer as campaigns from public.mail_recipients where contact_id is not null group by contact_id) a where c.id=a.contact_id;
create function public.mail_contact_suppression_history() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; begin
  select id into cid from public.mail_contacts where normalized_email=new.normalized_email;
  if cid is not null then
    insert into public.mail_contact_history(contact_id,action,detail) values(cid,'suppressed',jsonb_build_object('reason',new.reason,'source',new.source));
    if new.reason in ('unsubscribed','unsubscribe') then
      update public.mail_contacts set consent_status='unsubscribed',updated_at=now() where id=cid and consent_status<>'unsubscribed';
      if found then insert into public.mail_contact_consents(contact_id,status,method,source,happened_at) values(cid,'unsubscribed','provider_event',new.source,now()); end if;
    end if;
  end if; return new;
end $$;
create trigger mail_contact_suppression_history after insert or update of reason on public.mail_suppressions for each row execute function public.mail_contact_suppression_history();

-- Persisted import batches: transaction-level row claims, safe restart and deterministic duplicates.
create function public.mail_import_stage(target uuid, batch jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.mail_contact_imports; r jsonb; n integer; added integer=0; existing jsonb; begin
  select * into strict job from public.mail_contact_imports where id=target for update;
  if job.status<>'uploading' or jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)>200 then raise exception 'Import is not accepting upload batches' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(batch) loop
    n=(r->>'row_number')::integer; if n<1 or n>job.total_rows then raise exception 'Invalid import row number' using errcode='22023'; end if;
    select data into existing from public.mail_contact_import_rows where job_id=target and row_number=n;
    if found then if existing<>r->'data' then raise exception 'This upload does not match the staged file' using errcode='22023'; end if; continue; end if;
    insert into public.mail_contact_import_rows(job_id,row_number,data,normalized_email,error) values(target,n,r->'data',lower(trim(r->'data'->>'email')),r->>'error'); added=added+1;
  end loop;
  update public.mail_contact_imports set staged_count=staged_count+added,updated_at=now() where id=target;
  return job.staged_count+added;
end $$;

create function public.mail_process_import_batch(target uuid default null, batch_size integer default 100) returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='20s' as $$
declare job public.mail_contact_imports; r public.mail_contact_import_rows; cid uuid; payload jsonb; outcome text; permitted jsonb; tag_values jsonb; begin
  select * into job from public.mail_contact_imports where status in ('queued','running') and (target is null or id=target) order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.mail_contact_imports set status='running',updated_at=now() where id=job.id;
  for r in select * from public.mail_contact_import_rows where job_id=job.id and status='pending' order by row_number limit greatest(1,least(batch_size,200)) for update loop
    begin
      cid=null;
      if r.error is not null then outcome='invalid';
      elsif exists(select 1 from public.mail_contact_import_rows prev where prev.job_id=job.id and prev.row_number<r.row_number and prev.normalized_email=r.normalized_email) then outcome='duplicate';
      else
        select id into cid from public.mail_contacts where normalized_email=r.normalized_email for update;
        if cid is not null and job.mode='skip' then outcome='skipped';
        else
          payload=r.data;
          if cid is not null then
            -- Only supplied profile/custom fields may change; permission, archive and engagement remain untouched.
            select jsonb_build_object('email',email,'first_name',first_name,'last_name',last_name,'phone',phone,'company',company,'job_title',job_title,'lifecycle_status',lifecycle_status,'lead_source',lead_source,'notes',notes) into permitted from public.mail_contacts where id=cid;
            payload=permitted||(coalesce(r.data->'_supplied',payload)-'consent'-'id');
          end if;
          select coalesce(jsonb_agg(distinct value),'[]') into tag_values from (select value from jsonb_array_elements(coalesce(payload->'tags','[]')) union select to_jsonb(unnest(job.tags))) tags;
          payload=payload||jsonb_build_object('tags',tag_values,'list_ids',case when job.list_id is null then '[]'::jsonb else jsonb_build_array(job.list_id) end);
          outcome=case when cid is null then 'imported' else 'updated' end;
          cid=public.mail_contact_save(payload,cid,true);
          insert into public.mail_contact_history(contact_id,action,detail) values(cid,'imported',jsonb_build_object('job_id',job.id,'file',job.file_name,'row',r.row_number));
        end if;
      end if;
      update public.mail_contact_import_rows set status=outcome,contact_id=cid where job_id=job.id and row_number=r.row_number;
    exception when unique_violation then update public.mail_contact_import_rows set status='skipped',error='Email already exists; no permission state was changed' where job_id=job.id and row_number=r.row_number;
      when others then update public.mail_contact_import_rows set status='failed',error=case when sqlstate='22023' then left(sqlerrm,300) else 'Row could not be saved; review values and permission evidence' end where job_id=job.id and row_number=r.row_number;
    end;
  end loop;
  update public.mail_contact_imports set
    processed_count=a.processed,imported_count=a.imported,updated_count=a.updated,skipped_count=a.skipped,invalid_count=a.invalid,duplicate_count=a.duplicates,failed_count=a.failed,
    status=case when a.processed=total_rows then 'completed' else 'running' end,updated_at=now(),last_error=null
  from (select count(*) filter(where status<>'pending')::integer as processed,count(*) filter(where status='imported')::integer as imported,count(*) filter(where status='updated')::integer as updated,count(*) filter(where status='skipped')::integer as skipped,count(*) filter(where status='invalid')::integer as invalid,count(*) filter(where status='duplicate')::integer as duplicates,count(*) filter(where status='failed')::integer as failed from public.mail_contact_import_rows where job_id=job.id) a where id=job.id;
  return jsonb_build_object('id',job.id);
exception when others then
  if job.id is null then raise; end if;
  update public.mail_contact_imports set attempts=attempts+1,status=case when attempts>=2 then 'failed' else 'queued' end,last_error='Batch interrupted. Progress was rolled back; resume after checking storage.',updated_at=now() where id=job.id;
  return jsonb_build_object('id',job.id,'retry',true);
end $$;

-- No browser access. Existing HMAC-admin server guard remains the sole application entry point.
do $$ declare t text; f record; begin
  foreach t in array array['mail_contact_tags','mail_contact_tag_memberships','mail_contact_fields','mail_contact_field_values','mail_audience_segments','mail_contact_lists','mail_contact_list_memberships','mail_contact_consents','mail_contact_history','mail_contact_imports','mail_contact_import_rows'] loop
    execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t); execute format('grant select,insert,update,delete on table public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('mail_audience_filter_sql','mail_audience_query','mail_audience_metadata','mail_contact_save','mail_audience_resource_save','mail_contact_bulk','mail_contact_engagement_refresh','mail_contact_suppression_history','mail_import_stage','mail_process_import_batch') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
revoke all on public.mail_contact_audience from public,anon,authenticated;
grant select on public.mail_contact_audience to service_role;
notify pgrst,'reload schema';
commit;
