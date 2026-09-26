begin;
alter table public.profiles add column username text unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
create table public.account_invitations (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 token_hash text not null unique, role text not null check(role in ('worker','viewer')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '48 hours', revoked_at timestamptz,
 used_at timestamptz, used_by uuid references public.profiles(id)
);
alter table public.account_invitations enable row level security;
revoke all on public.account_invitations from public,anon,authenticated;
grant select(id,project_id,role,created_by,created_at,expires_at,revoked_at,used_at,used_by) on public.account_invitations to authenticated;
grant select on public.account_invitations to service_role;
create policy admin_read on public.account_invitations for select to authenticated using(private.can_manage(project_id));
create function public.create_account_invitation(p_project_id uuid,p_role text default 'worker') returns jsonb
language plpgsql security definer set search_path='' as $$
declare token text := replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''); inv public.account_invitations;
begin
 perform 1 from public.projects where id=p_project_id for update;
 if not private.can_manage(p_project_id) then raise exception 'project_admin_required' using errcode='42501'; end if;
 if p_role not in ('worker','viewer') then raise exception 'invalid_role'; end if;
 insert into public.account_invitations(project_id,token_hash,role,created_by)
 values(p_project_id,encode(sha256(convert_to(token,'UTF8')),'hex'),p_role,auth.uid()) returning * into inv;
 return jsonb_build_object('id',inv.id,'token',token,'expires_at',inv.expires_at);
end $$;
create function public.revoke_account_invitation(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p uuid;
begin
 select project_id into p from public.account_invitations where id=p_id;
 perform 1 from public.projects where id=p for update;
 if not private.can_manage(p) then raise exception 'project_admin_required' using errcode='42501'; end if;
 update public.account_invitations set revoked_at=now() where id=p_id and used_at is null;
end $$;
revoke all on function public.create_account_invitation(uuid,text), public.revoke_account_invitation(uuid) from public,anon;
grant execute on function public.create_account_invitation(uuid,text), public.revoke_account_invitation(uuid) to authenticated;
-- Admin Auth creates the user and this trigger consumes the invitation in the same transaction.
-- Ordinary public signup cannot set raw_app_meta_data and is rejected.
create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare inv public.account_invitations; p uuid; uname text;
begin
 select project_id into p from public.account_invitations where token_hash=new.raw_app_meta_data->>'invitation_hash';
 perform 1 from public.projects where id=p for update;
 select * into inv from public.account_invitations where token_hash=new.raw_app_meta_data->>'invitation_hash' for update;
 if inv.id is null or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at<=now()
 or not exists(select 1 from public.projects where id=p and archived_at is null)
 or not exists(select 1 from public.project_members where project_id=p and user_id=inv.created_by and role='admin' and status='active') then
  raise exception 'invitation_invalid';
 end if;
 uname := new.raw_app_meta_data->>'username';
 if uname is null or uname !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then raise exception 'invalid_username'; end if;
 insert into public.profiles(id,display_name,username) values(new.id,uname,uname);
 insert into public.project_members(project_id,user_id,role,status) values(p,new.id,inv.role,'active');
 update public.account_invitations set used_at=now(),used_by=new.id where id=inv.id;
 return new;
end $$;
notify pgrst,'reload schema';
commit;
