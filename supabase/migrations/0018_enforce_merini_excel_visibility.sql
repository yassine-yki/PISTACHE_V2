-- Self-contained corrective migration: enforce personal exclusions for admins,
-- then match the project owner's visibility to Excel VERSION 3.
begin;

create or replace function private.task_type_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((
    select private.project_role(project_id) is not null
      and not (auth.uid() = any(hidden_user_ids))
      and (private.project_role(project_id) = 'admin' or not hidden)
    from public.task_types where id=p_id
  ),false)
$$;

drop policy if exists task_visibility on public.task_types;
create policy task_visibility on public.task_types as restrictive for select to authenticated
using (
  private.project_role(project_id) is not null
  and not (auth.uid() = any(hidden_user_ids))
  and (private.project_role(project_id) = 'admin' or not hidden)
);

drop policy if exists task_visibility on public.room_tasks;
create policy task_visibility on public.room_tasks as restrictive for select to authenticated
using (private.task_visible(id));

do $$
declare
  v_project record;
  v_user_id uuid;
  v_hidden_columns text[] := array[
    'E','F','G','H','I','J','N','R','S','T','U','V','W','X','Y','Z',
    'AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM',
    'AO','AP','AQ','AT','AU','AV','AW','BB','BC','BI','BJ','BK','BL',
    'BM','BN','BO','BP','BQ','BR','BS','BT'
  ];
begin
  for v_project in
    select id, created_by from public.projects where archived_at is null
  loop
    -- Prefer the explicitly named admin. Fall back to the project creator,
    -- which is the original administrator of this existing project.
    select pm.user_id into v_user_id
    from public.project_members pm
    join public.profiles p on p.id=pm.user_id
    where pm.project_id=v_project.id and pm.role='admin' and pm.status='active'
      and regexp_replace(lower(btrim(p.display_name)), '\s+', ' ', 'g')
        in ('merini yassine','menini yassine','yassine merini','yassine menini')
    order by p.created_at
    limit 1;

    if v_user_id is null and exists (
      select 1 from public.project_members
      where project_id=v_project.id and user_id=v_project.created_by
        and role='admin' and status='active'
    ) then
      v_user_id := v_project.created_by;
    end if;

    if v_user_id is null then
      raise exception 'Administrateur Merini Yassine introuvable pour le projet %', v_project.id;
    end if;

    update public.task_types tt
    set hidden_user_ids = case
      when tt.source_column = any(v_hidden_columns) then
        case when v_user_id = any(tt.hidden_user_ids)
          then tt.hidden_user_ids else array_append(tt.hidden_user_ids,v_user_id) end
      else array_remove(tt.hidden_user_ids,v_user_id)
    end,
    updated_at=now()
    where tt.project_id=v_project.id
      and tt.zone in ('bathroom','bedroom')
      and tt.source_column is not null
      and tt.archived_at is null;

    v_user_id := null;
  end loop;
end
$$;

commit;
