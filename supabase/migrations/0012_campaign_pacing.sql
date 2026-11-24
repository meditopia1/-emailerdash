-- Campaign pacing. Delay applies between recipients within one campaign.
begin;

alter table public.mail_campaigns
  add column if not exists send_delay_ms integer not null default 0
  check (send_delay_ms between 0 and 600000);

notify pgrst, 'reload schema';
commit;
