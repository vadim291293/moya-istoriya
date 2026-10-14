-- ALREADY DEPLOYED in membership_scoped_revocation_endpoint and
-- close_user_scoped_revocation. Do not rerun this source bundle.
-- Reviewed server deployment source: remove_family_membership, not by user ID.
-- No account, memory, file or child rows are deleted by this function.
-- Deployment status is recorded in README.md; do not rerun on an applied project.
begin;
set local lock_timeout='5s';
create function moya_private.remove_family_membership(p_family_id uuid,p_membership_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); target public.family_members%rowtype;
begin
  if u is null or p_family_id is null or p_membership_id is null then
    raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN';
  end if;
  perform id from public.families where id=p_family_id for update;
  perform id from public.family_members where family_id=p_family_id and user_id=u and role='owner' for share;
  if not found then raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN'; end if;
  select * into target from public.family_members where family_id=p_family_id and id=p_membership_id for update;
  if not found then return p_membership_id; end if;
  if target.role='owner' or target.user_id=u then
    raise exception using errcode='42501',message='FAMILY_OWNER_CANNOT_BE_REMOVED';
  end if;
  delete from public.family_members where family_id=p_family_id and id=p_membership_id;
  return p_membership_id;
end $$;
revoke all on function moya_private.remove_family_membership(uuid,uuid) from PUBLIC,anon,authenticated;
grant execute on function moya_private.remove_family_membership(uuid,uuid) to authenticated;
create function public.remove_family_membership(p_family_id uuid,p_membership_id uuid)
returns uuid language sql security invoker set search_path=''
as $$ select moya_private.remove_family_membership(p_family_id,p_membership_id); $$;
revoke all on function public.remove_family_membership(uuid,uuid) from PUBLIC,anon,authenticated;
grant execute on function public.remove_family_membership(uuid,uuid) to authenticated;
revoke all on function public.remove_family_member(uuid,uuid),moya_private.remove_family_member(uuid,uuid)
  from PUBLIC,anon,authenticated;
notify pgrst,'reload schema';
commit;
