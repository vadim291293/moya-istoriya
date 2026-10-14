-- Existing approved synthetic fixtures only; no Auth/Storage objects are made.
begin;
set local statement_timeout = '8s';
select set_config('request.jwt.claim.sub', '76fb3bfb-68e9-47d1-aba2-28bb108be4e3', true);
set local role authenticated;
do $$
declare
  b uuid := '62e8fee5-d50a-4bc6-beba-c7aeadbf48d3';
  f uuid := '958888d7-31e7-4fc1-94cf-65ec10e5df0c';
  m uuid; bad uuid; file_id uuid; c uuid; category text; payload jsonb; version bigint; rejected boolean;
begin
  if current_user <> 'authenticated' then raise exception 'Wrong role'; end if;
  select id into c from public.children where family_id=f limit 1;
  if c is null then raise exception 'Approved fixture child missing'; end if;
  foreach category in array array['words','skills','quotes','moments'] loop
    m := gen_random_uuid(); file_id := gen_random_uuid();
    payload := jsonb_build_array(jsonb_build_object('id',file_id,'storage_path',f::text||'/'||m::text||'/voice.m4a',
      'media_type','audio','mime_type','audio/mp4','file_size',128));
    perform public.create_family_memory(m,f,'[VOICE ROLLBACK]','Мама','2024-01-01','note',array[c],payload,category);
    if (select diary_category from public.memories where id=m)<>category
      or (select count(*) from public.media_files where memory_id=m and media_type='audio')<>1 then raise exception 'Voice lost'; end if;
    perform public.update_family_memory_details(m,f,
      jsonb_build_object('title','[VOICE ROLLBACK]','body','Мама','event_date','2024-01-01','child_ids',array[c]),
      jsonb_build_object('title','[VOICE ROLLBACK] edited','body','Первое мама','event_date','2024-01-01','child_ids',array[c]));
    if (select memory_type from public.memories where id=m)<>'note'
      or (select count(*) from public.media_files where memory_id=m and id=file_id)<>1 then raise exception 'Editor changed voice/type'; end if;
    select state_version into version from public.memories where id=m;
    perform public.set_family_memory_archived(f,m,version,true,gen_random_uuid());
    if exists(select 1 from public.media_files where id=file_id) then raise exception 'Archived voice metadata exposed'; end if;
    perform public.set_family_memory_archived(f,m,version+1,false,gen_random_uuid());
    if not exists(select 1 from public.media_files where id=file_id) then raise exception 'Restore lost voice'; end if;
    perform set_config('request.jwt.claim.sub',b::text,true);
    if exists(select 1 from public.media_files where id=file_id) or exists(select 1 from public.memories where id=m) then raise exception 'Foreign voice leaked'; end if;
    perform set_config('request.jwt.claim.sub','76fb3bfb-68e9-47d1-aba2-28bb108be4e3',true);
  end loop;
  -- Invalid MIME, oversized audio and duplicate voice are atomic rejections.
  for payload in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('media_type','audio','mime_type','video/mp4','file_size',128)),
    jsonb_build_array(jsonb_build_object('media_type','audio','mime_type','audio/mp4','file_size',5242881)),
    jsonb_build_array(jsonb_build_object('media_type','audio'),jsonb_build_object('media_type','audio'))
  )) loop
    bad := gen_random_uuid(); rejected := false;
    payload := (select jsonb_agg(value || jsonb_build_object('id',gen_random_uuid(),
      'storage_path',f::text||'/'||bad::text||'/'||gen_random_uuid()::text||'.m4a')) from jsonb_array_elements(payload));
    begin perform public.create_family_memory(bad,f,'[VOICE ROLLBACK]',null,'2024-01-01','note',array[c],payload,'words');
    exception when check_violation or sqlstate 'P0001' then rejected:=true; end;
    if not rejected or exists(select 1 from public.memories where id=bad) then raise exception 'Invalid audio committed'; end if;
  end loop;
  rejected:=false;
  begin perform public.create_family_memory(gen_random_uuid(),f,'[VOICE ROLLBACK]',null,'2024-01-01','note',array[c],payload);
  exception when sqlstate 'P0001' then rejected:=true; end;
  if not rejected then raise exception 'Ordinary media accepted voice'; end if;
end;
$$;
rollback;
select 'PASS: voice categories, editing, archive/restore, cross-family isolation, validation; rolled back' as result;
