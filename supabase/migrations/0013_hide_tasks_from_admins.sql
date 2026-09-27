-- Individual exclusions apply to every member, including administrators.
-- Global task hiding remains bypassed by administrators unless they are named
-- explicitly in hidden_user_ids.
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
  private.project_role(project_id) = 'admin'
  or (private.project_role(project_id) is not null
    and not hidden
    and not (auth.uid() = any(hidden_user_ids)))
);

drop policy if exists task_visibility on public.room_tasks;
create policy task_visibility on public.room_tasks as restrictive for select to authenticated
using (private.task_visible(id));
