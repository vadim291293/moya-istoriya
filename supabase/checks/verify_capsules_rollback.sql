-- Previously approved synthetic users/family only. No new Auth users, families
-- or Storage objects; all test membership/vault/capsule rows ROLLBACK.
begin;
set local statement_timeout = '15s';
-- Capture the synthetic foreign ID before RLS intentionally hides that row.
select set_config('moya.test.foreign_child',(select id::text from public.children where family_id='b67ff89a-376f-4e09-92b2-73f7cce2f018' limit 1),true);
-- Temporarily model an ordinary relative in the synthetic owner's family.
insert into public.family_members(id,family_id,user_id,role)
values(gen_random_uuid(),'958888d7-31e7-4fc1-94cf-65ec10e5df0c','62e8fee5-d50a-4bc6-beba-c7aeadbf48d3','member');
select set_config('request.jwt.claim.sub','76fb3bfb-68e9-47d1-aba2-28bb108be4e3',true);
set local role authenticated;
do $$
declare
  owner uuid := '76fb3bfb-68e9-47d1-aba2-28bb108be4e3';
  member uuid := '62e8fee5-d50a-4bc6-beba-c7aeadbf48d3';
  f uuid := '958888d7-31e7-4fc1-94cf-65ec10e5df0c';
  other_family uuid := 'b67ff89a-376f-4e09-92b2-73f7cce2f018';
  cap uuid := gen_random_uuid(); op uuid := gen_random_uuid(); nextop uuid; child uuid;
  token text; old_token text; r jsonb; content jsonb; rejected boolean; i integer;
begin
  if current_user<>'authenticated' then raise exception 'Wrong test role'; end if;
  if public.family_capsule(f,'status')->>'configured'<>'false' then raise exception 'Fixture vault already exists'; end if;
  perform public.family_capsule(f,'setup',null,jsonb_build_object('password','synthetic-vault-password','key_hex',repeat('a',64)));
  r:=public.family_capsule(f,'setup',null,jsonb_build_object('password','another-password','key_hex',repeat('b',64)));
  if r->>'error'<>'already_configured' then raise exception 'Setup rewrote vault'; end if;
  for i in 1..5 loop
    r:=public.family_capsule(f,'unlock',null,'{"password":"wrong-password"}');
    if r->>'error'<>'bad_password' or (r->>'remaining')::int<>5-i then raise exception 'Limiter did not persist'; end if;
  end loop;
  r:=public.family_capsule(f,'unlock',null,'{"password":"synthetic-vault-password"}');
  if r->>'error'<>'blocked' then raise exception 'Correct password bypassed 15 minute limiter'; end if;
  rejected:=false;
  begin perform public.family_capsule(f,'reset',null,'{"password":"new-vault-password"}');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Recovery did not require recent account password'; end if;
  -- SQL claim injection is only an authorization-unit test; it does not test
  -- Auth's signature or delivery. Real clients cannot mint these signed claims.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'amr',jsonb_build_array(jsonb_build_object(
    'method','password','timestamp',floor(extract(epoch from now())))))::text,true);
  perform public.family_capsule(f,'reset',null,'{"password":"new-vault-password"}');
  r:=public.family_capsule(f,'unlock',null,'{"password":"new-vault-password"}');token:=r->>'token';
  if length(token)<>64 or (r->>'expires_at')::timestamptz not between now()+interval '9 minutes' and now()+interval '11 minutes' then raise exception 'Invalid permit'; end if;
  if public.family_capsule(f,'key',token)->>'key_hex'<>repeat('a',64) then raise exception 'Recovery lost original encryption key'; end if;
  if public.family_capsule(f,'list',token)<>'[]'::jsonb then raise exception 'Unexpected test list'; end if;
  content:=jsonb_build_object('id',cap,'operation_id',op,'expected_version',-1,'title','[CAPSULE ROLLBACK]',
    'child_id',null,'content_cipher',repeat('c',80),'files','[]'::jsonb);
  r:=public.family_capsule(f,'save',token,content);
  if (r->>'version')::int<>0 then raise exception 'Wrong creation version'; end if;
  if public.family_capsule(f,'save',token,content)<>r or jsonb_array_length(public.family_capsule(f,'list',token))<>1 then raise exception 'Replay created duplicate'; end if;
  r:=public.family_capsule(f,'get',token,jsonb_build_object('id',cap));
  if r->>'content_cipher'<>repeat('c',80) or r->>'key_hex'<>repeat('a',64) then raise exception 'Content missing'; end if;
  nextop:=gen_random_uuid();content:=content||jsonb_build_object('expected_version',0,'operation_id',nextop,'title','[CAPSULE ROLLBACK] edited');
  if (public.family_capsule(f,'save',token,content)->>'version')::int<>1 then raise exception 'Edit not atomic'; end if;
  rejected:=false;
  begin perform public.family_capsule(f,'save',token,content||jsonb_build_object('operation_id',gen_random_uuid()));
  exception when sqlstate 'P0001' then rejected:=true; end;
  if not rejected then raise exception 'Stale edit overwrote content'; end if;
  child:=nullif(current_setting('moya.test.foreign_child',true),'')::uuid;
  if child is null then raise exception 'Foreign fixture child missing'; end if;
  rejected:=false;
  begin perform public.family_capsule(f,'save',token,content||jsonb_build_object('expected_version',1,'operation_id',gen_random_uuid(),'child_id',child));
  exception when invalid_parameter_value then rejected:=true; end;
  if not rejected then raise exception 'Foreign child accepted'; end if;
  rejected:=false;
  begin perform public.family_capsule(f,'save',token,content||jsonb_build_object('expected_version',1,'operation_id',gen_random_uuid(),
    'files',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'storage_path','foreign/file.bin','media_type','video','mime_type','video/mp4','file_size',3))));
  exception when invalid_parameter_value then rejected:=true; end;
  if not rejected then raise exception 'Foreign/missing Storage file accepted'; end if;
  perform public.family_capsule(f,'archive',token,jsonb_build_object('id',cap,'operation_id',gen_random_uuid(),'expected_version',1,'archived',true));
  if public.family_capsule(f,'get',token,jsonb_build_object('id',cap))->>'archived'<>'true' then raise exception 'Soft trash failed'; end if;
  perform public.family_capsule(f,'archive',token,jsonb_build_object('id',cap,'operation_id',gen_random_uuid(),'expected_version',2,'archived',false));
  if public.family_capsule(f,'get',token,jsonb_build_object('id',cap))->>'content_cipher'<>repeat('c',80) then raise exception 'Restore lost content'; end if;
  rejected:=false;
  begin perform count(*) from moya_private.capsule_vaults; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct vault table exposed'; end if;
  rejected:=false;
  begin perform count(*) from moya_private.family_capsules; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct capsule table exposed'; end if;
  if not moya_private.capsule_storage_access(f::text||'/'||cap::text||'/'||gen_random_uuid()::text||'.bin') then raise exception 'Owner ciphertext access denied'; end if;
  if moya_private.capsule_storage_access(other_family::text||'/'||cap::text||'/'||gen_random_uuid()::text||'.bin') then raise exception 'Foreign ciphertext exposed'; end if;
  perform set_config('request.jwt.claim.sub',member::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member)::text,true);
  foreach content in array array[
    jsonb_build_object('action','status','data','{}'::jsonb),
    jsonb_build_object('action','unlock','data','{"password":"new-vault-password"}'::jsonb),
    jsonb_build_object('action','key','data','{}'::jsonb),
    jsonb_build_object('action','list','data','{}'::jsonb),
    jsonb_build_object('action','get','data',jsonb_build_object('id',cap)),
    jsonb_build_object('action','save','data',jsonb_build_object('id',cap)),
    jsonb_build_object('action','archive','data',jsonb_build_object('id',cap))
  ] loop
    rejected:=false;
    begin perform public.family_capsule(f,content->>'action',token,content->'data');
    exception when insufficient_privilege then rejected:=true; end;
    if not rejected then raise exception 'Member accessed capsule: %',content->>'action'; end if;
  end loop;
  if moya_private.capsule_storage_access(f::text||'/'||cap::text||'/'||gen_random_uuid()::text||'.bin') then raise exception 'Member ciphertext access allowed'; end if;
  perform set_config('request.jwt.claim.sub',owner::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'amr',jsonb_build_array(jsonb_build_object(
    'method','password','timestamp',floor(extract(epoch from now())))))::text,true);
  old_token:=token;
  perform public.family_capsule(f,'reset',null,'{"password":"final-vault-password"}');
  rejected:=false;
  begin perform public.family_capsule(f,'key',old_token); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Old permit survived password reset'; end if;
  token:=public.family_capsule(f,'unlock',null,'{"password":"final-vault-password"}')->>'token';
  if public.family_capsule(f,'get',token,jsonb_build_object('id',cap))->>'content_cipher'<>repeat('c',80) then raise exception 'Reset lost saved capsule'; end if;
  old_token:=token;token:=public.family_capsule(f,'unlock',null,'{"password":"final-vault-password"}')->>'token';
  rejected:=false;
  begin perform public.family_capsule(f,'key',old_token); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Prior device permit survived new unlock'; end if;
  perform public.family_capsule(f,'lock',token);
  rejected:=false;
  begin perform public.family_capsule(f,'list',token); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Closed vault still readable'; end if;
  token:=public.family_capsule(f,'unlock',null,'{"password":"final-vault-password"}')->>'token';
  perform set_config('moya.test.capsule_token',token,true);
  if has_function_privilege('anon','public.family_capsule(uuid,text,text,jsonb)','EXECUTE') then raise exception 'Anonymous RPC executable'; end if;
end $$;
-- Explicitly verify server-side expiry, not only the client timer. This scoped
-- change affects the new synthetic rollback vault only, never a user's vault.
reset role;
update moya_private.capsule_vaults set token_until=now()-interval '1 second'
where family_id='958888d7-31e7-4fc1-94cf-65ec10e5df0c';
set local role authenticated;
do $$ declare rejected boolean:=false; begin
  begin perform public.family_capsule('958888d7-31e7-4fc1-94cf-65ec10e5df0c','key',current_setting('moya.test.capsule_token'));
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Expired server permit still readable'; end if;
end $$;
rollback;
select 'PASS: capsule owner/password/limiter/recovery/CAS/trash/member and foreign denial; all test rows rolled back, no Storage upload' as result;
