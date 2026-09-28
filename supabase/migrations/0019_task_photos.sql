-- Run once in the Supabase SQL editor. Photos do not change progress.
begin;
create table public.task_photos (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null,
 room_task_id uuid not null,
 uploaded_by uuid not null references public.profiles(id),
 storage_path text not null unique,
 needs_review boolean not null default false,
 caption text not null default '' check (length(caption)<=1000),
 created_at timestamptz not null default now(),
 foreign key(project_id,room_task_id) references public.room_tasks(project_id,id),
 check(storage_path=room_task_id::text || '/' || uploaded_by::text || '/' || id::text || '.jpg')
);
create index task_photos_task_date on public.task_photos(room_task_id,created_at desc);
create function private.can_add_task_photo(p_task uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.task_is_active(p_task) and private.task_visible(p_task) and exists(
 select 1 from public.room_tasks t where t.id=p_task and (
 private.project_role(t.project_id)='admin' or
 (private.project_role(t.project_id)='worker' and exists(select 1 from public.task_assignments a
 where a.room_task_id=t.id and a.assignee_id=auth.uid() and a.ended_at is null)))),false)
$$;
grant execute on function private.can_add_task_photo(uuid) to authenticated;
alter table public.task_photos enable row level security;
grant select,insert on public.task_photos to authenticated;
create policy task_photos_read on public.task_photos for select to authenticated
 using(private.project_role(project_id) is not null and private.task_visible(room_task_id));
create policy task_photos_add on public.task_photos for insert to authenticated
 with check(uploaded_by=auth.uid() and private.can_add_task_photo(room_task_id)
 and exists(select 1 from storage.objects o where o.bucket_id='task-photos' and o.name=storage_path));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('task-photos','task-photos',false,5242880,array['image/jpeg']);
create policy task_photo_upload on storage.objects for insert to authenticated
 with check(bucket_id='task-photos' and (storage.foldername(name))[2]=auth.uid()::text
 and private.can_add_task_photo(((storage.foldername(name))[1])::uuid));
create policy task_photo_read on storage.objects for select to authenticated
 using(bucket_id='task-photos' and private.task_visible(((storage.foldername(name))[1])::uuid));
create function private.task_photo_published(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.task_photos where storage_path = p_path)
$$;
grant execute on function private.task_photo_published(text) to authenticated;
-- Only allow cleanup of an upload which has no published metadata yet.
create policy task_photo_cleanup on storage.objects for delete to authenticated
 using(bucket_id='task-photos' and (storage.foldername(name))[2]=auth.uid()::text
 and not private.task_photo_published(name));
commit;

