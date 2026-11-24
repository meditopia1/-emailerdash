-- Additive migration: existing campaigns, queue, and RLS stay intact.
begin;

alter table public.mail_campaigns
  add column if not exists audience_contact_ids uuid[] not null default '{}',
  add column if not exists revision integer not null default 0,
  add column if not exists workflow_layout jsonb not null default '{}',
  add column if not exists layout_revision integer not null default 0;

create or replace function public.bump_mail_campaign_builder_revisions()
returns trigger language plpgsql set search_path = public as $$
begin
  if row(new.name, new.sender_name, new.from_email, new.reply_to, new.subject,
         new.preheader, new.content_html, new.content_text, new.status, new.audience_contact_ids)
     is distinct from
     row(old.name, old.sender_name, old.from_email, old.reply_to, old.subject,
         old.preheader, old.content_html, old.content_text, old.status, old.audience_contact_ids) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  new.layout_revision := old.layout_revision + case when new.workflow_layout is distinct from old.workflow_layout then 1 else 0 end;
  return new;
end;
$$;

drop trigger if exists mail_campaign_builder_revisions on public.mail_campaigns;
create trigger mail_campaign_builder_revisions before update on public.mail_campaigns
for each row execute function public.bump_mail_campaign_builder_revisions();

commit;
