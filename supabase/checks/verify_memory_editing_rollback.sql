-- Verification only. Test writes are limited to a fresh memory in the two
-- previously approved test accounts; everything is rolled back. No uploads,
-- passwords, existing memories or lasting users/families are changed.
begin;
set local statement_timeout = '8s';
select set_config('request.jwt.claim.sub', '76fb3bfb-68e9-47d1-aba2-28bb108be4e3', true);
set local role authenticated;
do $$
declare
  m uuid := gen_random_uuid();
  f uuid := '958888d7-31e7-4fc1-94cf-65ec10e5df0c';
  original jsonb := '{"title":"[ROLLBACK TEST]","body":null,"event_date":"2024-01-01","child_ids":[]}';
  desired jsonb := '{"title":"[ROLLBACK TEST] edited","body":"Synthetic text","event_date":"2024-02-01","child_ids":["b9f7d2b6-05e2-4839-9a5b-a8c5f61e64c2"]}';
  rejected boolean;
begin
  if current_user <> 'authenticated' then raise exception 'RLS role not applied'; end if;
  perform public.create_family_memory(m, f, '[ROLLBACK TEST]', null, date '2024-01-01', 'note', array[]::uuid[], '[]');
  if public.update_family_memory_details(m, f, original, desired) <> m then raise exception 'Edit did not return memory'; end if;
  if public.update_family_memory_details(m, f, original, desired) <> m then raise exception 'Repeat failed'; end if;
  if not exists(select 1 from public.memories where id=m and title='[ROLLBACK TEST] edited' and event_date=date '2024-02-01')
    or not exists(select 1 from public.memory_children where memory_id=m and child_id='b9f7d2b6-05e2-4839-9a5b-a8c5f61e64c2') then raise exception 'Atomic result differs'; end if;
  rejected := false;
  begin perform public.update_family_memory_details(m,f,original,original);
  exception when sqlstate 'P0001' then rejected := SQLERRM='MEMORY_EDIT_CONFLICT'; end;
  if not rejected then raise exception 'Stale snapshot allowed'; end if;
  rejected := false;
  begin perform public.update_family_memory_details(m,f,desired,jsonb_set(desired,'{child_ids}','["09206a16-e175-4539-80a3-454825f2d4a5"]'));
  exception when sqlstate '22023' then rejected := true; end;
  if not rejected then raise exception 'Foreign child allowed'; end if;
  perform set_config('request.jwt.claim.sub','62e8fee5-d50a-4bc6-beba-c7aeadbf48d3',true);
  rejected := false;
  begin perform public.update_family_memory_details(m,f,desired,original);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Foreign user allowed'; end if;
  if exists(select 1 from public.memories where id=m) then raise exception 'RLS exposes foreign memory'; end if;
end;
$$;
reset role;
rollback;
select 'PASS: effective authenticated role, edit, replay, conflict, foreign child and foreign user; all test writes rolled back' as verification;
