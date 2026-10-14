-- Two already approved synthetic accounts, no new Auth users or uploads.
-- All added memberships/invitations/memories/receipts are rolled back.
begin;
set local statement_timeout='8s';
select set_config('request.jwt.claim.sub','76fb3bfb-68e9-47d1-aba2-28bb108be4e3',true);
set local role authenticated;
do $$
declare
  a uuid := '76fb3bfb-68e9-47d1-aba2-28bb108be4e3';
  b uuid := '62e8fee5-d50a-4bc6-beba-c7aeadbf48d3';
  f uuid := '958888d7-31e7-4fc1-94cf-65ec10e5df0c';
  m uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); i uuid := gen_random_uuid(); i2 uuid := gen_random_uuid();
  op uuid := gen_random_uuid(); rop uuid := gen_random_uuid(); t text := repeat('a',64); t2 text := repeat('b',64);
  old jsonb := '{"title":"[ROLLBACK ACCESS TEST]","body":null,"event_date":"2024-01-01","child_ids":[]}';
  changed jsonb := '{"title":"[ROLLBACK ACCESS TEST] edited","body":null,"event_date":"2024-01-01","child_ids":[]}';
  rejected boolean; s jsonb; access jsonb; membership uuid; renewed uuid; owner_membership uuid;
  p text := f::text || '/' || m::text || '/' || gen_random_uuid()::text || '.png';
begin
  if current_user<>'authenticated' then raise exception 'Wrong effective role'; end if;
  perform public.create_family_invitation(f,i,t);
  perform public.create_family_invitation(f,i,t); -- same id/token, not a second invite
  perform public.create_family_invitation(f,i2,t2);
  perform public.revoke_family_invitation(f,i2);
  perform public.create_family_memory(m,f,'[ROLLBACK ACCESS TEST]',null,'2024-01-01','photo',array[]::uuid[],
    jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'storage_path',p,'media_type','image','mime_type','image/png','file_size',1)));
  if moya_private.can_remove_pending_media(p) then raise exception 'Linked file classified as pending'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  if exists(select 1 from public.memories where id=m) then raise exception 'Read before accepting leaked'; end if;
  rejected:=false;
  begin perform public.accept_family_invitation(t2); exception when sqlstate 'P0001' then rejected:=SQLERRM='INVITATION_UNAVAILABLE'; end;
  if not rejected then raise exception 'Revoked invitation allowed'; end if;
  if public.accept_family_invitation(t)<>f or public.accept_family_invitation(t)<>f then raise exception 'Acceptance/replay failed'; end if;
  if not exists(select 1 from public.family_members where family_id=f and user_id=b and role='member') then raise exception 'Joined role wrong'; end if;
  select id into membership from public.family_members where family_id=f and user_id=b;
  if not exists(select 1 from public.memories where id=m) then raise exception 'Joined family unreadable'; end if;
  access:=public.list_family_access(f);
  if jsonb_array_length(access->'members')<2 or jsonb_array_length(access->'invitations')<>0 then raise exception 'Member access listing wrong'; end if;
  rejected:=false;
  begin perform public.create_family_invitation(f,gen_random_uuid(),repeat('c',64)); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Member invited others'; end if;
  rejected:=false;
  begin perform public.update_family_memory_details(m,f,old,changed); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Member edited another author'; end if;
  rejected:=false;
  begin perform public.set_family_memory_archived(f,m,0,true,gen_random_uuid()); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Member archived another author'; end if;
  perform public.create_family_memory(m2,f,'[ROLLBACK ACCESS TEST]',null,'2024-01-01','note',array[]::uuid[],'[]');
  perform public.update_family_memory_details(m2,f,old,changed);
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.update_family_memory_details(m2,f,changed,old); -- owner may edit member
  s:=public.set_family_memory_archived(f,m,0,true,op);
  if not (s->>'archived')::boolean or (s->>'version')::bigint<>1 then raise exception 'Archive result wrong'; end if;
  if exists(select 1 from public.memories where id=m) or exists(select 1 from public.media_files where storage_path=p) then raise exception 'Archived API metadata exposed'; end if;
  if moya_private.can_remove_pending_media(p) then raise exception 'Hidden linked file became removable'; end if;
  if jsonb_array_length(public.list_family_trash(f))<1 then raise exception 'Trash empty'; end if;
  rejected:=false;
  begin perform public.update_family_memory_details(m,f,old,changed); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Archived memory editable'; end if;
  s:=public.set_family_memory_archived(f,m,1,false,rop);
  if (s->>'archived')::boolean or (s->>'version')::bigint<>2 then raise exception 'Restore wrong'; end if;
  s:=public.set_family_memory_archived(f,m,0,true,op); -- old delete replay must not re-delete restored data
  if (s->>'archived')::boolean or not (s->>'replayed')::boolean then raise exception 'Old delete re-applied'; end if;
  if not exists(select 1 from public.media_files where storage_path=p) then raise exception 'Restored media lost'; end if;
  rejected:=false;
  begin perform public.set_family_memory_archived(f,m,0,true,gen_random_uuid()); exception when sqlstate 'P0001' then rejected:=SQLERRM='MEMORY_LIFECYCLE_CONFLICT'; end;
  if not rejected then raise exception 'Stale lifecycle version allowed'; end if;
  rejected:=false;
  select id into owner_membership from public.family_members where family_id=f and user_id=a;
  begin perform public.remove_family_membership(f,owner_membership); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Owner removed'; end if;
  perform public.remove_family_membership(f,membership);
  if not exists(select 1 from public.memories where id=m2) then raise exception 'Removed author data lost'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  if exists(select 1 from public.memories where id in (m,m2)) then raise exception 'Removed member can read'; end if;
  rejected:=false;
  begin perform public.accept_family_invitation(t); exception when sqlstate 'P0001' then rejected:=true; end;
  if not rejected then raise exception 'Removed member rejoined using consumed invitation'; end if;
  -- A deliberate new invitation creates a new membership. An old removal
  -- replay must target only the old membership UUID, never the new membership.
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.create_family_invitation(f,gen_random_uuid(),repeat('d',64));
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.accept_family_invitation(repeat('d',64));
  select id into renewed from public.family_members where family_id=f and user_id=b;
  if renewed=membership then raise exception 'Membership ID reused'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.remove_family_membership(f,membership);
  perform set_config('request.jwt.claim.sub',b::text,true);
  if not exists(select 1 from public.family_members where id=renewed) then raise exception 'Old removal revoked new membership'; end if;
  rejected:=false;
  begin perform public.remove_family_membership(f,owner_membership); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Member revoked owner access'; end if;
end $$;
reset role;
rollback;
select 'PASS: invitations/replay/revocation/member and owner boundaries/archive/restore/stale replay/retained media/removal; all test writes rolled back' as verification;
