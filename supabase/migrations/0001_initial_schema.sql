create extension if not exists pgcrypto;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  label text not null,
  plan_storage_path text,
  sort_order integer not null default 0,
  unique (project_id, code)
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  unique (floor_id, code)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  block_id uuid references public.blocks(id) on delete set null,
  number text not null,
  room_type text,
  sort_order integer not null default 0,
  unique (floor_id, number)
);

create table public.plan_areas (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  kind text not null check (kind in ('room', 'bathroom', 'loggia')),
  source_layer text,
  geometry jsonb not null,
  unique (room_id, kind)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  scope text not null check (scope in ('room', 'bathroom', 'loggia')),
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.room_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  progress smallint not null default 0 check (progress between 0 and 100),
  blocked boolean not null default false,
  observation text not null default '',
  optional_start_date date,
  optional_end_date date,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (room_id, task_id)
);

create table public.progress_updates (
  id uuid primary key default gen_random_uuid(),
  room_task_id uuid not null references public.room_tasks(id) on delete cascade,
  previous_progress smallint check (previous_progress between 0 and 100),
  new_progress smallint not null check (new_progress between 0 and 100),
  previous_blocked boolean,
  new_blocked boolean not null,
  observation text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  progress_update_id uuid not null references public.progress_updates(id) on delete cascade,
  storage_path text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  created_at timestamptz not null default now()
);

create index floors_project_idx on public.floors(project_id, sort_order);
create index rooms_floor_idx on public.rooms(floor_id, sort_order);
create index rooms_block_idx on public.rooms(block_id);
create index plan_areas_floor_idx on public.plan_areas(floor_id);
create index room_tasks_room_idx on public.room_tasks(room_id);
create index progress_updates_task_idx on public.progress_updates(room_task_id, created_at desc);
create index progress_photos_update_idx on public.progress_photos(progress_update_id);

alter table public.projects enable row level security;
alter table public.floors enable row level security;
alter table public.blocks enable row level security;
alter table public.rooms enable row level security;
alter table public.plan_areas enable row level security;
alter table public.tasks enable row level security;
alter table public.room_tasks enable row level security;
alter table public.progress_updates enable row level security;
alter table public.progress_photos enable row level security;

-- Les politiques RLS seront ajoutées lorsque les rôles et les droits du projet
-- auront été validés. Sans politique, aucune donnée n'est exposée par l'API.
