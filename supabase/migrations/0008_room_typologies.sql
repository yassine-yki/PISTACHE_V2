-- Match room typologies to the R+4/R+5 DXF labels. SUITE maps to junior.
begin;
create or replace function private.add_tracking_floors(p uuid) returns void language plpgsql security definer set search_path='' as $$
declare f uuid; n integer; v_code text;
begin
 foreach v_code in array array['r3','r4','r5'] loop
  insert into public.floors(project_id,code,label) values(p,v_code,'R+'||right(v_code,1)) on conflict(project_id,code) do nothing;
  select id into f from public.floors where project_id=p and floors.code=v_code;
  if v_code='r3' then
   insert into public.blocks(project_id,floor_id,code,label) select p,f,b.code,b.label from public.blocks b join public.floors x on x.id=b.floor_id where x.project_id=p and x.code='r2' on conflict do nothing;
   insert into public.rooms(project_id,floor_id,block_id,number,room_type)
   select p,f,b3.id,(r.number::int+100)::text,r.room_type from public.rooms r join public.floors x on x.id=r.floor_id left join public.blocks b2 on b2.id=r.block_id left join public.blocks b3 on b3.floor_id=f and b3.code=b2.code where x.project_id=p and x.code='r2' and r.number ~ '^2[0-9]{2}$' on conflict(floor_id,number) do nothing;
  else
   for n in 1..(case when v_code='r4' then 24 else 25 end) loop
    insert into public.rooms(project_id,floor_id,number,room_type) values(p,f,(right(v_code,1)::int*100+n)::text,case when n=14 then 'executive' when n in (3,6,9,10,12,17,18,25) then 'junior' else 'standard' end) on conflict(floor_id,number) do nothing;
   end loop;
  end if;
 end loop;
end;
$$;

do $$
declare p uuid; admin_user uuid; previous_user text := current_setting('request.jwt.claim.sub',true);
begin
 for p in select distinct f.project_id from public.floors f join public.rooms r on r.floor_id=f.id where f.code='r2' and r.number='240' loop
  select user_id into admin_user from public.project_members where project_id=p and role='admin' and status='active' limit 1;
  if admin_user is not null then
   perform set_config('request.jwt.claim.sub',admin_user::text,true);
   update public.rooms r set room_type=case
    when r.number in ('414','514') then 'executive'
    when r.number in ('403','406','409','410','412','417','418','503','506','509','510','512','517','518','525') then 'junior'
    else 'standard' end
   from public.floors f where r.floor_id=f.id and f.project_id=p
    and ((f.code='r4' and r.number ~ '^4(0[1-9]|1[0-9]|2[0-4])$') or (f.code='r5' and r.number ~ '^5(0[1-9]|1[0-9]|2[0-5])$'));
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(previous_user,''),true);
end $$;
commit;
