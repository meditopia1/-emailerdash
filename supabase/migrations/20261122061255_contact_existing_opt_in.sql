-- Private create-only path for the administrator's declaration of prior opt-in.
-- Reuses the atomic save and its duplicate/suppression checks. Never updates an
-- existing contact or rewrites the original permission history.
begin;
create or replace function public.mail_contact_add_opted_in(payload jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
begin
  return public.mail_contact_save(
    (payload - 'existing_opt_in' - 'consent') || jsonb_build_object('consent', jsonb_build_object(
      'status', 'granted',
      'method', 'administrator_attestation',
      'source', 'Administrator declaration of existing opt-in',
      'at', now(),
      'evidence', 'Administrator confirms this contact already opted in before being added. This timestamp records the declaration, not the original opt-in date.'
    ))
  );
end;
$$;
revoke all on function public.mail_contact_add_opted_in(jsonb) from public, anon, authenticated;
grant execute on function public.mail_contact_add_opted_in(jsonb) to service_role;
commit;
