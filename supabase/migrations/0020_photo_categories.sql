begin;
alter table public.task_photos
  add column if not exists photo_type text not null default 'followup';
alter table public.task_photos drop constraint if exists task_photos_photo_type_check;
alter table public.task_photos add constraint task_photos_photo_type_check
  check (photo_type in ('followup','issue','obstruction'));
create index if not exists task_photos_project_date
  on public.task_photos(project_id,created_at desc);
commit;
