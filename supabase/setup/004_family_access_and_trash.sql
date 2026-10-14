-- ALREADY DEPLOYED in four feature migrations; names are in README.md.
-- Do not rerun this source bundle. 005 supersedes remove_family_member.
-- Reviewed against live metadata, project thmzpgugjognrnqtzbqg.
-- Additive family invitation/access RPCs and recoverable memory deletion.
-- No existing memberships/records/files are deleted. No Auth settings change.
-- Privileged code/tokens/receipts are not in public API.
begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regprocedure('moya_private.update_family_memory_details(uuid,uuid,jsonb,jsonb)') is null then
    raise exception 'Apply reviewed editing RPC first';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='family_members' and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
    raise exception 'Unexpected membership mutation policies; stop and review';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='memories' and cmd in ('UPDATE','DELETE','ALL')) then
    raise exception 'Unexpected direct memory mutation policies; stop and review';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects') <> 3
    or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='uploaders can remove their own family media' and cmd='DELETE') then
    raise exception 'Unexpected Storage policies; stop and review';
  end if;
end $$;

alter table public.memories add column deleted_at timestamptz;
alter table public.memories add column deleted_by uuid references auth.users(id) on delete restrict;
alter table public.memories add column state_version bigint not null default 0 check (state_version >= 0);
alter table public.memories add constraint memories_deletion_pair check ((deleted_at is null) = (deleted_by is null));
create index memories_trash_family_idx on public.memories(family_id,deleted_at desc,id) where deleted_at is not null;

create table moya_private.family_invitations (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete restrict,
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null))
);
create index family_invitations_family_idx on moya_private.family_invitations(family_id,created_at desc);
create index family_invitations_creator_idx on moya_private.family_invitations(created_by);
create index family_invitations_acceptor_idx on moya_private.family_invitations(accepted_by);
alter table moya_private.family_invitations enable row level security;

create table moya_private.memory_lifecycle_operations (
  user_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  memory_id uuid not null references public.memories(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  expected_version bigint not null,
  archived boolean not null,
  result_version bigint not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
create index memory_lifecycle_memory_idx on moya_private.memory_lifecycle_operations(memory_id);
create index memory_lifecycle_family_idx on moya_private.memory_lifecycle_operations(family_id);
alter table moya_private.memory_lifecycle_operations enable row level security;
revoke all on all tables in schema moya_private from public,anon,authenticated;

-- Archived rows cannot be reached by old clients or direct table queries.
alter policy "family members can read memories" on public.memories using (
  deleted_at is null and exists(select 1 from public.family_members fm
    where fm.family_id=memories.family_id and fm.user_id=(select auth.uid()))
);
alter policy "family members can add own memories" on public.memories with check (
  deleted_at is null and deleted_by is null and state_version=0 and author_id=(select auth.uid())
  and exists(select 1 from public.family_members fm where fm.family_id=memories.family_id and fm.user_id=(select auth.uid()))
);
alter policy "members can add media to family memories" on public.media_files with check (
  uploaded_by=(select auth.uid()) and exists(select 1 from public.memories m
    join public.family_members fm on fm.family_id=m.family_id
    where m.id=media_files.memory_id and fm.user_id=(select auth.uid())
      and (m.author_id=(select auth.uid()) or fm.role='owner')
      and media_files.storage_path like m.family_id::text || '/' || m.id::text || '/%')
);

-- Extend only the exact implementation deployed by 003, never a guessed RPC.
-- The public API signature and four-field CAS contract stay unchanged.
do $$
declare
  d text := pg_get_functiondef('moya_private.update_family_memory_details(uuid,uuid,jsonb,jsonb)'::regprocedure);
  needle text := 'where m.id = p_memory_id and m.family_id = p_family_id for update;';
  update_needle text := 'event_date = v_date, memory_type = v_memory_type';
begin
  if position(needle in d)=0 or position(update_needle in d)=0 then
    raise exception 'Editing implementation differs from reviewed 003';
  end if;
  d := replace(d,needle,'where m.id = p_memory_id and m.family_id = p_family_id and m.deleted_at is null for update;');
  d := replace(d,update_needle,'event_date = v_date, memory_type = v_memory_type, state_version = state_version + 1');
  execute d;
end $$;

create function moya_private.can_remove_pending_media(p_path text)
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.family_members fm where fm.user_id=auth.uid() and fm.family_id::text=split_part(p_path,'/',1))
    and not exists(select 1 from public.media_files mf where mf.storage_path=p_path);
$$;
-- Check all metadata, including hidden archived memories. A hidden linked
-- original must not become an "unlinked upload" merely because of RLS.
alter policy "uploaders can remove their own family media" on storage.objects using (
  bucket_id='family-media' and owner_id=(select auth.uid())::text
  and moya_private.can_remove_pending_media(name)
);
alter policy "family members can read linked or own pending media objects" on storage.objects using (
  bucket_id='family-media' and (
    exists(select 1 from public.media_files mf where mf.storage_path=objects.name)
    or (owner_id=(select auth.uid())::text and moya_private.can_remove_pending_media(name))
  )
);

create function moya_private.create_family_invitation(p_family_id uuid,p_invitation_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); i moya_private.family_invitations%rowtype; h text;
begin
  if u is null then raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN'; end if;
  if p_invitation_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='INVITATION_INVALID';
  end if;
  perform id from public.families where id=p_family_id for update;
  perform id from public.family_members where family_id=p_family_id and user_id=u and role='owner' for share;
  if not found then raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN'; end if;
  h := encode(extensions.digest(p_token,'sha256'),'hex');
  select * into i from moya_private.family_invitations where id=p_invitation_id;
  if found then
    if i.family_id<>p_family_id or i.created_by<>u or i.token_hash<>h then
      raise exception using errcode='22023',message='INVITATION_ID_CONFLICT';
    end if;
  else
    if (select count(*) from moya_private.family_invitations where family_id=p_family_id and revoked_at is null and accepted_at is null and expires_at>now()) >= 20 then
      raise exception using errcode='P0001',message='INVITATION_LIMIT';
    end if;
    insert into moya_private.family_invitations(id,family_id,created_by,token_hash)
    values(p_invitation_id,p_family_id,u,h) returning * into i;
  end if;
  return jsonb_build_object('id',i.id,'expires_at',i.expires_at,'revoked_at',i.revoked_at,'accepted_at',i.accepted_at);
end $$;

create function moya_private.list_family_access(p_family_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); r text;
begin
  select role into r from public.family_members where family_id=p_family_id and user_id=u;
  if u is null or not found then raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN'; end if;
  return jsonb_build_object('members',(
    select coalesce(jsonb_agg(jsonb_build_object('id',fm.id,'user_id',fm.user_id,'role',fm.role,'name',p.name) order by fm.created_at,fm.id),'[]')
    from public.family_members fm join public.profiles p on p.id=fm.user_id where fm.family_id=p_family_id
  ),'invitations',case when r='owner' then (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]') from (
      select id,created_at,expires_at,revoked_at,accepted_at from moya_private.family_invitations
      where family_id=p_family_id order by created_at desc,id limit 100
    )q
  ) else '[]'::jsonb end);
end $$;

create function moya_private.revoke_family_invitation(p_family_id uuid,p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); result uuid;
begin
  perform id from public.families where id=p_family_id for update;
  perform id from public.family_members where family_id=p_family_id and user_id=u and role='owner' for share;
  if u is null or not found then raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN'; end if;
  update moya_private.family_invitations set revoked_at=coalesce(revoked_at,now())
    where id=p_invitation_id and family_id=p_family_id returning id into result;
  if result is null then raise exception using errcode='22023',message='INVITATION_INVALID'; end if;
  return result;
end $$;

create function moya_private.accept_family_invitation(p_token text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); f uuid; i moya_private.family_invitations%rowtype; h text;
begin
  if u is null then raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using errcode='P0001',message='INVITATION_UNAVAILABLE'; end if;
  h := encode(extensions.digest(p_token,'sha256'),'hex');
  select family_id into f from moya_private.family_invitations where token_hash=h;
  if f is null then raise exception using errcode='P0001',message='INVITATION_UNAVAILABLE'; end if;
  -- All invitation mutations lock family before invitation, avoiding deadlocks.
  perform id from public.families where id=f for update;
  select * into i from moya_private.family_invitations where token_hash=h for update;
  if i.accepted_by=u and exists(select 1 from public.family_members where family_id=f and user_id=u) then return f; end if;
  if i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=now()
    or not exists(select 1 from public.family_members where family_id=f and user_id=i.created_by and role='owner') then
    raise exception using errcode='P0001',message='INVITATION_UNAVAILABLE';
  end if;
  insert into public.family_members(family_id,user_id,role) values(f,u,'member')
    on conflict(family_id,user_id) do nothing;
  update moya_private.family_invitations set accepted_by=u,accepted_at=now() where id=i.id;
  return f;
end $$;

create function moya_private.remove_family_member(p_family_id uuid,p_user_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); r text;
begin
  perform id from public.families where id=p_family_id for update;
  perform id from public.family_members where family_id=p_family_id and user_id=u and role='owner' for share;
  if u is null or not found or p_user_id is null or p_user_id=u then
    raise exception using errcode='42501',message='FAMILY_ACCESS_FORBIDDEN';
  end if;
  select role into r from public.family_members where family_id=p_family_id and user_id=p_user_id for update;
  if r='owner' then raise exception using errcode='42501',message='FAMILY_OWNER_CANNOT_BE_REMOVED'; end if;
  delete from public.family_members where family_id=p_family_id and user_id=p_user_id;
  -- Auth account, authored memories, files and children are deliberately kept.
  return p_user_id;
end $$;

create function moya_private.get_memory_lifecycle(p_family_id uuid,p_memory_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); m public.memories%rowtype; r text;
begin
  select role into r from public.family_members where family_id=p_family_id and user_id=u;
  if u is null or not found then raise exception using errcode='42501',message='MEMORY_ACCESS_FORBIDDEN'; end if;
  select * into m from public.memories where id=p_memory_id and family_id=p_family_id;
  if not found or (m.author_id<>u and r<>'owner') then raise exception using errcode='42501',message='MEMORY_ACCESS_FORBIDDEN'; end if;
  return jsonb_build_object('id',m.id,'archived',m.deleted_at is not null,'version',m.state_version);
end $$;

create function moya_private.set_family_memory_archived(
  p_family_id uuid,p_memory_id uuid,p_expected_version bigint,p_archived boolean,p_operation_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); m public.memories%rowtype; r text; o moya_private.memory_lifecycle_operations%rowtype;
begin
  if u is null then raise exception using errcode='42501',message='MEMORY_ACCESS_FORBIDDEN'; end if;
  if p_operation_id is null or p_archived is null or p_expected_version is null or p_expected_version<0 then
    raise exception using errcode='22023',message='MEMORY_LIFECYCLE_INVALID';
  end if;
  select role into r from public.family_members where family_id=p_family_id and user_id=u for share;
  if not found then raise exception using errcode='42501',message='MEMORY_ACCESS_FORBIDDEN'; end if;
  select * into m from public.memories where id=p_memory_id and family_id=p_family_id for update;
  if not found or (m.author_id<>u and r<>'owner') then raise exception using errcode='42501',message='MEMORY_ACCESS_FORBIDDEN'; end if;
  select * into o from moya_private.memory_lifecycle_operations where user_id=u and operation_id=p_operation_id;
  if found then
    if o.memory_id<>p_memory_id or o.family_id<>p_family_id or o.expected_version<>p_expected_version or o.archived<>p_archived then
      raise exception using errcode='22023',message='MEMORY_OPERATION_ID_CONFLICT';
    end if;
    return jsonb_build_object('id',m.id,'archived',m.deleted_at is not null,'version',m.state_version,'replayed',true);
  end if;
  if m.state_version<>p_expected_version then raise exception using errcode='P0001',message='MEMORY_LIFECYCLE_CONFLICT'; end if;
  update public.memories set deleted_at=case when p_archived then coalesce(deleted_at,now()) else null end,
    deleted_by=case when p_archived then coalesce(deleted_by,u) else null end,state_version=state_version+1
    where id=p_memory_id returning * into m;
  insert into moya_private.memory_lifecycle_operations(user_id,operation_id,memory_id,family_id,expected_version,archived,result_version)
    values(u,p_operation_id,p_memory_id,p_family_id,p_expected_version,p_archived,m.state_version);
  return jsonb_build_object('id',m.id,'archived',m.deleted_at is not null,'version',m.state_version,'replayed',false);
end $$;

create function moya_private.list_family_trash(p_family_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid := auth.uid(); r text;
begin
  select role into r from public.family_members where family_id=p_family_id and user_id=u;
  if u is null or not found then raise exception using errcode='42501',message='MEMORY_ACCESS_FORBIDDEN'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception using errcode='22023',message='TRASH_CURSOR_INVALID'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.deleted_at desc,q.id desc),'[]') from (
      select m.id,m.title,m.event_date,m.deleted_at,m.state_version,
        (select count(*) from public.media_files mf where mf.memory_id=m.id) as media_count
      from public.memories m where m.family_id=p_family_id and m.deleted_at is not null
        and (r='owner' or m.author_id=u)
        and (p_before is null or (m.deleted_at,m.id)<(p_before,p_before_id))
      order by m.deleted_at desc,m.id desc limit 31
    )q
  );
end $$;

-- Public wrappers have invoker privileges only, no privileged bodies.
create function public.create_family_invitation(p_family_id uuid,p_invitation_id uuid,p_token text)
returns jsonb language sql security invoker set search_path='' as $$ select moya_private.create_family_invitation(p_family_id,p_invitation_id,p_token); $$;
create function public.list_family_access(p_family_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select moya_private.list_family_access(p_family_id); $$;
create function public.revoke_family_invitation(p_family_id uuid,p_invitation_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select moya_private.revoke_family_invitation(p_family_id,p_invitation_id); $$;
create function public.accept_family_invitation(p_token text)
returns uuid language sql security invoker set search_path='' as $$ select moya_private.accept_family_invitation(p_token); $$;
create function public.remove_family_member(p_family_id uuid,p_user_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select moya_private.remove_family_member(p_family_id,p_user_id); $$;
create function public.get_memory_lifecycle(p_family_id uuid,p_memory_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select moya_private.get_memory_lifecycle(p_family_id,p_memory_id); $$;
create function public.set_family_memory_archived(p_family_id uuid,p_memory_id uuid,p_expected_version bigint,p_archived boolean,p_operation_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select moya_private.set_family_memory_archived(p_family_id,p_memory_id,p_expected_version,p_archived,p_operation_id); $$;
create function public.list_family_trash(p_family_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select moya_private.list_family_trash(p_family_id,p_before,p_before_id); $$;

revoke all on all functions in schema moya_private from public,anon;
grant execute on all functions in schema moya_private to authenticated;
revoke all on function public.create_family_invitation(uuid,uuid,text),public.list_family_access(uuid),
  public.revoke_family_invitation(uuid,uuid),public.accept_family_invitation(text),public.remove_family_member(uuid,uuid),
  public.get_memory_lifecycle(uuid,uuid),public.set_family_memory_archived(uuid,uuid,bigint,boolean,uuid),public.list_family_trash(uuid,timestamptz,uuid)
  from public,anon;
grant execute on function public.create_family_invitation(uuid,uuid,text),public.list_family_access(uuid),
  public.revoke_family_invitation(uuid,uuid),public.accept_family_invitation(text),public.remove_family_member(uuid,uuid),
  public.get_memory_lifecycle(uuid,uuid),public.set_family_memory_archived(uuid,uuid,bigint,boolean,uuid),public.list_family_trash(uuid,timestamptz,uuid)
  to authenticated;
-- No caller needs the internal signup trigger or unused legacy family RPC.
-- Revoking direct EXECUTE does not disable the existing signup trigger.
revoke execute on function public.handle_new_user() from public,anon,authenticated;
revoke execute on function public.create_family(text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
