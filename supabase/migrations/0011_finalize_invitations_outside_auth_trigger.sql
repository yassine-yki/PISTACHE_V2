begin;

-- Supabase Auth reports a generic 500 when an auth.users trigger fails. Finalize
-- the project membership explicitly from the Edge Function instead, then clean
-- up the Auth user if this transaction is rejected.
drop trigger if exists pistache_auth_profile on auth.users;

create or replace function public.complete_account_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_username text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  inv public.account_invitations;
  uname text := lower(btrim(p_username));
begin
  select * into inv
  from public.account_invitations
  where token_hash = p_token_hash
  for update;

  if inv.id is null or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now()
    or not exists(select 1 from public.projects where id = inv.project_id and archived_at is null)
    or not exists(
      select 1 from public.project_members
      where project_id = inv.project_id and user_id = inv.created_by and role = 'admin' and status = 'active'
    ) then
    raise exception 'invitation_invalid';
  end if;

  if uname !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'invalid_username';
  end if;

  if not exists(
    select 1 from auth.users
    where id = p_user_id
      and raw_app_meta_data->>'invitation_hash' = p_token_hash
      and raw_app_meta_data->>'username' = uname
  ) then
    raise exception 'auth_user_mismatch';
  end if;

  insert into public.profiles(id, display_name, username) values(p_user_id, uname, uname);
  insert into public.project_members(project_id, user_id, role, status)
  values(inv.project_id, p_user_id, inv.role, 'active');
  update public.account_invitations set used_at = now(), used_by = p_user_id where id = inv.id;

  return jsonb_build_object('created', true, 'project_id', inv.project_id, 'role', inv.role);
end $$;

revoke all on function public.complete_account_invitation(text,uuid,text) from public, anon, authenticated;
grant execute on function public.complete_account_invitation(text,uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
