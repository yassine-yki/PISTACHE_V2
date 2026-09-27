-- Match Merini Yassine's task visibility with the hidden columns in
-- "Mixed Use Avancement VERSION 3.xlsx" / "Suivi des Chambres".
-- Existing visibility choices for every other member are preserved.
do $$
declare
  v_member record;
  v_match_count integer := 0;
  v_hidden_columns text[] := array[
    'E','F','G','H','I','J','N','R','S','T','U','V','W','X','Y','Z',
    'AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM',
    'AO','AP','AQ','AT','AU','AV','AW','BB','BC','BI','BJ','BK','BL',
    'BM','BN','BO','BP','BQ','BR','BS','BT'
  ];
begin
  for v_member in
    select pm.project_id, pm.user_id
    from public.project_members pm
    join public.profiles p on p.id = pm.user_id
    where pm.role = 'admin'
      and pm.status = 'active'
      and regexp_replace(lower(btrim(p.display_name)), '\s+', ' ', 'g')
        in ('merini yassine', 'menini yassine')
  loop
    v_match_count := v_match_count + 1;

    update public.task_types tt
    set hidden_user_ids = case
      when tt.source_column = any(v_hidden_columns) then
        case when v_member.user_id = any(tt.hidden_user_ids)
          then tt.hidden_user_ids
          else array_append(tt.hidden_user_ids, v_member.user_id)
        end
      else array_remove(tt.hidden_user_ids, v_member.user_id)
    end,
    updated_at = now()
    where tt.project_id = v_member.project_id
      and tt.zone in ('bathroom', 'bedroom')
      and tt.source_column is not null
      and tt.archived_at is null;
  end loop;

  if v_match_count = 0 then
    raise exception 'Merini Yassine: aucun administrateur actif correspondant';
  end if;
end
$$;
