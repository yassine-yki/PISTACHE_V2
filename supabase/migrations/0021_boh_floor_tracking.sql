-- Suivi indépendant des revêtements de sol BOH, par étage et finition.
begin;

create table public.boh_progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  floor_code text not null check (floor_code in ('ss2','ss1','rdc','n02','n03','n04','n05','n06')),
  floor_label text not null,
  finish_code text not null check (finish_code in ('tile-dark-30','tile-beige-60','tile-gray-30x60','epoxy','parquet','stair-ceramic','existing-marble')),
  finish_label text not null,
  color text not null,
  sort_order integer not null,
  progress smallint not null default 0 check (progress between 0 and 100),
  note text not null default '',
  version bigint not null default 1 check (version >= 1),
  confirmed_day date,
  confirmed_progress smallint not null default 0 check (confirmed_progress between 0 and 100),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,floor_code,finish_code),
  unique(project_id,id)
);

create table public.boh_progress_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  boh_progress_id uuid not null,
  changed_by uuid not null references public.profiles(id),
  before_progress smallint not null,
  after_progress smallint not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key(project_id,boh_progress_id) references public.boh_progress(project_id,id)
);

create index boh_progress_project_floor_idx on public.boh_progress(project_id,floor_code,sort_order);
create index boh_updates_project_date_idx on public.boh_progress_updates(project_id,created_at desc);

create function private.seed_boh_progress(p_project uuid) returns void
language sql security definer set search_path='' as $$
  insert into public.boh_progress(project_id,floor_code,floor_label,finish_code,finish_label,color,sort_order)
  select p_project,f.code,f.label,k.code,k.label,k.color,k.ord
  from (values ('ss2','SS-2'),('ss1','SS-1'),('rdc','RDC'),('n02','N02'),('n03','N03'),('n04','N04'),('n05','N05'),('n06','N06')) f(code,label)
  cross join (values
    ('tile-dark-30','Carreaux 30×30 gris foncé','#ef8f9b',1),
    ('tile-beige-60','Carreaux 60×60 beige','#e2df18',2),
    ('tile-gray-30x60','Carreaux 30×60 gris','#22a748',3),
    ('epoxy','Peinture époxy','#b8aa76',4),
    ('parquet','Parquet 120×20','#102f2d',5),
    ('stair-ceramic','Escaliers - grès cérame antidérapant','#fffbd0',6),
    ('existing-marble','Marbre existant - nettoyage et polissage','#d5f7f7',7)
  ) k(code,label,color,ord)
  on conflict(project_id,floor_code,finish_code) do update
    set floor_label=excluded.floor_label,finish_label=excluded.finish_label,color=excluded.color,sort_order=excluded.sort_order;
$$;

select private.seed_boh_progress(id) from public.projects;

create function private.seed_boh_after_project() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform private.seed_boh_progress(new.id); return new; end;
$$;
create trigger seed_boh_after_project after insert on public.projects
for each row execute function private.seed_boh_after_project();

create function public.submit_boh_progress(p_area_id uuid,p_base_version bigint,p_progress smallint,p_note text default '')
returns setof public.boh_progress
language plpgsql security definer set search_path='' as $$
declare v public.boh_progress; v_before smallint; v_role text; v_day date := (now() at time zone 'Africa/Casablanca')::date;
begin
  select * into v from public.boh_progress where id=p_area_id for update;
  if not found then raise exception 'boh_area_not_found' using errcode='P0002'; end if;
  v_before:=v.progress; v_role:=private.project_role(v.project_id);
  if v_role not in ('admin','worker') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_base_version<>v.version then raise exception 'version_conflict' using errcode='40001'; end if;
  if p_progress not between 0 and 100 then raise exception 'invalid_progress' using errcode='22023'; end if;
  if ((v.confirmed_day is not null and v.confirmed_day<v_day and p_progress<v.progress) or (v.progress=100 and p_progress<100))
     and btrim(coalesce(p_note,''))='' then raise exception 'correction_reason_required' using errcode='22023'; end if;
  update public.boh_progress set progress=p_progress,note=coalesce(p_note,''),version=version+1,
    confirmed_day=v_day,confirmed_progress=p_progress,updated_by=auth.uid(),updated_at=now()
    where id=v.id returning * into v;
  insert into public.boh_progress_updates(project_id,boh_progress_id,changed_by,before_progress,after_progress,note)
    values(v.project_id,v.id,auth.uid(),v_before,p_progress,coalesce(p_note,''));
  return next v;
end;
$$;

alter table public.boh_progress enable row level security;
alter table public.boh_progress_updates enable row level security;
create policy boh_progress_read on public.boh_progress for select to authenticated using(private.project_role(project_id) is not null);
create policy boh_updates_read on public.boh_progress_updates for select to authenticated using(private.project_role(project_id) is not null);
grant select on public.boh_progress,public.boh_progress_updates to authenticated;
grant execute on function public.submit_boh_progress(uuid,bigint,smallint,text) to authenticated;
commit;
