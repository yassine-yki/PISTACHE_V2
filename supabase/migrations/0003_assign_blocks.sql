-- Assign existing active tasks across multiple floor/block pairs atomically.
create function public.assign_blocks(p_project_id uuid, p_block_ids uuid[], p_assignee_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare task record; changed integer := 0;
begin
  perform 1 from public.projects where id=p_project_id for update;
  if not private.can_manage(p_project_id) then raise exception 'project_admin_required' using errcode='42501'; end if;
  if coalesce(cardinality(p_block_ids),0)=0 then raise exception 'blocks_required'; end if;
  if exists (
    select 1 from unnest(p_block_ids) selected(id)
    where not exists (select 1 from public.blocks b join public.floors f on f.id=b.floor_id
      where b.id=selected.id and b.project_id=p_project_id and b.archived_at is null and f.archived_at is null)
  ) then raise exception 'invalid_block'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.project_members where project_id=p_project_id and user_id=p_assignee_id
      and status='active' and role in ('worker','admin')
  ) then raise exception 'active_worker_required'; end if;
  for task in select t.id from public.room_tasks t join public.rooms r on r.id=t.room_id
    where t.project_id=p_project_id and r.block_id=any(p_block_ids) and private.task_is_active(t.id)
    order by t.id
  loop
    if (select a.assignee_id from public.task_assignments a where a.room_task_id=task.id and a.ended_at is null)
      is distinct from p_assignee_id then
      perform public.assign_task(task.id,p_assignee_id,'Affectation par étage et bloc');
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;
revoke all on function public.assign_blocks(uuid,uuid[],uuid) from public, anon;
grant execute on function public.assign_blocks(uuid,uuid[],uuid) to authenticated;
