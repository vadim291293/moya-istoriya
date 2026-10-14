-- Bounded keyset reads only; no existing data/credentials/permissions loosened.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
  if to_regprocedure('moya_private.family_capsule_impl(uuid,text,text,jsonb)') is null then
    raise exception 'Owner/password capsule prerequisites missing';
  end if;
  if to_regprocedure('public.list_family_capsules(uuid,text,boolean,timestamptz,uuid)') is not null then
    raise exception 'Capsule pagination already exists; inspect, do not rerun';
  end if;
end $$;
create index family_capsules_scope_page on moya_private.family_capsules(family_id,archived,updated_at desc,id);
create function moya_private.list_family_capsules_impl(p_family_id uuid,p_token text,p_archived boolean,p_before_updated_at timestamptz,p_before_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  -- Reuse the exact frozen/current owner + hashed expiring permit gate. This
  -- checked call locks the owner's membership/vault for the short transaction;
  -- its internal key result is discarded and NEVER included in the list.
  perform moya_private.family_capsule_impl(p_family_id,'key',p_token,'{}'::jsonb);
  if p_archived is null or (p_before_updated_at is null)<>(p_before_id is null)
    or (p_before_updated_at is not null and not isfinite(p_before_updated_at)) then
    raise exception 'CAPSULE_INVALID_CURSOR' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id) from (
    select id,child_id,title,version,archived,updated_at
    from moya_private.family_capsules
    where family_id=p_family_id and archived=p_archived
      and (p_before_updated_at is null or updated_at<p_before_updated_at or (updated_at=p_before_updated_at and id>p_before_id))
    order by updated_at desc,id limit 31
  )x),'[]'::jsonb);
end $$;
revoke all on function moya_private.list_family_capsules_impl(uuid,text,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function moya_private.list_family_capsules_impl(uuid,text,boolean,timestamptz,uuid) to authenticated,service_role;
create function public.list_family_capsules(p_family_id uuid,p_token text,p_archived boolean default false,p_before_updated_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select moya_private.list_family_capsules_impl(p_family_id,p_token,p_archived,p_before_updated_at,p_before_id);
$$;
revoke all on function public.list_family_capsules(uuid,text,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_family_capsules(uuid,text,boolean,timestamptz,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
