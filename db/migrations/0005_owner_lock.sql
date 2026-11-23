-- 0005_owner_lock.sql  (WorkOS, 2026-10-26)
-- Single-owner lock. Until now any signed-in user could read and write everything, so an open
-- sign-up endpoint was a risk. Policies now require auth.uid() to match the owner's user id, so a
-- stranger who signs up reads and writes nothing. Owner id is stored in os_settings.owner_uid.
insert into public.os_settings (key, value) values ('owner_uid', to_jsonb('f8a39d57-03c5-4f4b-abf3-b822063b5b0c'::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.os_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and auth.uid()::text = (select value #>> '{}' from public.os_settings where key = 'owner_uid');
$$;
revoke all on function public.os_is_owner() from public;
grant execute on function public.os_is_owner() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['os_tasks','os_reminders','os_days','os_habits','os_habit_logs','os_events','os_campaign_snapshots','os_settings','os_notes','os_finance_entries','os_push_subscriptions','os_sms_days']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.os_is_owner()) with check (public.os_is_owner())', t || '_owner_all', t);
  end loop;
end $$;
