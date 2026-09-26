-- Exécuter dans Supabase SQL Editor sur le projet MUC.
-- Mise à niveau transactionnelle : conserve les avancements existants.
begin;

do $upgrade$ begin
 if true then
 execute $migration$-- Assign existing active tasks across multiple floor/block pairs atomically.
create or replace function public.assign_blocks(p_project_id uuid, p_block_ids uuid[], p_assignee_id uuid)
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
$migration$;
 end if;
end $upgrade$;

do $upgrade$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='room_tasks' and column_name='confirmed_day') then
 execute $migration$-- Existing shared progress is protected; new confirmations use the project calendar day.
alter table public.room_tasks add column confirmed_day date not null default ((now() at time zone 'Africa/Casablanca')::date);
alter table public.room_tasks add column locked_progress integer not null default 0 check (locked_progress between 0 and 100);
update public.room_tasks set locked_progress=progress;
create or replace function public.submit_progress(
  p_operation_id uuid, p_task_id uuid, p_assignment_id uuid, p_device_id uuid,
  p_base_version bigint, p_client_created_at timestamptz, p_payload jsonb,
  p_depends_on_operation_id uuid default null
) returns public.sync_operations language plpgsql security definer set search_path = '' as $$
declare
  v_task public.room_tasks; v_existing public.sync_operations; v_result public.sync_operations;
  v_dependency public.sync_operations; v_project uuid; v_role text; v_error text;
  v_status text := 'rejected'; v_progress integer; v_start date; v_end date;
  v_reason text; v_correction_note text; v_before jsonb; v_after jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_operation_id is null or p_device_id is null or p_base_version is null or p_base_version < 1
    or p_client_created_at is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_operation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select project_id into v_project from public.room_tasks where id = p_task_id;
  perform 1 from public.projects where id = v_project for update;
  v_role := private.project_role(v_project);
  if v_role is null then raise exception 'project_access_denied' using errcode = '42501'; end if;
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    if v_existing.submitted_by is distinct from auth.uid() or v_existing.room_task_id is distinct from p_task_id
      or v_existing.assignment_id is distinct from p_assignment_id or v_existing.device_id is distinct from p_device_id
      or v_existing.base_version is distinct from p_base_version or v_existing.client_created_at is distinct from p_client_created_at
      or v_existing.payload is distinct from p_payload or v_existing.depends_on_operation_id is distinct from p_depends_on_operation_id then
      raise exception 'operation_id_reused';
    end if;
    return v_existing;
  end if;
  select * into v_task from public.room_tasks where id = p_task_id for update;
  if p_assignment_id is not null and not exists (
    select 1 from public.task_assignments where id = p_assignment_id and room_task_id = p_task_id
  ) then raise exception 'invalid_assignment'; end if;
  if p_depends_on_operation_id is not null then
    select * into v_dependency from public.sync_operations where id = p_depends_on_operation_id;
    if not found then raise exception 'dependency_pending'; end if;
    if v_dependency.room_task_id <> p_task_id or v_dependency.submitted_by <> auth.uid() or v_dependency.device_id <> p_device_id then
      raise exception 'invalid_dependency';
    end if;
    if v_dependency.status <> 'accepted' or v_dependency.result_version <> p_base_version then v_error := 'dependency_failed'; end if;
  end if;
  v_reason := p_payload->>'correction_reason';
  v_correction_note := p_payload->>'correction_note';
  if v_error is null and not private.task_is_active(p_task_id) then v_error := 'task_archived'; end if;
  if v_error is null and v_role = 'viewer' then v_error := 'permission_denied'; end if;
  if v_error is null and not (v_reason is not null and v_role = 'admin') and not exists (
    select 1 from public.task_assignments where id = p_assignment_id and room_task_id = p_task_id
      and assignee_id = auth.uid() and ended_at is null
  ) then v_error := 'assignment_changed'; end if;
  if v_error is null and v_task.version <> p_base_version then v_error := 'version_conflict'; v_status := 'conflict'; end if;
  if v_error is null then
    begin
      if not (p_payload ?& array['progress', 'blocked', 'note', 'start_date', 'end_date'])
        or exists (select 1 from jsonb_object_keys(p_payload) k where k not in
          ('progress', 'blocked', 'note', 'start_date', 'end_date', 'correction_reason', 'correction_note'))
        or jsonb_typeof(p_payload->'progress') <> 'number'
        or (p_payload->>'progress') !~ '^[0-9]{1,3}$'
        or jsonb_typeof(p_payload->'blocked') <> 'boolean'
        or jsonb_typeof(p_payload->'note') <> 'string'
        or jsonb_typeof(p_payload->'start_date') not in ('string', 'null')
        or jsonb_typeof(p_payload->'end_date') not in ('string', 'null') then raise exception 'invalid_payload'; end if;
      v_progress := (p_payload->>'progress')::integer;
      if v_progress not between 0 and 100 then raise exception 'invalid_progress'; end if;
      if (p_payload->>'start_date' is not null and (p_payload->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$')
        or (p_payload->>'end_date' is not null and (p_payload->>'end_date') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'invalid_dates'; end if;
      v_start := (p_payload->>'start_date')::date;
      v_end := (p_payload->>'end_date')::date;
      if v_end < v_start then raise exception 'invalid_dates'; end if;
      if (v_reason is null and v_correction_note is not null) or (v_reason is not null and
        (v_reason not in ('input-error', 'scope-change') or coalesce(btrim(v_correction_note), '') = ''
         or jsonb_typeof(p_payload->'correction_note') <> 'string')) then raise exception 'invalid_correction'; end if;
    exception when others then v_error := 'invalid_payload';
    end;
  end if;
  if v_error is null and v_progress < (case when v_task.confirmed_day < (now() at time zone 'Africa/Casablanca')::date then v_task.progress else v_task.locked_progress end) and v_reason is null then
    v_error := 'correction_required';
  end if;
  if v_error is null then v_status := 'accepted'; end if;
  insert into public.sync_operations(id, project_id, room_task_id, assignment_id, submitted_by,
    device_id, base_version, depends_on_operation_id, payload, client_created_at, status, result_version, error_code)
  values (p_operation_id, v_project, p_task_id, p_assignment_id, auth.uid(), p_device_id, p_base_version,
    p_depends_on_operation_id, p_payload, p_client_created_at, v_status,
    case when v_status = 'accepted' then v_task.version + 1 end, v_error) returning * into v_result;
  if v_status = 'accepted' then
    v_before := jsonb_build_object('progress', v_task.progress, 'blocked', v_task.blocked,
      'note', v_task.note, 'start_date', v_task.start_date, 'end_date', v_task.end_date);
    v_after := jsonb_build_object('progress', v_progress, 'blocked', (p_payload->>'blocked')::boolean,
      'note', p_payload->>'note', 'start_date', v_start, 'end_date', v_end);
    update public.room_tasks set locked_progress = case when confirmed_day < (now() at time zone 'Africa/Casablanca')::date then progress else locked_progress end, confirmed_day = (now() at time zone 'Africa/Casablanca')::date, progress = v_progress, blocked = (p_payload->>'blocked')::boolean,
      note = p_payload->>'note', start_date = v_start, end_date = v_end, version = version + 1, updated_by = auth.uid()
    where id = p_task_id;
    insert into public.progress_updates(project_id, room_task_id, operation_id, assignment_id, changed_by,
      source, previous_version, new_version, before_state, after_state, correction_reason, correction_note)
    values (v_project, p_task_id, p_operation_id, p_assignment_id, auth.uid(), 'user', v_task.version,
      v_task.version + 1, v_before, v_after, v_reason, v_correction_note);
  end if;
  return v_result;
end;
$$;
$migration$;
 end if;
end $upgrade$;

do $upgrade$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_types' and column_name='hidden') then
 execute $migration$-- Administrators can edit any active task in their project without an assignment.
-- Daily decrease justification and version conflict checks remain enforced.
create or replace function public.submit_progress(
  p_operation_id uuid, p_task_id uuid, p_assignment_id uuid, p_device_id uuid,
  p_base_version bigint, p_client_created_at timestamptz, p_payload jsonb,
  p_depends_on_operation_id uuid default null
) returns public.sync_operations language plpgsql security definer set search_path = '' as $$
declare
  v_task public.room_tasks; v_existing public.sync_operations; v_result public.sync_operations;
  v_dependency public.sync_operations; v_project uuid; v_role text; v_error text;
  v_status text := 'rejected'; v_progress integer; v_start date; v_end date;
  v_reason text; v_correction_note text; v_before jsonb; v_after jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_operation_id is null or p_device_id is null or p_base_version is null or p_base_version < 1
    or p_client_created_at is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_operation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select project_id into v_project from public.room_tasks where id = p_task_id;
  perform 1 from public.projects where id = v_project for update;
  v_role := private.project_role(v_project);
  if v_role is null then raise exception 'project_access_denied' using errcode = '42501'; end if;
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    if v_existing.submitted_by is distinct from auth.uid() or v_existing.room_task_id is distinct from p_task_id
      or v_existing.assignment_id is distinct from p_assignment_id or v_existing.device_id is distinct from p_device_id
      or v_existing.base_version is distinct from p_base_version or v_existing.client_created_at is distinct from p_client_created_at
      or v_existing.payload is distinct from p_payload or v_existing.depends_on_operation_id is distinct from p_depends_on_operation_id then
      raise exception 'operation_id_reused';
    end if;
    return v_existing;
  end if;
  select * into v_task from public.room_tasks where id = p_task_id for update;
  if p_assignment_id is not null and not exists (
    select 1 from public.task_assignments where id = p_assignment_id and room_task_id = p_task_id
  ) then raise exception 'invalid_assignment'; end if;
  if p_depends_on_operation_id is not null then
    select * into v_dependency from public.sync_operations where id = p_depends_on_operation_id;
    if not found then raise exception 'dependency_pending'; end if;
    if v_dependency.room_task_id <> p_task_id or v_dependency.submitted_by <> auth.uid() or v_dependency.device_id <> p_device_id then
      raise exception 'invalid_dependency';
    end if;
    if v_dependency.status <> 'accepted' or v_dependency.result_version <> p_base_version then v_error := 'dependency_failed'; end if;
  end if;
  v_reason := p_payload->>'correction_reason';
  v_correction_note := p_payload->>'correction_note';
  if v_error is null and not private.task_is_active(p_task_id) then v_error := 'task_archived'; end if;
  if v_error is null and v_role = 'viewer' then v_error := 'permission_denied'; end if;
  if v_error is null and v_role <> 'admin' and not exists (
    select 1 from public.task_assignments where id = p_assignment_id and room_task_id = p_task_id
      and assignee_id = auth.uid() and ended_at is null
  ) then v_error := 'assignment_changed'; end if;
  if v_error is null and v_task.version <> p_base_version then v_error := 'version_conflict'; v_status := 'conflict'; end if;
  if v_error is null then
    begin
      if not (p_payload ?& array['progress', 'blocked', 'note', 'start_date', 'end_date'])
        or exists (select 1 from jsonb_object_keys(p_payload) k where k not in
          ('progress', 'blocked', 'note', 'start_date', 'end_date', 'correction_reason', 'correction_note'))
        or jsonb_typeof(p_payload->'progress') <> 'number'
        or (p_payload->>'progress') !~ '^[0-9]{1,3}$'
        or jsonb_typeof(p_payload->'blocked') <> 'boolean'
        or jsonb_typeof(p_payload->'note') <> 'string'
        or jsonb_typeof(p_payload->'start_date') not in ('string', 'null')
        or jsonb_typeof(p_payload->'end_date') not in ('string', 'null') then raise exception 'invalid_payload'; end if;
      v_progress := (p_payload->>'progress')::integer;
      if v_progress not between 0 and 100 then raise exception 'invalid_progress'; end if;
      if (p_payload->>'start_date' is not null and (p_payload->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$')
        or (p_payload->>'end_date' is not null and (p_payload->>'end_date') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'invalid_dates'; end if;
      v_start := (p_payload->>'start_date')::date;
      v_end := (p_payload->>'end_date')::date;
      if v_end < v_start then raise exception 'invalid_dates'; end if;
      if (v_reason is null and v_correction_note is not null) or (v_reason is not null and
        (v_reason not in ('input-error', 'scope-change') or coalesce(btrim(v_correction_note), '') = ''
         or jsonb_typeof(p_payload->'correction_note') <> 'string')) then raise exception 'invalid_correction'; end if;
    exception when others then v_error := 'invalid_payload';
    end;
  end if;
  if v_error is null and v_progress < (case when v_task.confirmed_day < (now() at time zone 'Africa/Casablanca')::date then v_task.progress else v_task.locked_progress end) and v_reason is null then
    v_error := 'correction_required';
  end if;
  if v_error is null then v_status := 'accepted'; end if;
  insert into public.sync_operations(id, project_id, room_task_id, assignment_id, submitted_by,
    device_id, base_version, depends_on_operation_id, payload, client_created_at, status, result_version, error_code)
  values (p_operation_id, v_project, p_task_id, p_assignment_id, auth.uid(), p_device_id, p_base_version,
    p_depends_on_operation_id, p_payload, p_client_created_at, v_status,
    case when v_status = 'accepted' then v_task.version + 1 end, v_error) returning * into v_result;
  if v_status = 'accepted' then
    v_before := jsonb_build_object('progress', v_task.progress, 'blocked', v_task.blocked,
      'note', v_task.note, 'start_date', v_task.start_date, 'end_date', v_task.end_date);
    v_after := jsonb_build_object('progress', v_progress, 'blocked', (p_payload->>'blocked')::boolean,
      'note', p_payload->>'note', 'start_date', v_start, 'end_date', v_end);
    update public.room_tasks set locked_progress = case when confirmed_day < (now() at time zone 'Africa/Casablanca')::date then progress else locked_progress end, confirmed_day = (now() at time zone 'Africa/Casablanca')::date, progress = v_progress, blocked = (p_payload->>'blocked')::boolean,
      note = p_payload->>'note', start_date = v_start, end_date = v_end, version = version + 1, updated_by = auth.uid()
    where id = p_task_id;
    insert into public.progress_updates(project_id, room_task_id, operation_id, assignment_id, changed_by,
      source, previous_version, new_version, before_state, after_state, correction_reason, correction_note)
    values (v_project, p_task_id, p_operation_id, p_assignment_id, auth.uid(), 'user', v_task.version,
      v_task.version + 1, v_before, v_after, v_reason, v_correction_note);
  end if;
  return v_result;
end;
$$;
$migration$;
 end if;
end $upgrade$;

do $upgrade$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_types' and column_name='hidden') then
 execute $migration$alter table public.task_types add column hidden boolean not null default false;
alter table public.task_types add column hidden_user_ids uuid[] not null default '{}';
create function private.task_type_visible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.project_role(project_id) = 'admin' or (private.project_role(project_id) is not null and not hidden and not (auth.uid() = any(hidden_user_ids))) from public.task_types where id=p_id),false)
$$;
create function private.task_visible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.task_type_visible(task_type_id) from public.room_tasks where id=p_id),false)
$$;
grant execute on function private.task_type_visible(uuid), private.task_visible(uuid) to authenticated;
create policy task_visibility on public.task_types as restrictive for select to authenticated using (private.project_role(project_id) = 'admin' or (not hidden and not (auth.uid() = any(hidden_user_ids))));
create policy task_visibility on public.room_tasks as restrictive for select to authenticated using (private.project_role(project_id) = 'admin' or private.task_visible(id));
create policy task_visibility on public.task_assignments as restrictive for select to authenticated using (private.task_visible(room_task_id));
create policy task_visibility on public.progress_updates as restrictive for select to authenticated using (private.task_visible(room_task_id));
create policy task_visibility on public.progress_photos as restrictive for select to authenticated using (exists(select 1 from public.progress_updates u where u.id=progress_update_id));
create policy task_visibility on public.sync_operations as restrictive for select to authenticated using (private.task_visible(room_task_id));
create function public.manage_task_type(p_id uuid,p_label text,p_hidden boolean,p_hidden_user_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare p uuid;
begin
 select project_id into p from public.task_types where id=p_id;
 perform 1 from public.projects where id=p for update;
 if not private.can_manage(p) then raise exception 'project_admin_required' using errcode='42501'; end if;
 if p_label is null or length(btrim(p_label))=0 or length(p_label)>200 then raise exception 'invalid_label'; end if;
 if exists(select 1 from unnest(p_hidden_user_ids) u where not exists(select 1 from public.project_members where project_id=p and user_id=u)) then raise exception 'invalid_member'; end if;
 update public.task_types set label=btrim(p_label),hidden=coalesce(p_hidden,false),hidden_user_ids=coalesce(p_hidden_user_ids,'{}') where id=p_id;
end;
$$;
revoke all on function public.manage_task_type(uuid,text,boolean,uuid[]) from public,anon;
grant execute on function public.manage_task_type(uuid,text,boolean,uuid[]) to authenticated;
create or replace function public.submit_progress(
  p_operation_id uuid, p_task_id uuid, p_assignment_id uuid, p_device_id uuid,
  p_base_version bigint, p_client_created_at timestamptz, p_payload jsonb,
  p_depends_on_operation_id uuid default null
) returns public.sync_operations language plpgsql security definer set search_path = '' as $$
declare
  v_task public.room_tasks; v_existing public.sync_operations; v_result public.sync_operations;
  v_dependency public.sync_operations; v_project uuid; v_role text; v_error text;
  v_status text := 'rejected'; v_progress integer; v_start date; v_end date;
  v_reason text; v_correction_note text; v_before jsonb; v_after jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_operation_id is null or p_device_id is null or p_base_version is null or p_base_version < 1
    or p_client_created_at is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_operation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select project_id into v_project from public.room_tasks where id = p_task_id;
  perform 1 from public.projects where id = v_project for update;
  v_role := private.project_role(v_project);
  if v_role is null then raise exception 'project_access_denied' using errcode = '42501'; end if;
  select * into v_existing from public.sync_operations where id = p_operation_id;
  if found then
    if v_existing.submitted_by is distinct from auth.uid() or v_existing.room_task_id is distinct from p_task_id
      or v_existing.assignment_id is distinct from p_assignment_id or v_existing.device_id is distinct from p_device_id
      or v_existing.base_version is distinct from p_base_version or v_existing.client_created_at is distinct from p_client_created_at
      or v_existing.payload is distinct from p_payload or v_existing.depends_on_operation_id is distinct from p_depends_on_operation_id then
      raise exception 'operation_id_reused';
    end if;
    return v_existing;
  end if;
  select * into v_task from public.room_tasks where id = p_task_id for update;
  if p_assignment_id is not null and not exists (
    select 1 from public.task_assignments where id = p_assignment_id and room_task_id = p_task_id
  ) then raise exception 'invalid_assignment'; end if;
  if p_depends_on_operation_id is not null then
    select * into v_dependency from public.sync_operations where id = p_depends_on_operation_id;
    if not found then raise exception 'dependency_pending'; end if;
    if v_dependency.room_task_id <> p_task_id or v_dependency.submitted_by <> auth.uid() or v_dependency.device_id <> p_device_id then
      raise exception 'invalid_dependency';
    end if;
    if v_dependency.status <> 'accepted' or v_dependency.result_version <> p_base_version then v_error := 'dependency_failed'; end if;
  end if;
  v_reason := p_payload->>'correction_reason';
  v_correction_note := p_payload->>'correction_note';
  if v_error is null and not private.task_is_active(p_task_id) then v_error := 'task_archived'; end if;
  if v_error is null and not private.task_visible(p_task_id) then v_error := 'task_hidden'; end if;
  if v_error is null and v_role = 'viewer' then v_error := 'permission_denied'; end if;
  if v_error is null and v_role <> 'admin' and not exists (
    select 1 from public.task_assignments where id = p_assignment_id and room_task_id = p_task_id
      and assignee_id = auth.uid() and ended_at is null
  ) then v_error := 'assignment_changed'; end if;
  if v_error is null and v_task.version <> p_base_version then v_error := 'version_conflict'; v_status := 'conflict'; end if;
  if v_error is null then
    begin
      if not (p_payload ?& array['progress', 'blocked', 'note', 'start_date', 'end_date'])
        or exists (select 1 from jsonb_object_keys(p_payload) k where k not in
          ('progress', 'blocked', 'note', 'start_date', 'end_date', 'correction_reason', 'correction_note'))
        or jsonb_typeof(p_payload->'progress') <> 'number'
        or (p_payload->>'progress') !~ '^[0-9]{1,3}$'
        or jsonb_typeof(p_payload->'blocked') <> 'boolean'
        or jsonb_typeof(p_payload->'note') <> 'string'
        or jsonb_typeof(p_payload->'start_date') not in ('string', 'null')
        or jsonb_typeof(p_payload->'end_date') not in ('string', 'null') then raise exception 'invalid_payload'; end if;
      v_progress := (p_payload->>'progress')::integer;
      if v_progress not between 0 and 100 then raise exception 'invalid_progress'; end if;
      if (p_payload->>'start_date' is not null and (p_payload->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$')
        or (p_payload->>'end_date' is not null and (p_payload->>'end_date') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'invalid_dates'; end if;
      v_start := (p_payload->>'start_date')::date;
      v_end := (p_payload->>'end_date')::date;
      if v_end < v_start then raise exception 'invalid_dates'; end if;
      if (v_reason is null and v_correction_note is not null) or (v_reason is not null and
        (v_reason not in ('input-error', 'scope-change') or coalesce(btrim(v_correction_note), '') = ''
         or jsonb_typeof(p_payload->'correction_note') <> 'string')) then raise exception 'invalid_correction'; end if;
    exception when others then v_error := 'invalid_payload';
    end;
  end if;
  if v_error is null and v_progress < (case when v_task.confirmed_day < (now() at time zone 'Africa/Casablanca')::date then v_task.progress else v_task.locked_progress end) and v_reason is null then
    v_error := 'correction_required';
  end if;
  if v_error is null then v_status := 'accepted'; end if;
  insert into public.sync_operations(id, project_id, room_task_id, assignment_id, submitted_by,
    device_id, base_version, depends_on_operation_id, payload, client_created_at, status, result_version, error_code)
  values (p_operation_id, v_project, p_task_id, p_assignment_id, auth.uid(), p_device_id, p_base_version,
    p_depends_on_operation_id, p_payload, p_client_created_at, v_status,
    case when v_status = 'accepted' then v_task.version + 1 end, v_error) returning * into v_result;
  if v_status = 'accepted' then
    v_before := jsonb_build_object('progress', v_task.progress, 'blocked', v_task.blocked,
      'note', v_task.note, 'start_date', v_task.start_date, 'end_date', v_task.end_date);
    v_after := jsonb_build_object('progress', v_progress, 'blocked', (p_payload->>'blocked')::boolean,
      'note', p_payload->>'note', 'start_date', v_start, 'end_date', v_end);
    update public.room_tasks set locked_progress = case when confirmed_day < (now() at time zone 'Africa/Casablanca')::date then progress else locked_progress end, confirmed_day = (now() at time zone 'Africa/Casablanca')::date, progress = v_progress, blocked = (p_payload->>'blocked')::boolean,
      note = p_payload->>'note', start_date = v_start, end_date = v_end, version = version + 1, updated_by = auth.uid()
    where id = p_task_id;
    insert into public.progress_updates(project_id, room_task_id, operation_id, assignment_id, changed_by,
      source, previous_version, new_version, before_state, after_state, correction_reason, correction_note)
    values (v_project, p_task_id, p_operation_id, p_assignment_id, auth.uid(), 'user', v_task.version,
      v_task.version + 1, v_before, v_after, v_reason, v_correction_note);
  end if;
  return v_result;
end;
$$;
$migration$;
 end if;
end $upgrade$;

do $upgrade$ begin
 if to_regprocedure('private.add_tracking_floors(uuid)') is null then
 execute $migration$create function private.add_tracking_floors(p uuid) returns void language plpgsql security definer set search_path='' as $$
declare f uuid; n integer; v_code text;
begin
 foreach v_code in array array['r3','r4','r5'] loop
  insert into public.floors(project_id,code,label) values(p,v_code,'R+'||right(v_code,1)) on conflict(project_id,code) do nothing;
  select id into f from public.floors where project_id=p and floors.code=v_code;
  if v_code='r3' then
   insert into public.blocks(project_id,floor_id,code,label) select p,f,b.code,b.label from public.blocks b join public.floors x on x.id=b.floor_id where x.project_id=p and x.code='r2' on conflict do nothing;
   insert into public.rooms(project_id,floor_id,block_id,number,room_type)
   select p,f,b3.id,(r.number::int+100)::text,r.room_type from public.rooms r join public.floors x on x.id=r.floor_id left join public.blocks b2 on b2.id=r.block_id left join public.blocks b3 on b3.floor_id=f and b3.code=b2.code where x.project_id=p and x.code='r2' and r.number ~ '^2[0-9]{2}$' on conflict(floor_id,number) do nothing;
  else
   for n in 1..(case when v_code='r4' then 24 else 25 end) loop
    insert into public.rooms(project_id,floor_id,number,room_type) values(p,f,(right(v_code,1)::int*100+n)::text,'standard') on conflict(floor_id,number) do nothing;
   end loop;
  end if;
 end loop;
end;
$$;
revoke all on function private.add_tracking_floors(uuid) from public,anon,authenticated;
do $$ declare p uuid; previous_user text := current_setting('request.jwt.claim.sub',true); admin_user uuid; begin
 for p in select distinct f.project_id from public.floors f join public.rooms r on r.floor_id=f.id where f.code='r2' and r.number='240' loop
 select user_id into admin_user from public.project_members where project_id=p and role='admin' and status='active' limit 1;
 if admin_user is not null then
 perform set_config('request.jwt.claim.sub',admin_user::text,true);
 perform private.add_tracking_floors(p);
 end if;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(previous_user,''),true);
end $$;
create or replace function public.create_mixed_use_project() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_floor uuid; v_block uuid; item jsonb;
begin
  v_project := public.create_project('Mixed Use', 'Suivi des chambres du R+2');
  insert into public.floors(project_id,code,label) values(v_project,'r2','R+2') returning id into v_floor;
  insert into public.blocks(project_id,floor_id,code,label) select v_project,v_floor,code,code from unnest(array['A','B','C']) as code;
  for item in select * from jsonb_array_elements($rooms$[{"id":"r2-201","floorId":"r2","number":201,"blockId":"A","roomType":"standard"},{"id":"r2-202","floorId":"r2","number":202,"blockId":"A","roomType":"standard"},{"id":"r2-203","floorId":"r2","number":203,"blockId":"A","roomType":"junior"},{"id":"r2-204","floorId":"r2","number":204,"blockId":"A","roomType":"standard"},{"id":"r2-205","floorId":"r2","number":205,"blockId":"A","roomType":"standard"},{"id":"r2-206","floorId":"r2","number":206,"blockId":"A","roomType":"junior"},{"id":"r2-207","floorId":"r2","number":207,"blockId":"A","roomType":"standard"},{"id":"r2-208","floorId":"r2","number":208,"blockId":"B","roomType":"standard"},{"id":"r2-209","floorId":"r2","number":209,"blockId":"B","roomType":"junior"},{"id":"r2-210","floorId":"r2","number":210,"blockId":"B","roomType":"junior"},{"id":"r2-211","floorId":"r2","number":211,"blockId":"B","roomType":"standard"},{"id":"r2-212","floorId":"r2","number":212,"blockId":"B","roomType":"junior"},{"id":"r2-213","floorId":"r2","number":213,"blockId":"B","roomType":"standard"},{"id":"r2-214","floorId":"r2","number":214,"blockId":"B","roomType":"executive"},{"id":"r2-215","floorId":"r2","number":215,"blockId":"B","roomType":"standard"},{"id":"r2-216","floorId":"r2","number":216,"blockId":"B","roomType":"standard"},{"id":"r2-217","floorId":"r2","number":217,"blockId":"B","roomType":"junior"},{"id":"r2-218","floorId":"r2","number":218,"blockId":"A","roomType":"standard"},{"id":"r2-219","floorId":"r2","number":219,"blockId":"A","roomType":"standard"},{"id":"r2-220","floorId":"r2","number":220,"blockId":"A","roomType":"standard"},{"id":"r2-221","floorId":"r2","number":221,"blockId":"B","roomType":"standard"},{"id":"r2-222","floorId":"r2","number":222,"blockId":"B","roomType":"standard"},{"id":"r2-223","floorId":"r2","number":223,"blockId":"C","roomType":"standard"},{"id":"r2-224","floorId":"r2","number":224,"blockId":"C","roomType":"standard"},{"id":"r2-225","floorId":"r2","number":225,"blockId":"C","roomType":"standard"},{"id":"r2-226","floorId":"r2","number":226,"blockId":"C","roomType":"standard"},{"id":"r2-227","floorId":"r2","number":227,"blockId":"C","roomType":"junior"},{"id":"r2-228","floorId":"r2","number":228,"blockId":"C","roomType":"standard"},{"id":"r2-229","floorId":"r2","number":229,"blockId":"C","roomType":"standard"},{"id":"r2-230","floorId":"r2","number":230,"blockId":"C","roomType":"standard"},{"id":"r2-231","floorId":"r2","number":231,"blockId":"C","roomType":"standard"},{"id":"r2-232","floorId":"r2","number":232,"blockId":"C","roomType":"standard"},{"id":"r2-233","floorId":"r2","number":233,"blockId":"C","roomType":"standard"},{"id":"r2-234","floorId":"r2","number":234,"blockId":"C","roomType":"standard"},{"id":"r2-235","floorId":"r2","number":235,"blockId":"A","roomType":"junior"},{"id":"r2-236","floorId":"r2","number":236,"blockId":"A","roomType":"standard"},{"id":"r2-237","floorId":"r2","number":237,"blockId":"A","roomType":"standard"},{"id":"r2-238","floorId":"r2","number":238,"blockId":"A","roomType":"standard"},{"id":"r2-239","floorId":"r2","number":239,"blockId":"A","roomType":"standard"},{"id":"r2-240","floorId":"r2","number":240,"blockId":"A","roomType":"standard"}]$rooms$::jsonb) loop
    select id into v_block from public.blocks where floor_id=v_floor and code=item->>'blockId';
    insert into public.rooms(project_id,floor_id,block_id,number,room_type) values(v_project,v_floor,v_block,item->>'number',item->>'roomType');
  end loop;
  for item in select * from jsonb_array_elements($tasks$[{"code":"plumbing-supply","label":"Passage EF/EC","zone":"bathroom","group_label":"Plomberie sol","source_column":"E","sort_order":0},{"code":"plumbing-drainage","label":"Passage évacuations","zone":"bathroom","group_label":"Plomberie sol","source_column":"F","sort_order":1},{"code":"plumbing-waterproofing-clearance","label":"Bon à étancher plomberie sol","zone":"bathroom","group_label":"Plomberie sol","source_column":"G","sort_order":2},{"code":"sdb-partitions","label":"Cloisons SDB posées","zone":"bathroom","group_label":"Cloisons","source_column":"H","sort_order":3},{"code":"sdb-electrical-rough-in","label":"Passage électricité cloisons","zone":"bathroom","group_label":"Électricité cloisons","source_column":"I","sort_order":4},{"code":"sdb-electrical-plaster-clearance","label":"Bon à enduire électricité cloisons","zone":"bathroom","group_label":"Électricité cloisons","source_column":"J","sort_order":5},{"code":"sdb-caulking","label":"Calfeutrement","zone":"bathroom","group_label":"Électricité cloisons","source_column":"K","sort_order":6},{"code":"waterproofing","label":"Étanchéité SDB","zone":"bathroom","group_label":"Étanchéité","source_column":"L","sort_order":7},{"code":"water-test","label":"Test mise en eau","zone":"bathroom","group_label":"Étanchéité","source_column":"M","sort_order":8},{"code":"water-test-report","label":"PV test mise en eau","zone":"bathroom","group_label":"Étanchéité","source_column":"N","sort_order":9},{"code":"wall-render","label":"Dressage mur","zone":"bathroom","group_label":"Dressage","source_column":"O","sort_order":10},{"code":"floor-screed","label":"Chape / forme de pente","zone":"bathroom","group_label":"Chape","source_column":"P","sort_order":11},{"code":"false-ceiling","label":"Structure faux plafond","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"Q","sort_order":12},{"code":"ceiling-electrical","label":"Réseaux électricité plafond","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"R","sort_order":13},{"code":"ceiling-hvac","label":"Réseaux clim / ventilation","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"S","sort_order":14},{"code":"access-panel-approved","label":"Trappe de visite validée","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"T","sort_order":15},{"code":"ceiling-close-clearance","label":"Bon à fermer faux plafond","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"U","sort_order":16},{"code":"ceiling-close","label":"Fermeture faux plafond","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"V","sort_order":17},{"code":"ceiling-finish","label":"Finition faux plafond","zone":"bathroom","group_label":"Faux plafond SDB","source_column":"W","sort_order":18},{"code":"ceiling-paint","label":"Peinture faux plafond","zone":"bathroom","group_label":"Peinture faux plafond","source_column":"X","sort_order":19},{"code":"wall-covering","label":"Pose revêtement toilette","zone":"bathroom","group_label":"Revêtement mural","source_column":"Y","sort_order":20},{"code":"shower-wall-covering","label":"Pose revêtement douche","zone":"bathroom","group_label":"Revêtement mural","source_column":"Z","sort_order":21},{"code":"floor-covering","label":"Pose revêtement sol","zone":"bathroom","group_label":"Revêtement de sol","source_column":"AA","sort_order":22},{"code":"aluminium","label":"Faux cadres alu","zone":"bathroom","group_label":"Menuiserie aluminium","source_column":"AB","sort_order":23},{"code":"shower-toilet-frames","label":"Pose châssis / cabine douche / cabine WC","zone":"bathroom","group_label":"Menuiserie aluminium","source_column":"AC","sort_order":24},{"code":"woodwork","label":"Rail porte coulissante","zone":"bathroom","group_label":"Menuiserie bois","source_column":"AD","sort_order":25},{"code":"sliding-door-partition-close","label":"Fermeture cloison porte coulissante","zone":"bathroom","group_label":"Menuiserie bois","source_column":"AE","sort_order":26},{"code":"vanity","label":"Pose vanity","zone":"bathroom","group_label":"Agencement","source_column":"AF","sort_order":27},{"code":"sanitary-fixtures","label":"Pose sanitaires / robinetterie","zone":"bathroom","group_label":"Sanitaires","source_column":"AG","sort_order":28},{"code":"sdb-accessories","label":"Pose accessoires SDB","zone":"bathroom","group_label":"Accessoires","source_column":"AH","sort_order":29},{"code":"plumbing-tests","label":"Essais plomberie","zone":"bathroom","group_label":"Tests","source_column":"AI","sort_order":30},{"code":"electrical-tests","label":"Essais électricité","zone":"bathroom","group_label":"Tests","source_column":"AJ","sort_order":31},{"code":"hvac-tests","label":"Essais CVC","zone":"bathroom","group_label":"Tests","source_column":"AK","sort_order":32},{"code":"sdb-finishes","label":"Finitions SDB","zone":"bathroom","group_label":"Réception","source_column":"AL","sort_order":33},{"code":"sdb-internal-handover","label":"Réception interne SDB","zone":"bathroom","group_label":"Réception","source_column":"AM","sort_order":34},{"code":"partitions","label":"Cloisons chambre","zone":"bedroom","group_label":"Cloisons","source_column":"AN","sort_order":0},{"code":"electrical-rough-in","label":"Passage électricité cloisons","zone":"bedroom","group_label":"Électricité cloisons","source_column":"AO","sort_order":1},{"code":"electrical-plaster-clearance","label":"Bon à enduire électricité cloisons","zone":"bedroom","group_label":"Électricité cloisons","source_column":"AP","sort_order":2},{"code":"caulking","label":"Calfeutrement","zone":"bedroom","group_label":"Électricité cloisons","source_column":"AQ","sort_order":3},{"code":"screed","label":"Chape chambre","zone":"bedroom","group_label":"Chape","source_column":"AR","sort_order":4},{"code":"false-ceiling","label":"Structure faux plafond","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AS","sort_order":5},{"code":"ceiling-electrical","label":"Réseaux électricité plafond","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AT","sort_order":6},{"code":"ceiling-fire","label":"Réseaux sprinklage / détection","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AU","sort_order":7},{"code":"ceiling-hvac","label":"Réseaux clim","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AV","sort_order":8},{"code":"ceiling-close-clearance","label":"Bon à fermer faux plafond","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AW","sort_order":9},{"code":"ceiling-close","label":"Fermeture faux plafond","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AX","sort_order":10},{"code":"ceiling-finish","label":"Finition faux plafond","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AY","sort_order":11},{"code":"ceiling-paint","label":"Peinture faux plafond","zone":"bedroom","group_label":"Faux plafond chambre","source_column":"AZ","sort_order":12},{"code":"entrance-door-frames","label":"Faux cadres porte entrée","zone":"bedroom","group_label":"Menuiserie bois","source_column":"BA","sort_order":13},{"code":"entrance-door","label":"Pose porte entrée","zone":"bedroom","group_label":"Menuiserie bois","source_column":"BB","sort_order":14},{"code":"bathroom-door","label":"Pose porte SDB","zone":"bedroom","group_label":"Menuiserie bois","source_column":"BC","sort_order":15},{"code":"window-frames","label":"Pose cadre fenêtres","zone":"bedroom","group_label":"Menuiserie aluminium","source_column":"BD","sort_order":16},{"code":"skim-coat-1","label":"Enduit 1ère couche","zone":"bedroom","group_label":"Peinture","source_column":"BE","sort_order":17},{"code":"skim-coat-2","label":"Enduit 2ème couche","zone":"bedroom","group_label":"Peinture","source_column":"BF","sort_order":18},{"code":"paint","label":"Peinture 1ère couche","zone":"bedroom","group_label":"Peinture","source_column":"BG","sort_order":19},{"code":"paint-coat-2","label":"Peinture 2ème couche","zone":"bedroom","group_label":"Peinture","source_column":"BH","sort_order":20},{"code":"floor-finish","label":"Pose sol fini","zone":"bedroom","group_label":"Revêtement de sol","source_column":"BI","sort_order":21},{"code":"skirting","label":"Pose plinthes","zone":"bedroom","group_label":"Revêtement de sol","source_column":"BJ","sort_order":22},{"code":"wardrobe-bar","label":"Armoire / bar","zone":"bedroom","group_label":"Agencement fixe","source_column":"BK","sort_order":23},{"code":"headboard","label":"Tête de lit","zone":"bedroom","group_label":"Agencement fixe","source_column":"BL","sort_order":24},{"code":"tv-desk","label":"Meuble TV / bureau","zone":"bedroom","group_label":"Agencement fixe","source_column":"BM","sort_order":25},{"code":"electrical-devices","label":"Appareillage électrique","zone":"bedroom","group_label":"Appareillage","source_column":"BN","sort_order":26},{"code":"lights","label":"Luminaires / liseuses","zone":"bedroom","group_label":"Appareillage","source_column":"BO","sort_order":27},{"code":"electrical-tests","label":"Essais électricité","zone":"bedroom","group_label":"Tests","source_column":"BP","sort_order":28},{"code":"hvac-tests","label":"Essais climatisation","zone":"bedroom","group_label":"Tests","source_column":"BQ","sort_order":29},{"code":"card-lock-tests","label":"Essais serrure carte","zone":"bedroom","group_label":"Tests","source_column":"BR","sort_order":30},{"code":"room-finishes","label":"Finitions chambre","zone":"bedroom","group_label":"Réception","source_column":"BS","sort_order":31},{"code":"room-internal-handover","label":"Réception interne chambre","zone":"bedroom","group_label":"Réception","source_column":"BT","sort_order":32},{"code":"frames","label":"Pose faux cadres","zone":"loggia","group_label":"Menuiserie loggia","source_column":"BU","sort_order":0},{"code":"joinery","label":"Pose menuiserie","zone":"loggia","group_label":"Menuiserie loggia","source_column":"BV","sort_order":1}]$tasks$::jsonb) loop
    insert into public.task_types(project_id,code,label,zone,group_label,source_column,sort_order) values(v_project,item->>'code',item->>'label',item->>'zone',item->>'group_label',item->>'source_column',(item->>'sort_order')::integer);
  end loop;
  perform private.add_tracking_floors(v_project);
  return v_project;
end;
$$;
-- Assign existing active tasks across multiple floor/block pairs atomically.
create function public.assign_floors(p_project_id uuid, p_floor_ids uuid[], p_assignee_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare task record; changed integer := 0;
begin
  perform 1 from public.projects where id=p_project_id for update;
  if not private.can_manage(p_project_id) then raise exception 'project_admin_required' using errcode='42501'; end if;
  if coalesce(cardinality(p_floor_ids),0)=0 then raise exception 'blocks_required'; end if;
  if exists (
    select 1 from unnest(p_floor_ids) selected(id)
    where not exists (select 1 from public.floors f where f.id=selected.id and f.project_id=p_project_id and f.archived_at is null)
  ) then raise exception 'invalid_block'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.project_members where project_id=p_project_id and user_id=p_assignee_id
      and status='active' and role in ('worker','admin')
  ) then raise exception 'active_worker_required'; end if;
  for task in select t.id from public.room_tasks t join public.rooms r on r.id=t.room_id
    where t.project_id=p_project_id and r.floor_id=any(p_floor_ids) and private.task_is_active(t.id)
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
revoke all on function public.assign_floors(uuid,uuid[],uuid) from public, anon;
grant execute on function public.assign_floors(uuid,uuid[],uuid) to authenticated;

$migration$;
 end if;
end $upgrade$;
notify pgrst, 'reload schema';
commit;
