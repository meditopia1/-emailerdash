-- Run after 0003_lite_mail_model.sql.
-- The browser never receives direct table access. Server routes use the service role.

revoke all on table public.mail_settings, public.mail_contacts, public.mail_suppressions,
  public.mail_campaigns, public.mail_recipients, public.mail_events from anon, authenticated;
alter table public.mail_settings force row level security;
alter table public.mail_contacts force row level security;
alter table public.mail_suppressions force row level security;
alter table public.mail_campaigns force row level security;
alter table public.mail_recipients force row level security;
alter table public.mail_events force row level security;

alter table public.mail_contacts add constraint mail_contacts_email_length check (length(normalized_email) between 3 and 320);
alter table public.mail_suppressions add constraint mail_suppressions_reason_length check (length(reason) between 1 and 80);
alter table public.mail_campaigns add constraint mail_campaigns_subject_length check (length(subject) between 1 and 998);
alter table public.mail_campaigns add constraint mail_campaigns_content_present check (content_html is not null or content_text is not null);
alter table public.mail_recipients add constraint mail_recipients_status_allowed check (status in ('queued','processing','accepted','delivered','opened','clicked','failed','blocked','cancelled','unknown'));

create or replace function public.touch_mail_settings_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists mail_settings_touch_updated_at on public.mail_settings;
create trigger mail_settings_touch_updated_at before update on public.mail_settings for each row execute function public.touch_mail_settings_updated_at();

create or replace function public.claim_mail_recipients(batch_size integer default 50)
returns setof public.mail_recipients
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimed as (
    select id from public.mail_recipients
    where status = 'queued' and (reserved_at is null or reserved_at < now() - interval '15 minutes')
    order by id for update skip locked limit greatest(1, least(batch_size, 500))
  )
  update public.mail_recipients r set status = 'processing', reserved_at = now()
  from claimed c where r.id = c.id returning r.*;
end;
$$;
revoke all on function public.claim_mail_recipients(integer) from public, anon, authenticated;
grant execute on function public.claim_mail_recipients(integer) to service_role;
