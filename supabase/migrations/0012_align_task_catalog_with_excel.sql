-- Align every Mixed Use task catalogue with the latest workbook while retaining
-- room-task identities and assignments. Current progress is intentionally reset.
do $$
declare
  v_now timestamptz := now();
begin
  update public.task_types
  set label = case source_column
      when 'G' then 'Bon à étanché plomberie sol'
      when 'T' then 'Trappe de visite'
      when 'BD' then 'Pose fenêtres'
      when 'BS' then 'Pose faux cadres'
      when 'BT' then 'Pose menuiserie'
      else label
    end,
    code = case source_column
      when 'BS' then 'frames'
      when 'BT' then 'joinery'
      else code
    end,
    group_label = case
      when source_column = 'X' then 'Peinture FP'
      when source_column = 'AA' then 'Revêtement sol'
      when source_column in ('AB','AC','BD') then 'Menuiserie alu'
      when source_column in ('BI','BJ') then 'Revêtement sol'
      when source_column in ('BS','BT') then 'LOGGIA'
      else group_label
    end,
    updated_at = v_now
  where zone in ('bathroom','bedroom')
    and source_column in ('G','T','X','AA','AB','AC','BD','BI','BJ','BS','BT');

  update public.task_assignments a
  set ended_at = v_now,
      ended_by = a.assigned_by,
      reason = 'Anciennes tâches Loggia remplacées par le catalogue Excel'
  from public.room_tasks rt
  join public.task_types tt on tt.id = rt.task_type_id
  where a.room_task_id = rt.id
    and a.ended_at is null
    and tt.zone = 'loggia';

  update public.room_tasks rt
  set archived_at = coalesce(rt.archived_at,v_now),
      updated_at = v_now,
      version = rt.version + 1
  from public.task_types tt
  where tt.id = rt.task_type_id
    and tt.zone = 'loggia';

  update public.task_types
  set archived_at = coalesce(archived_at,v_now), updated_at = v_now
  where zone = 'loggia';

  update public.room_tasks rt
  set progress = 0,
      blocked = false,
      note = '',
      start_date = null,
      end_date = null,
      confirmed_day = null,
      confirmed_progress = 0,
      locked_progress = 0,
      updated_by = null,
      updated_at = v_now,
      version = rt.version + 1
  where exists (
    select 1 from public.task_types tt
    where tt.id = rt.task_type_id
      and tt.zone in ('bathroom','bedroom')
      and tt.source_column is not null
  );
end
$$;
