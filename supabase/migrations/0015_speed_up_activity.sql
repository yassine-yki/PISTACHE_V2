-- The activity screen filters by project and displays the newest updates first.
create index if not exists progress_updates_project_created_idx
  on public.progress_updates(project_id,created_at desc);
