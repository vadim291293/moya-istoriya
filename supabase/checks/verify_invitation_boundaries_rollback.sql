-- Only previously approved synthetic identities, no new Auth users/Storage.
-- Expired invitation and all generated rows are temporary: ROLLBACK mandatory.
begin;
set local statement_timeout='8s';
select set_config('moya_test.active_invites', (select count(*)::text from moya_private.family_invitations
  where family_id='958888d7-31e7-4fc1-94cf-65ec10e5df0c' and revoked_at is null and accepted_at is null and expires_at>now()),true);
insert into moya_private.family_invitations(id,family_id,created_by,token_hash,created_at,expires_at)
values(gen_random_uuid(),'958888d7-31e7-4fc1-94cf-65ec10e5df0c','76fb3bfb-68e9-47d1-aba2-28bb108be4e3',
  encode(extensions.digest(repeat('e',64),'sha256'),'hex'),now()-interval '8 days',now()-interval '1 day');
set local role authenticated;
do $$
declare
  a uuid:='76fb3bfb-68e9-47d1-aba2-28bb108be4e3'; b uuid:='62e8fee5-d50a-4bc6-beba-c7aeadbf48d3';
  f uuid:='958888d7-31e7-4fc1-94cf-65ec10e5df0c'; am uuid:=gen_random_uuid(); bm uuid:=gen_random_uuid();
  t text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  rejected boolean; rows jsonb; n integer;
begin
  if current_user<>'authenticated' then raise exception 'Wrong role'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  rejected:=false;
  begin perform public.accept_family_invitation(repeat('e',64)); exception when sqlstate 'P0001' then rejected:=SQLERRM='INVITATION_UNAVAILABLE'; end;
  if not rejected then raise exception 'Expired invitation accepted'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.create_family_invitation(f,gen_random_uuid(),t);
  perform public.create_family_memory(am,f,'[ROLLBACK TRASH OWNER]',null,'2024-01-01','note',array[]::uuid[],'[]');
  perform public.set_family_memory_archived(f,am,0,true,gen_random_uuid());
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.accept_family_invitation(t);
  perform public.create_family_memory(bm,f,'[ROLLBACK TRASH MEMBER]',null,'2024-01-01','note',array[]::uuid[],'[]');
  perform public.set_family_memory_archived(f,bm,0,true,gen_random_uuid());
  rows:=public.list_family_trash(f);
  if exists(select 1 from jsonb_array_elements(rows) v where (v->>'id')::uuid=am) then raise exception 'Member saw another author trash'; end if;
  if not exists(select 1 from jsonb_array_elements(rows) v where (v->>'id')::uuid=bm) then raise exception 'Member own trash missing'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  rejected:=false;
  begin perform public.accept_family_invitation(t); exception when sqlstate 'P0001' then rejected:=SQLERRM='INVITATION_UNAVAILABLE'; end;
  if not rejected then raise exception 'Consumed invitation accepted by different user'; end if;
  rows:=public.list_family_trash(f);
  if not exists(select 1 from jsonb_array_elements(rows) v where (v->>'id')::uuid=am)
    or not exists(select 1 from jsonb_array_elements(rows) v where (v->>'id')::uuid=bm) then raise exception 'Owner trash incomplete'; end if;
  for n in 1..(20-current_setting('moya_test.active_invites')::integer) loop
    perform public.create_family_invitation(f,gen_random_uuid(),replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
  end loop;
  rejected:=false;
  begin perform public.create_family_invitation(f,gen_random_uuid(),replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
  exception when sqlstate 'P0001' then rejected:=SQLERRM='INVITATION_LIMIT'; end;
  if not rejected then raise exception 'Invitation limit not enforced'; end if;
  rejected:=false;
  begin perform public.remove_family_member(f,b); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Superseded user-scoped removal is callable'; end if;
end $$;
reset role;
rollback;
select 'PASS: expiry, single recipient, private member trash, owner trash, 20 active limit, obsolete endpoint denied; all test writes rolled back' as verification;
