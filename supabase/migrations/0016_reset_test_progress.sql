-- One-time cleanup requested before production use.
-- Keeps projects, members, assignments, rooms, plans and task definitions.
begin;

create temporary table reset_progress_projects on commit drop as
select id from public.projects where archived_at is null;

-- Test activity is immutable during normal use. Temporarily suspend only the
-- two history guards while deleting the complete test history.
alter table public.progress_updates disable trigger progress_history_immutable;
alter table public.sync_operations disable trigger sync_history_immutable;

delete from public.progress_photos
where project_id in (select id from reset_progress_projects);

delete from public.progress_updates
where project_id in (select id from reset_progress_projects);

delete from public.sync_operations
where project_id in (select id from reset_progress_projects);

alter table public.progress_updates enable trigger progress_history_immutable;
alter table public.sync_operations enable trigger sync_history_immutable;

update public.room_tasks
set progress = 0,
    blocked = false,
    note = '',
    start_date = null,
    end_date = null,
    confirmed_day = (now() at time zone 'Africa/Casablanca')::date,
    locked_progress = 0,
    updated_by = null,
    updated_at = now(),
    version = version + 1
where project_id in (select id from reset_progress_projects);

commit;
