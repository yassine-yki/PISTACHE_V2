-- Existing shared progress is protected; new confirmations use the project calendar day.
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
