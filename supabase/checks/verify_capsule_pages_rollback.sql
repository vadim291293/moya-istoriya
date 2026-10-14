-- Previously approved synthetic users/family only. All 212 synthetic capsules,
-- vault and relative membership roll back. No Auth/Storage object changes.
begin;
set local statement_timeout='15s';
do $$ begin
  if exists(select 1 from moya_private.capsule_vaults where family_id='958888d7-31e7-4fc1-94cf-65ec10e5df0c') then
    raise exception 'Synthetic fixture vault not empty; do not overwrite';
  end if;
end $$;
select set_config('request.jwt.claim.sub','76fb3bfb-68e9-47d1-aba2-28bb108be4e3',true);
select set_config('request.jwt.claims','{}',true);
select public.family_capsule('958888d7-31e7-4fc1-94cf-65ec10e5df0c','setup',null,
  jsonb_build_object('password','synthetic-page-password','key_hex',repeat('a',64)));
select set_config('moya.test.page_token',public.family_capsule('958888d7-31e7-4fc1-94cf-65ec10e5df0c','unlock',null,
  '{"password":"synthetic-page-password"}')->>'token',true);
insert into moya_private.family_capsules(id,family_id,title,content_cipher,last_operation,archived,updated_at)
select gen_random_uuid(),'958888d7-31e7-4fc1-94cf-65ec10e5df0c','[CAPSULE PAGE ROLLBACK]',repeat('c',80),gen_random_uuid(),
  n>207,now()-make_interval(secs=>(n/70)::int) from generate_series(1,212) n;
insert into public.family_members(id,family_id,user_id,role)
values(gen_random_uuid(),'958888d7-31e7-4fc1-94cf-65ec10e5df0c','62e8fee5-d50a-4bc6-beba-c7aeadbf48d3','member');
set local role authenticated;
do $$
declare f uuid:='958888d7-31e7-4fc1-94cf-65ec10e5df0c'; token text:=current_setting('moya.test.page_token');
  seen uuid[]:='{}'; page jsonb; entry jsonb; before_time timestamptz; before_id uuid; pages int:=0; rejected boolean;
begin
  loop
    page:=public.list_family_capsules(f,token,false,before_time,before_id); pages:=pages+1;
    if pages>10 or jsonb_array_length(page)>31 then raise exception 'Unbounded or looping page'; end if;
    for entry in select value from jsonb_array_elements(page) with ordinality x(value,ord) where ord<=30 loop
      if entry ? 'key_hex' or entry ? 'content_cipher' or entry ? 'password_hash' or entry->>'archived'<>'false' then raise exception 'Private content/other section in list'; end if;
      if (entry->>'id')::uuid=any(seen) then raise exception 'Duplicate page row'; end if;
      seen:=array_append(seen,(entry->>'id')::uuid);
    end loop;
    exit when jsonb_array_length(page)<=30;
    before_time:=(page->29->>'updated_at')::timestamptz; before_id:=(page->29->>'id')::uuid;
  end loop;
  if array_length(seen,1)<>207 then raise exception 'Missing older capsules: %',array_length(seen,1); end if;
  page:=public.list_family_capsules(f,token,true);
  if jsonb_array_length(page)<>5 then raise exception 'Trash did not have a separate page'; end if;
  for entry in select value from jsonb_array_elements(page) loop
    if entry->>'archived'<>'true' then raise exception 'Active capsule leaked into trash'; end if;
  end loop;
  if public.list_family_capsules(f,token,false,'2000-01-01',gen_random_uuid())<>'[]'::jsonb then raise exception 'End cursor incorrect'; end if;
  rejected:=false;
  begin perform public.list_family_capsules(f,token,false,now(),null); exception when invalid_parameter_value then rejected:=true; end;
  if not rejected then raise exception 'Partial cursor accepted'; end if;
  rejected:=false;
  begin perform public.list_family_capsules(f,repeat('0',64)); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Wrong password permit accepted'; end if;
  perform set_config('request.jwt.claim.sub','62e8fee5-d50a-4bc6-beba-c7aeadbf48d3',true);
  rejected:=false;
  begin perform public.list_family_capsules(f,token); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Member with valid owner permit read pages'; end if;
  perform set_config('request.jwt.claim.sub','76fb3bfb-68e9-47d1-aba2-28bb108be4e3',true);
  rejected:=false;
  begin perform public.list_family_capsules('b67ff89a-376f-4e09-92b2-73f7cce2f018',token); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Foreign family page permitted'; end if;
  if has_function_privilege('anon','public.list_family_capsules(uuid,text,boolean,timestamptz,uuid)','EXECUTE') then raise exception 'Anon page endpoint exposed'; end if;
end $$;
reset role;
update moya_private.capsule_vaults set token_until=now()-interval '1 second'
where family_id='958888d7-31e7-4fc1-94cf-65ec10e5df0c';
set local role authenticated;
do $$ declare rejected boolean:=false; begin
  begin perform public.list_family_capsules('958888d7-31e7-4fc1-94cf-65ec10e5df0c',current_setting('moya.test.page_token'));
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Expired page permit accepted'; end if;
end $$;
rollback;
select 'PASS: all 207 active capsules across cursor pages, 5 separate archived, tied timestamps/UUIDs, owner/permit/member/foreign/expiry; rolled back' as result;
