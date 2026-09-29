-- Une valeur BOH peut être corrigée librement le jour de sa validation.
-- À partir du lendemain, toute diminution exige une justification.
begin;

create or replace function public.submit_boh_progress(
  p_area_id uuid,
  p_base_version bigint,
  p_progress smallint,
  p_note text default '',
  p_markup jsonb default '[]'::jsonb
)
returns setof public.boh_progress
language plpgsql security definer set search_path='' as $$
declare v public.boh_progress; v_before smallint; v_before_markup jsonb; v_role text;
  v_day date := (now() at time zone 'Africa/Casablanca')::date;
begin
  select * into v from public.boh_progress where id=p_area_id for update;
  if not found then raise exception 'boh_area_not_found' using errcode='P0002'; end if;
  v_before:=v.progress; v_before_markup:=v.markup; v_role:=private.project_role(v.project_id);
  if v_role not in ('admin','worker') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_base_version<>v.version then raise exception 'version_conflict' using errcode='40001'; end if;
  if p_progress not between 0 and 100 then raise exception 'invalid_progress' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_markup,'[]'::jsonb)) <> 'array' then raise exception 'invalid_markup' using errcode='22023'; end if;
  if v.confirmed_day is not null and v.confirmed_day<v_day and p_progress<v.progress
     and btrim(coalesce(p_note,''))='' then raise exception 'correction_reason_required' using errcode='22023'; end if;
  update public.boh_progress set progress=p_progress,note=coalesce(p_note,''),markup=coalesce(p_markup,'[]'::jsonb),
    version=version+1,confirmed_day=v_day,confirmed_progress=p_progress,updated_by=auth.uid(),updated_at=now()
    where id=v.id returning * into v;
  insert into public.boh_progress_updates(project_id,boh_progress_id,changed_by,before_progress,after_progress,note,before_markup,after_markup)
    values(v.project_id,v.id,auth.uid(),v_before,p_progress,coalesce(p_note,''),v_before_markup,v.markup);
  return next v;
end;
$$;

grant execute on function public.submit_boh_progress(uuid,bigint,smallint,text,jsonb) to authenticated;
commit;
