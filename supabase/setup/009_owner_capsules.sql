-- Owner-only password vault. Reviewed deployment source, not a CLI migration.
-- No existing family rows, policies, Auth settings or ordinary media are changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
  if to_regnamespace('moya_private') is null or to_regnamespace('extensions') is null
    or to_regclass('public.family_members') is null or to_regclass('public.children') is null then
    raise exception 'Existing project prerequisites missing';
  end if;
  if to_regclass('moya_private.capsule_vaults') is not null
    or exists(select 1 from storage.buckets where id='family-capsules') then
    raise exception 'Capsule setup already exists; inspect, do not rerun';
  end if;
end $$;

create table moya_private.capsule_vaults (
  family_id uuid primary key references public.families(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  password_hash text not null,
  key_hex text not null check (key_hex ~ '^[0-9a-f]{64}$'),
  token_hash bytea, token_until timestamptz,
  failures integer not null default 0 check(failures between 0 and 5),
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);
create table moya_private.family_capsules (
  id uuid primary key,
  family_id uuid not null references moya_private.capsule_vaults(family_id) on delete restrict,
  child_id uuid references public.children(id) on delete set null,
  title text not null check(length(title) between 1 and 120),
  content_cipher text not null check(length(content_cipher) between 40 and 60000),
  files jsonb not null default '[]' check(jsonb_typeof(files)='array' and jsonb_array_length(files)<=5),
  version bigint not null default 0 check(version>=0),
  last_operation uuid not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index family_capsules_family_updated on moya_private.family_capsules(family_id,updated_at desc,id);
alter table moya_private.capsule_vaults enable row level security;
alter table moya_private.family_capsules enable row level security;
-- RPC-only tables: no direct client grant/policy, including no direct key access.
revoke all on moya_private.capsule_vaults, moya_private.family_capsules from public,anon,authenticated,service_role;
grant all on moya_private.capsule_vaults, moya_private.family_capsules to service_role;

create function moya_private.capsule_storage_access(p_name text, p_remove boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from moya_private.capsule_vaults v
    join public.family_members fm on fm.family_id=v.family_id and fm.user_id=v.owner_id and fm.role='owner'
    where v.owner_id=(select auth.uid()) and v.family_id::text=split_part(p_name,'/',1)
      and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$'
      and (not p_remove or not exists (
        select 1 from moya_private.family_capsules c, jsonb_array_elements(c.files) f
        where c.family_id=v.family_id and f->>'storage_path'=p_name
      ))
  );
$$;
revoke all on function moya_private.capsule_storage_access(text,boolean) from public,anon,authenticated,service_role;
grant execute on function moya_private.capsule_storage_access(text,boolean) to authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('family-capsules','family-capsules',false,52428832,array['application/octet-stream']);
-- Files are AES-GCM ciphertext. Password-gated RPC alone releases the key.
create policy "capsule owner encrypted read" on storage.objects for select to authenticated
using(bucket_id='family-capsules' and moya_private.capsule_storage_access(name,false));
create policy "capsule owner encrypted upload" on storage.objects for insert to authenticated
with check(bucket_id='family-capsules' and moya_private.capsule_storage_access(name,false));
create policy "capsule owner unlinked cleanup" on storage.objects for delete to authenticated
using(bucket_id='family-capsules' and owner_id=(select auth.uid())::text and moya_private.capsule_storage_access(name,true));

create function moya_private.family_capsule_impl(p_family_id uuid,p_action text,p_token text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid(); v moya_private.capsule_vaults; c moya_private.family_capsules;
  password text := p_data->>'password'; issued text; identifier uuid; child uuid;
  operation uuid; expected bigint; entry jsonb; path text; recent boolean;
begin
  if actor is null or p_family_id is null or not exists (
    select 1 from public.family_members where family_id=p_family_id and user_id=actor and role='owner'
  ) then raise exception 'CAPSULE_OWNER_ONLY' using errcode='42501'; end if;
  -- Serialize setup/unlock/password changes and writes in this family only.
  perform pg_advisory_xact_lock(hashtextextended('capsule:'||p_family_id::text,0));
  -- Revocation cannot race the role check and commit.
  perform 1 from public.family_members where family_id=p_family_id and user_id=actor and role='owner' for share;
  if not found then raise exception 'CAPSULE_OWNER_ONLY' using errcode='42501'; end if;
  select * into v from moya_private.capsule_vaults where family_id=p_family_id for update;
  if found and v.owner_id<>actor then raise exception 'CAPSULE_OWNER_ONLY' using errcode='42501'; end if;
  if p_action='status' then return jsonb_build_object('configured',v.family_id is not null); end if;
  if p_action in ('setup','reset') then
    if password is null or length(password)<8 or length(password)>64 or octet_length(password)>72 then
      raise exception 'CAPSULE_PASSWORD_LENGTH' using errcode='22023';
    end if;
    if p_action='setup' then
      if v.family_id is not null then return jsonb_build_object('error','already_configured'); end if;
      if coalesce(p_data->>'key_hex','') !~ '^[0-9a-f]{64}$' then raise exception 'CAPSULE_INVALID_KEY' using errcode='22023'; end if;
      insert into moya_private.capsule_vaults(family_id,owner_id,password_hash,key_hex)
      values(p_family_id,actor,extensions.crypt(password,extensions.gen_salt('bf',10)),p_data->>'key_hex');
      return jsonb_build_object('configured',true);
    end if;
    if v.family_id is null then raise exception 'CAPSULE_NOT_CONFIGURED' using errcode='22023'; end if;
    -- Only a freshly verified Supabase account PASSWORD allows vault recovery.
    -- amr is a signed Auth claim, never user_metadata or a client flag.
    select exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a
      where a->>'method'='password' and (a->>'timestamp') ~ '^[0-9]{1,12}$'
        and to_timestamp((a->>'timestamp')::bigint) between now()-interval '5 minutes' and now()+interval '30 seconds') into recent;
    if not recent then raise exception 'CAPSULE_REAUTH_REQUIRED' using errcode='42501'; end if;
    update moya_private.capsule_vaults set password_hash=extensions.crypt(password,extensions.gen_salt('bf',10)),
      failures=0,blocked_until=null,token_hash=null,token_until=null where family_id=p_family_id;
    return jsonb_build_object('configured',true);
  end if;
  if v.family_id is null then raise exception 'CAPSULE_NOT_CONFIGURED' using errcode='22023'; end if;
  if p_action='unlock' then
    if v.blocked_until>now() then return jsonb_build_object('error','blocked','retry_after',ceil(extract(epoch from v.blocked_until-now()))); end if;
    if v.blocked_until is not null then v.failures:=0; end if;
    if password is null or octet_length(password)>72 or extensions.crypt(password,v.password_hash)<>v.password_hash then
      update moya_private.capsule_vaults set failures=least(v.failures+1,5),
        blocked_until=case when v.failures+1>=5 then now()+interval '15 minutes' else null end where family_id=p_family_id;
      -- Return, do not raise: rollback would undo the server attempt limiter.
      return jsonb_build_object('error','bad_password','remaining',greatest(4-v.failures,0));
    end if;
    issued:=encode(extensions.gen_random_bytes(32),'hex');
    update moya_private.capsule_vaults set token_hash=extensions.digest(issued,'sha256'),token_until=now()+interval '10 minutes',
      failures=0,blocked_until=null where family_id=p_family_id;
    return jsonb_build_object('token',issued,'expires_at',now()+interval '10 minutes');
  end if;
  if p_token is null or length(p_token)<>64 or v.token_until is null or v.token_until<=now()
    or v.token_hash is null or v.token_hash<>extensions.digest(p_token,'sha256') then
    raise exception 'CAPSULE_LOCKED' using errcode='42501';
  end if;
  if p_action='lock' then
    update moya_private.capsule_vaults set token_hash=null,token_until=null where family_id=p_family_id;
    return jsonb_build_object('locked',true);
  end if;
  if p_action='list' then
    return coalesce((select jsonb_agg(x) from (
      select id,child_id,title,version,archived,created_at,updated_at from moya_private.family_capsules
      where family_id=p_family_id order by updated_at desc,id limit 200
    )x),'[]');
  end if;
  if p_action='key' then return jsonb_build_object('key_hex',v.key_hex); end if;
  identifier:=(p_data->>'id')::uuid;
  if identifier is null then raise exception 'CAPSULE_INVALID_ID' using errcode='22023'; end if;
  select * into c from moya_private.family_capsules where id=identifier and family_id=p_family_id for update;
  if p_action='get' then
    if not found then return jsonb_build_object('missing',true); end if;
    return to_jsonb(c)||jsonb_build_object('key_hex',v.key_hex);
  end if;
  operation:=(p_data->>'operation_id')::uuid;
  expected:=(p_data->>'expected_version')::bigint;
  if operation is null or expected is null or expected<(-1) then raise exception 'CAPSULE_INVALID_WRITE' using errcode='22023'; end if;
  if c.id is not null and c.last_operation=operation then return jsonb_build_object('id',c.id,'version',c.version,'operation_id',operation); end if;
  if (c.id is null and expected<>-1) or (c.id is not null and c.version<>expected) then
    raise exception 'CAPSULE_CONFLICT' using errcode='P0001';
  end if;
  if p_action='archive' then
    if c.id is null then raise exception 'CAPSULE_MISSING' using errcode='22023'; end if;
    update moya_private.family_capsules set archived=(p_data->>'archived')::boolean,version=version+1,last_operation=operation,updated_at=now()
      where id=identifier and family_id=p_family_id returning * into c;
  elsif p_action='save' then
    child:=nullif(p_data->>'child_id','')::uuid;
    if child is not null and not exists(select 1 from public.children where id=child and family_id=p_family_id) then
      raise exception 'CAPSULE_CHILD_SCOPE' using errcode='22023';
    end if;
    if coalesce(length(btrim(p_data->>'title')),0) not between 1 and 120
      or coalesce(length(p_data->>'content_cipher'),0) not between 40 and 60000
      or jsonb_typeof(p_data->'files') is distinct from 'array' or jsonb_array_length(p_data->'files')>5 then
      raise exception 'CAPSULE_INVALID_CONTENT' using errcode='22023';
    end if;
    for entry in select value from jsonb_array_elements(p_data->'files') loop
      path:=entry->>'storage_path';
      if coalesce(entry->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or path is distinct from (p_family_id::text||'/'||identifier::text||'/'||(entry->>'id')||'.bin')
        or coalesce(entry->>'media_type','') not in ('image','video','audio')
        or coalesce(entry->>'mime_type','') not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm','audio/mp4','audio/webm')
        or coalesce(entry->>'file_size','') !~ '^[0-9]{1,9}$'
        or (entry->>'file_size')::bigint not between 1 and 52428800 then
        raise exception 'CAPSULE_INVALID_FILE' using errcode='22023';
      end if;
      if (entry->>'media_type'='image' and (entry->>'mime_type') not like 'image/%')
        or (entry->>'media_type'='video' and (entry->>'mime_type') not like 'video/%')
        or (entry->>'media_type'='audio' and (entry->>'mime_type') not in ('audio/mp4','audio/webm')) then
        raise exception 'CAPSULE_FILE_TYPE' using errcode='22023';
      end if;
      if not exists(select 1 from storage.objects o where bucket_id='family-capsules' and name=path
        and (o.metadata->>'size')::bigint=(entry->>'file_size')::bigint+28) then
        raise exception 'CAPSULE_FILE_MISSING' using errcode='22023';
      end if;
    end loop;
    if (select count(distinct value->>'storage_path') from jsonb_array_elements(p_data->'files'))<>jsonb_array_length(p_data->'files') then
      raise exception 'CAPSULE_DUPLICATE_FILE' using errcode='22023';
    end if;
    if c.id is null then
      insert into moya_private.family_capsules(id,family_id,child_id,title,content_cipher,files,last_operation)
      values(identifier,p_family_id,child,btrim(p_data->>'title'),p_data->>'content_cipher',p_data->'files',operation) returning * into c;
    else
      update moya_private.family_capsules set child_id=child,title=btrim(p_data->>'title'),content_cipher=p_data->>'content_cipher',files=p_data->'files',
        version=version+1,last_operation=operation,updated_at=now() where id=identifier and family_id=p_family_id returning * into c;
    end if;
  else raise exception 'CAPSULE_INVALID_ACTION' using errcode='22023'; end if;
  return jsonb_build_object('id',c.id,'version',c.version,'operation_id',operation);
end $$;
revoke all on function moya_private.family_capsule_impl(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function moya_private.family_capsule_impl(uuid,text,text,jsonb) to authenticated,service_role;
create function public.family_capsule(p_family_id uuid,p_action text,p_token text default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
  select moya_private.family_capsule_impl(p_family_id,p_action,p_token,p_data);
$$;
revoke all on function public.family_capsule(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.family_capsule(uuid,text,text,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
