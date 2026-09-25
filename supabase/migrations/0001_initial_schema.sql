-- Installation neuve Supabase uniquement. Ne pas rejouer une migration déjà appliquée.
begin;
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.project_members (
  project_id uuid not null references public.projects(id),
  user_id uuid not null references public.profiles(id),
  role text not null check (role in ('admin', 'worker', 'viewer')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create table public.floors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  plan_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (project_id, code), unique (project_id, id)
);
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  floor_id uuid not null,
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (project_id, floor_id) references public.floors(project_id, id),
  unique (floor_id, code), unique (project_id, floor_id, id)
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  floor_id uuid not null,
  block_id uuid,
  number text not null,
  room_type text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (project_id, floor_id) references public.floors(project_id, id),
  foreign key (project_id, floor_id, block_id) references public.blocks(project_id, floor_id, id),
  unique (floor_id, number), unique (project_id, id)
);
create table public.task_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  code text not null,
  label text not null,
  zone text not null check (zone in ('bedroom', 'bathroom', 'loggia')),
  group_label text not null default '',
  description text not null default '',
  source_column text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (project_id, zone, code), unique (project_id, id)
);
create table public.room_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  room_id uuid not null,
  task_type_id uuid not null,
  progress smallint not null default 0 check (progress between 0 and 100),
  blocked boolean not null default false,
  note text not null default '',
  start_date date,
  end_date date,
  version bigint not null default 1 check (version >= 1),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (project_id, room_id) references public.rooms(project_id, id),
  foreign key (project_id, task_type_id) references public.task_types(project_id, id),
  unique (room_id, task_type_id), unique (project_id, id)
);
create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  room_task_id uuid not null,
  assignee_id uuid not null,
  assigned_by uuid not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid,
  reason text not null default '',
  foreign key (project_id, room_task_id) references public.room_tasks(project_id, id),
  foreign key (project_id, assignee_id) references public.project_members(project_id, user_id),
  foreign key (project_id, assigned_by) references public.project_members(project_id, user_id),
  foreign key (project_id, ended_by) references public.project_members(project_id, user_id),
  check ((ended_at is null) = (ended_by is null)),
  check (ended_at is null or ended_at >= created_at),
  unique (project_id, room_task_id, id)
);
create unique index task_assignments_one_active_idx on public.task_assignments(room_task_id) where ended_at is null;
create table public.sync_operations (
  id uuid primary key, -- Généré sur l'appareil, conservé à chaque relance.
  project_id uuid not null references public.projects(id),
  room_task_id uuid not null,
  assignment_id uuid,
  submitted_by uuid not null,
  device_id uuid not null,
  base_version bigint not null check (base_version >= 1),
  depends_on_operation_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  client_created_at timestamptz not null,
  status text not null check (status in ('accepted', 'conflict', 'rejected')),
  result_version bigint,
  error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  foreign key (project_id, room_task_id) references public.room_tasks(project_id, id),
  foreign key (project_id, submitted_by) references public.project_members(project_id, user_id),
  foreign key (project_id, room_task_id, assignment_id) references public.task_assignments(project_id, room_task_id, id),
  unique (project_id, room_task_id, id),
  foreign key (project_id, room_task_id, depends_on_operation_id) references public.sync_operations(project_id, room_task_id, id),
  check (depends_on_operation_id is distinct from id),
  check ((status = 'accepted' and result_version is not null and result_version = base_version + 1 and error_code is null)
    or (status in ('conflict', 'rejected') and result_version is null and error_code is not null))
);
create table public.progress_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  room_task_id uuid not null,
  operation_id uuid unique,
  assignment_id uuid,
  changed_by uuid references public.profiles(id),
  source text not null check (source in ('user', 'import')),
  previous_version bigint not null check (previous_version >= 1),
  new_version bigint not null check (new_version = previous_version + 1),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  correction_reason text check (correction_reason in ('input-error', 'scope-change')),
  correction_note text,
  created_at timestamptz not null default now(),
  foreign key (project_id, room_task_id) references public.room_tasks(project_id, id),
  foreign key (project_id, room_task_id, operation_id) references public.sync_operations(project_id, room_task_id, id),
  foreign key (project_id, room_task_id, assignment_id) references public.task_assignments(project_id, room_task_id, id),
  check ((correction_reason is null and correction_note is null) or
    (correction_reason is not null and correction_note is not null and btrim(correction_note) <> '')),
  unique (project_id, id), unique (room_task_id, new_version)
);
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  progress_update_id uuid not null,
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (project_id, progress_update_id) references public.progress_updates(project_id, id)
);
create table public.plan_areas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  room_id uuid not null,
  zone text not null check (zone in ('bedroom', 'bathroom', 'loggia')),
  source_layer text,
  geometry jsonb not null check (jsonb_typeof(geometry) in ('object', 'array')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, room_id) references public.rooms(project_id, id),
  unique (room_id, zone)
);

create index project_members_user_idx on public.project_members(user_id, status);
create index floors_project_idx on public.floors(project_id, sort_order);
create index blocks_floor_idx on public.blocks(floor_id, sort_order);
create index rooms_floor_idx on public.rooms(floor_id, sort_order);
create index rooms_block_idx on public.rooms(block_id);
create index task_types_project_idx on public.task_types(project_id, sort_order);
create index room_tasks_project_idx on public.room_tasks(project_id);
create index room_tasks_type_idx on public.room_tasks(task_type_id);
create index task_assignments_assignee_idx on public.task_assignments(project_id, assignee_id);
create index sync_operations_task_idx on public.sync_operations(room_task_id, processed_at desc);
create index progress_updates_task_idx on public.progress_updates(room_task_id, created_at desc);
create index progress_photos_update_idx on public.progress_photos(progress_update_id);
create index plan_areas_project_idx on public.plan_areas(project_id);

create function private.project_role(p_project uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.project_members
  where project_id = p_project and user_id = auth.uid() and status = 'active';
$$;
create function private.can_manage(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.project_role(p_project) = 'admin', false)
    and exists (select 1 from public.projects where id = p_project and archived_at is null);
$$;
create function private.task_is_active(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_tasks t
    join public.projects p on p.id = t.project_id
    join public.rooms r on r.id = t.room_id
    join public.floors f on f.id = r.floor_id
    join public.task_types k on k.id = t.task_type_id
    left join public.blocks b on b.id = r.block_id
    where t.id = p_task and t.archived_at is null and p.archived_at is null
      and r.archived_at is null and f.archived_at is null and k.archived_at is null
      and (b.id is null or b.archived_at is null)
  );
$$;
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''));
  return new;
end;
$$;
create trigger pistache_auth_profile after insert on auth.users
for each row execute function private.create_profile();
insert into public.profiles(id, display_name)
select id, coalesce(raw_user_meta_data->>'display_name', '') from auth.users;

-- La gestion et les RPC prennent le même verrou de projet avant toute écriture.
create function private.lock_project_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if auth.uid() is not null and not private.can_manage(new.project_id) then
    raise exception 'project_admin_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
create function private.generate_room_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.archived_at is null then
    if tg_table_name = 'rooms' then
      insert into public.room_tasks(project_id, room_id, task_type_id)
      select new.project_id, new.id, id from public.task_types
      where project_id = new.project_id and archived_at is null
      on conflict (room_id, task_type_id) do nothing;
    else
      insert into public.room_tasks(project_id, room_id, task_type_id)
      select new.project_id, id, new.id from public.rooms
      where project_id = new.project_id and archived_at is null
      on conflict (room_id, task_type_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger rooms_generate_tasks after insert or update of archived_at on public.rooms
for each row execute function private.generate_room_tasks();
create trigger types_generate_tasks after insert or update of archived_at on public.task_types
for each row execute function private.generate_room_tasks();
create function private.immutable_history() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'history_is_immutable'; end;
$$;
create trigger progress_history_immutable before update or delete on public.progress_updates
for each row execute function private.immutable_history();
create trigger sync_history_immutable before update or delete on public.sync_operations
for each row execute function private.immutable_history();

create function public.create_project(p_name text, p_description text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  insert into public.projects(name, description, created_by)
  values (p_name, p_description, auth.uid()) returning id into v_id;
  insert into public.project_members(project_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;
create function public.set_project_member(p_project_id uuid, p_user_id uuid, p_role text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = p_project_id for update;
  if not private.can_manage(p_project_id) then raise exception 'project_admin_required' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'worker', 'viewer') or p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'invalid_membership';
  end if;
  if exists (select 1 from public.project_members where project_id = p_project_id and user_id = p_user_id and role = 'admin' and status = 'active')
    and (p_role <> 'admin' or p_status <> 'active')
    and not exists (select 1 from public.project_members where project_id = p_project_id and user_id <> p_user_id and role = 'admin' and status = 'active') then
    raise exception 'last_admin_required';
  end if;
  insert into public.project_members(project_id, user_id, role, status)
  values (p_project_id, p_user_id, p_role, p_status)
  on conflict (project_id, user_id) do update set role = excluded.role, status = excluded.status;
  if p_status = 'inactive' or p_role = 'viewer' then
    with closed as (
      update public.task_assignments set ended_at = now(), ended_by = auth.uid()
      where project_id = p_project_id and assignee_id = p_user_id and ended_at is null
      returning room_task_id
    )
    update public.room_tasks set version = version + 1, updated_by = auth.uid()
    where id in (select room_task_id from closed);
  end if;
end;
$$;
create function public.assign_task(p_task_id uuid, p_assignee_id uuid, p_reason text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_assignment uuid;
begin
  select project_id into v_project from public.room_tasks where id = p_task_id;
  perform 1 from public.projects where id = v_project for update;
  if not private.can_manage(v_project) then raise exception 'project_admin_required' using errcode = '42501'; end if;
  if not private.task_is_active(p_task_id) then raise exception 'task_archived'; end if;
  perform 1 from public.room_tasks where id = p_task_id for update;
  if p_assignee_id is not null and not exists (
    select 1 from public.project_members where project_id = v_project and user_id = p_assignee_id
      and status = 'active' and role in ('admin', 'worker')
  ) then raise exception 'active_worker_required'; end if;
  update public.task_assignments set ended_at = now(), ended_by = auth.uid()
  where room_task_id = p_task_id and ended_at is null;
  if p_assignee_id is not null then
    insert into public.task_assignments(project_id, room_task_id, assignee_id, assigned_by, reason)
    values (v_project, p_task_id, p_assignee_id, auth.uid(), p_reason) returning id into v_assignment;
  end if;
  update public.room_tasks set version = version + 1, updated_by = auth.uid() where id = p_task_id;
  return v_assignment;
end;
$$;

-- Payload complet; correction_reason + correction_note réservés aux administrateurs.
create function public.submit_progress(
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
  if v_error is null and (v_role = 'viewer' or (v_reason is not null and v_role <> 'admin')) then v_error := 'permission_denied'; end if;
  if v_error is null and v_reason is null and not exists (
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
  if v_error is null and (v_progress < v_task.progress or v_task.progress = 100) and v_reason is null then
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
    update public.room_tasks set progress = v_progress, blocked = (p_payload->>'blocked')::boolean,
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

-- Les clients lisent via RLS et écrivent uniquement les colonnes autorisées ou les RPC.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'projects', 'project_members', 'floors', 'blocks', 'rooms',
    'task_types', 'room_tasks', 'task_assignments', 'sync_operations', 'progress_updates', 'progress_photos', 'plan_areas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if t not in ('profiles', 'projects') then
      execute format('create policy member_read on public.%I for select to authenticated using (private.project_role(project_id) is not null)', t);
    end if;
  end loop;
  foreach t in array array['profiles', 'projects', 'project_members', 'floors', 'blocks', 'rooms', 'task_types', 'room_tasks', 'plan_areas'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
  foreach t in array array['floors', 'blocks', 'rooms', 'task_types', 'plan_areas'] loop
    execute format('create trigger lock_project_write before insert or update on public.%I for each row execute function private.lock_project_write()', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check (private.can_manage(project_id))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using (private.can_manage(project_id)) with check (private.can_manage(project_id))', t);
  end loop;
end;
$$;
create policy profile_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (select 1 from public.project_members m where m.user_id = profiles.id and private.project_role(m.project_id) is not null)
);
create policy profile_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy project_read on public.projects for select to authenticated using (private.project_role(id) is not null);
create policy project_update on public.projects for update to authenticated using (private.project_role(id) = 'admin') with check (private.project_role(id) = 'admin');
grant update (display_name) on public.profiles to authenticated;
grant update (name, description, archived_at) on public.projects to authenticated;
grant insert (project_id, code, label, sort_order, plan_storage_path), update (code, label, sort_order, plan_storage_path, archived_at) on public.floors to authenticated;
grant insert (project_id, floor_id, code, label, sort_order), update (code, label, sort_order, archived_at) on public.blocks to authenticated;
grant insert (project_id, floor_id, block_id, number, room_type, sort_order), update (block_id, number, room_type, sort_order, archived_at) on public.rooms to authenticated;
grant insert (project_id, code, label, zone, group_label, description, source_column, sort_order),
  update (label, group_label, description, source_column, sort_order, archived_at) on public.task_types to authenticated;
grant insert (project_id, room_id, zone, source_layer, geometry), update (source_layer, geometry) on public.plan_areas to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.project_role(uuid), private.can_manage(uuid) to authenticated;
revoke all on function public.create_project(text, text), public.set_project_member(uuid, uuid, text, text),
  public.assign_task(uuid, uuid, text), public.submit_progress(uuid, uuid, uuid, uuid, bigint, timestamptz, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_project(text, text), public.set_project_member(uuid, uuid, text, text),
  public.assign_task(uuid, uuid, text), public.submit_progress(uuid, uuid, uuid, uuid, bigint, timestamptz, jsonb, uuid)
  to authenticated;
commit;
