-- Existing approved synthetic identities. No Auth users or Storage uploads.
-- Temporary records and lifecycle operations are rolled back even on success.
begin;
set local statement_timeout = '8s';
select set_config('request.jwt.claim.sub', '76fb3bfb-68e9-47d1-aba2-28bb108be4e3', true);
set local role authenticated;
do $$
declare
  a uuid := '76fb3bfb-68e9-47d1-aba2-28bb108be4e3';
  b uuid := '62e8fee5-d50a-4bc6-beba-c7aeadbf48d3';
  f uuid := '958888d7-31e7-4fc1-94cf-65ec10e5df0c';
  words uuid := gen_random_uuid(); skills uuid := gen_random_uuid(); ordinary uuid := gen_random_uuid();
  bad uuid := gen_random_uuid(); c uuid; rejected boolean; files jsonb; version bigint;
begin
  if current_user <> 'authenticated' then raise exception 'Wrong role'; end if;
  select id into c from public.children where family_id = f limit 1;
  if c is null then raise exception 'Approved fixture child missing'; end if;
  if has_function_privilege('anon', 'public.create_family_memory(uuid,uuid,text,text,date,text,uuid[],jsonb,text)', 'EXECUTE') then
    raise exception 'Anonymous execution granted';
  end if;
  perform public.create_family_memory(words,f,'[DIARY ROLLBACK]','Мама','2024-01-01','note',array[c],'[]','words');
  files := jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'storage_path',f::text||'/'||skills::text||'/test.png','media_type','image','mime_type','image/png','file_size',1),
    jsonb_build_object('id',gen_random_uuid(),'storage_path',f::text||'/'||skills::text||'/test.mp4','media_type','video','mime_type','video/mp4','file_size',1));
  perform public.create_family_memory(skills,f,'[DIARY ROLLBACK]','Первые шаги','2024-01-01','mixed',array[c],files,'skills');
  -- Old clients/journals omit the new parameter and still work.
  perform public.create_family_memory(ordinary,f,'[DIARY ROLLBACK]',null,'2024-01-01','photo',array[c],'[]');
  if (select diary_category from public.memories where id=words) <> 'words'
    or (select diary_category from public.memories where id=skills) <> 'skills'
    or (select diary_category from public.memories where id=ordinary) is not null then raise exception 'Wrong category'; end if;
  if (select count(*) from public.media_files where memory_id=skills)<>2 then raise exception 'Media duplicated or lost'; end if;
  if (select count(*) from public.memories where id in (words,skills,ordinary) and (diary_category is not null or memory_type='note'))<>2 then
    raise exception 'Ordinary media included in diary';
  end if;
  rejected := false;
  begin perform public.create_family_memory(bad,f,'[DIARY ROLLBACK]',null,'2024-01-01','mixed',array[c],files,'quotes');
  exception when sqlstate 'P0001' then rejected := true; end;
  if not rejected or exists(select 1 from public.memories where id=bad) then raise exception 'Text category accepted attachments'; end if;
  perform public.update_family_memory_details(words,f,
    jsonb_build_object('title','[DIARY ROLLBACK]','body','Мама','event_date','2024-01-01','child_ids',array[c]),
    jsonb_build_object('title','[DIARY ROLLBACK] edited','body','Первое мама','event_date','2024-01-01','child_ids',array[c]));
  if (select diary_category from public.memories where id=words)<>'words' then raise exception 'Edit erased category'; end if;
  select state_version into version from public.memories where id=words;
  perform public.set_family_memory_archived(f,words,version,true,gen_random_uuid());
  if exists(select 1 from public.memories where id=words) then raise exception 'Archived diary exposed'; end if;
  perform public.set_family_memory_archived(f,words,version+1,false,gen_random_uuid());
  if (select diary_category from public.memories where id=words)<>'words' then raise exception 'Restore erased category'; end if;
  perform set_config('request.jwt.claim.sub', b::text, true);
  if exists(select 1 from public.memories where id in (words,skills,ordinary)) then raise exception 'Foreign family diary leaked'; end if;
  rejected := false;
  begin perform public.create_family_memory(gen_random_uuid(),f,'[DIARY ROLLBACK]',null,'2024-01-01','note',array[]::uuid[],'[]','words');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Foreign family write allowed'; end if;
end;
$$;
rollback;
select 'PASS: categories, legacy API, attachments, edit/restore and cross-family isolation; rolled back' as result;
