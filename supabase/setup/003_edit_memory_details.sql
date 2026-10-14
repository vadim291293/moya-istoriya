-- ALREADY DEPLOYED: 20261008203224 edit_memory_details. Do not rerun.
-- Reviewed setup. Intended project: thmzpgugjognrnqtzbqg.
-- Owner authorized necessary backend changes on 2026-10-08.
-- Fresh metadata reviewed on 2026-10-08; deployment recorded separately.
-- Reviewed deployment source; server migration is tracked by Supabase MCP.
-- Adds one authenticated RPC and narrows one existing child-link INSERT policy.
-- Does not rewrite existing records, upload/remove files, or change Auth/Storage.
begin;
set local lock_timeout = '5s';

do $$
declare
  v_required record;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_family_memory_details'
  ) then
    raise exception 'An editing function already exists; stop and compare definitions.';
  end if;

  for v_required in
    select * from (values
      ('memories', 'id', 'uuid'), ('memories', 'family_id', 'uuid'),
      ('memories', 'author_id', 'uuid'), ('memories', 'title', 'text'),
      ('memories', 'body', 'text'), ('memories', 'event_date', 'date'),
      ('memories', 'memory_type', 'text'),
      ('memory_children', 'memory_id', 'uuid'), ('memory_children', 'child_id', 'uuid'),
      ('media_files', 'memory_id', 'uuid'), ('media_files', 'media_type', 'text'),
      ('children', 'id', 'uuid'), ('children', 'family_id', 'uuid'),
      ('family_members', 'family_id', 'uuid'), ('family_members', 'user_id', 'uuid')
    ) required(table_name, column_name, type_name)
  loop
    if not exists (
      select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_required.table_name
        and c.relkind in ('r', 'p') and c.relrowsecurity
        and a.attnum > 0 and a.attname = v_required.column_name and not a.attisdropped
        and a.atttypid = to_regtype(v_required.type_name)
    ) then
      raise exception 'Expected RLS table/column/type missing: %.% (%)',
        v_required.table_name, v_required.column_name, v_required.type_name;
    end if;
  end loop;
  if not exists (
    select 1 from pg_attribute a where a.attrelid = 'public.family_members'::regclass
      and a.attname = 'role' and not a.attisdropped
  ) then
    raise exception 'Expected family_members.role is missing.';
  end if;

  -- Fail closed on schema drift instead of adding missing constraints or
  -- repairing existing rows. These keys are needed for one exact snapshot.
  for v_required in
    select * from (values
      ('memories', 'id'), ('memories', 'family_id'), ('memories', 'author_id'),
      ('memories', 'event_date'), ('memories', 'memory_type'),
      ('memory_children', 'memory_id'), ('memory_children', 'child_id'),
      ('media_files', 'memory_id'), ('media_files', 'media_type'),
      ('children', 'id'), ('children', 'family_id'),
      ('family_members', 'family_id'), ('family_members', 'user_id')
    ) required(table_name, column_name)
  loop
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || v_required.table_name)
        and a.attnum > 0 and a.attname = v_required.column_name
        and not a.attisdropped and a.attnotnull
    ) then
      raise exception 'Expected NOT NULL column missing: %.%',
        v_required.table_name, v_required.column_name;
    end if;
  end loop;

  for v_required in
    select * from (values
      ('memories', array['id']::text[]),
      ('children', array['id']::text[]),
      ('family_members', array['family_id', 'user_id']::text[]),
      ('memory_children', array['memory_id', 'child_id']::text[])
    ) required(table_name, column_names)
  loop
    -- Accept a PK/UNIQUE constraint or a standalone unique index. Reject
    -- partial, expression, invalid or deferred indexes and larger key sets.
    -- INCLUDE columns are not part of the key; key-column order is irrelevant.
    if not exists (
      select 1 from pg_index i
      where i.indrelid = to_regclass('public.' || v_required.table_name)
        and i.indisunique and i.indisvalid and i.indisready and i.indislive
        and i.indimmediate and i.indpred is null and i.indexprs is null
        and i.indnkeyatts = cardinality(v_required.column_names)
        and array(
          select key_column.attnum
          from unnest(i.indkey::smallint[]) with ordinality key_column(attnum, position)
          where key_column.position <= i.indnkeyatts order by key_column.attnum
        ) = array(
          select a.attnum from pg_attribute a
          where a.attrelid = i.indrelid and a.attnum > 0 and not a.attisdropped
            and a.attname::text = any(v_required.column_names) order by a.attnum
        )
    ) then
      raise exception 'Expected immediate unique key missing: % (%)',
        v_required.table_name, array_to_string(v_required.column_names, ', ');
    end if;
  end loop;

  for v_required in
    select * from (values
      ('memories', 'family_id', 'public.families', 'id'),
      ('memories', 'author_id', 'auth.users', 'id'),
      ('memory_children', 'memory_id', 'public.memories', 'id'),
      ('memory_children', 'child_id', 'public.children', 'id'),
      ('media_files', 'memory_id', 'public.memories', 'id'),
      ('children', 'family_id', 'public.families', 'id')
    ) required(table_name, column_name, target_table, target_column)
  loop
    if not exists (
      select 1 from pg_constraint con
      join pg_attribute source_column on source_column.attrelid = con.conrelid
        and source_column.attname = v_required.column_name and not source_column.attisdropped
      join pg_attribute target_column on target_column.attrelid = con.confrelid
        and target_column.attname = v_required.target_column and not target_column.attisdropped
      where con.conrelid = to_regclass('public.' || v_required.table_name)
        and con.confrelid = to_regclass(v_required.target_table)
        and con.contype = 'f' and con.convalidated and not con.condeferrable
        and con.conkey = array[source_column.attnum]
        and con.confkey = array[target_column.attnum]
    ) then
      raise exception 'Expected validated immediate FK missing: %.% -> %.%',
        v_required.table_name, v_required.column_name,
        v_required.target_table, v_required.target_column;
    end if;
  end loop;

  -- Unknown mutation policies could bypass the author/owner RPC boundary.
  -- Do not silently replace or combine them with this proposal.
  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename in ('memories', 'memory_children') and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'Unexpected mutation policies exist; inspect before enabling editing.';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'family_members' and cmd in ('INSERT', 'UPDATE', 'ALL')
  ) then
    raise exception 'Membership mutation policies exist; review possible owner-role escalation first.';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'memory_children'
      and policyname = 'members can link children in the same family'
      and cmd = 'INSERT' and roles = array['authenticated']::name[]
  ) or exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'memory_children'
      and cmd = 'INSERT' and policyname <> 'members can link children in the same family'
  ) then
    raise exception 'Expected single authenticated child-link INSERT policy differs.';
  end if;
  if exists (
    select 1 from pg_trigger t where not t.tgisinternal and t.tgrelid in (
      'public.memories'::regclass, 'public.memory_children'::regclass
    )
  ) then
    raise exception 'Unexpected custom memory triggers exist; inspect their effects first.';
  end if;
end;
$$;

create schema if not exists moya_private;
revoke all on schema moya_private from public, anon;
grant usage on schema moya_private to authenticated;

-- SQL 001 permits any participant to append child tags to any family memory.
-- Narrow that path too; adding a guarded RPC alone would not enforce this rule.
-- Existing tags remain untouched. Normal creation still works for its author.
alter policy "members can link children in the same family"
  on public.memory_children
  with check (
    exists (
      select 1 from public.memories m
      join public.children c on c.family_id = m.family_id
      join public.family_members fm on fm.family_id = m.family_id
      where m.id = memory_children.memory_id and c.id = memory_children.child_id
        and fm.user_id = (select auth.uid())
        and (m.author_id = (select auth.uid()) or fm.role::text = 'owner')
    )
  );

create function moya_private.update_family_memory_details(
  p_memory_id uuid,
  p_family_id uuid,
  p_expected jsonb,
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_memory public.memories%rowtype;
  v_expected_children uuid[];
  v_children uuid[];
  v_current_children uuid[];
  v_current jsonb;
  v_expected jsonb;
  v_desired jsonb;
  v_title text;
  v_body text;
  v_date date;
  v_media_count bigint;
  v_video_count bigint;
  v_memory_type text;
  v_json jsonb;
begin
  if v_user_id is null or p_memory_id is null or p_family_id is null then
    raise exception using errcode = '42501', message = 'MEMORY_EDIT_FORBIDDEN';
  end if;

  -- Membership/role cannot be revoked or changed halfway through this edit.
  select fm.role::text into v_role from public.family_members fm
  where fm.family_id = p_family_id and fm.user_id = v_user_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'MEMORY_EDIT_FORBIDDEN';
  end if;

  -- Serialize edits of the same memory. This also waits for existing FK-linked
  -- writes before taking the child-tag snapshot; no media object is modified.
  select m.* into v_memory from public.memories m
  where m.id = p_memory_id and m.family_id = p_family_id for update;
  if not found or (v_memory.author_id is distinct from v_user_id and v_role is distinct from 'owner') then
    raise exception using errcode = '42501', message = 'MEMORY_EDIT_FORBIDDEN';
  end if;

  foreach v_json in array array[p_expected, p_details] loop
    if jsonb_typeof(v_json) is distinct from 'object'
      or not (v_json ?& array['title', 'body', 'event_date', 'child_ids']) then
      raise exception using errcode = '22023', message = 'MEMORY_EDIT_INVALID_DETAILS';
    end if;
    if (select count(*) from jsonb_object_keys(v_json)) <> 4
      or jsonb_typeof(v_json -> 'title') not in ('string', 'null')
      or jsonb_typeof(v_json -> 'body') not in ('string', 'null')
      or jsonb_typeof(v_json -> 'event_date') is distinct from 'string'
      or (v_json ->> 'event_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(v_json -> 'child_ids') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'MEMORY_EDIT_INVALID_DETAILS';
    end if;
    if jsonb_array_length(v_json -> 'child_ids') > 1000 or exists (
      select 1 from jsonb_array_elements(v_json -> 'child_ids') e(value)
      where jsonb_typeof(e.value) is distinct from 'string'
    ) then
      raise exception using errcode = '22023', message = 'MEMORY_EDIT_INVALID_CHILDREN';
    end if;
  end loop;

  select coalesce(array_agg(distinct (e.value #>> '{}')::uuid order by (e.value #>> '{}')::uuid), array[]::uuid[])
    into v_expected_children from jsonb_array_elements(p_expected -> 'child_ids') e(value);
  select coalesce(array_agg(distinct (e.value #>> '{}')::uuid order by (e.value #>> '{}')::uuid), array[]::uuid[])
    into v_children from jsonb_array_elements(p_details -> 'child_ids') e(value);

  v_title := nullif(pg_catalog.btrim(p_details ->> 'title'), '');
  v_body := nullif(pg_catalog.btrim(p_details ->> 'body'), '');
  v_date := (p_details ->> 'event_date')::date;
  if coalesce(pg_catalog.char_length(v_title), 0) > 120
    or coalesce(pg_catalog.char_length(v_body), 0) > 4000
    or v_date < date '0100-01-01' or v_date > date '9999-12-31'
    -- Calendar dates have no timezone. Accept today's day in the most advanced
    -- civil timezone (UTC+14); the client uses its own local "today".
    or v_date > (pg_catalog.timezone('UTC', pg_catalog.now()) + interval '14 hours')::date then
    raise exception using errcode = '22023', message = 'MEMORY_EDIT_INVALID_DETAILS';
  end if;

  -- Tags must all refer to this same family, not just to readable children.
  perform c.id from public.children c
  where c.family_id = p_family_id and c.id = any(v_children) order by c.id for share;
  if (select count(*) from public.children c where c.family_id = p_family_id and c.id = any(v_children))
    <> pg_catalog.cardinality(v_children) then
    raise exception using errcode = '22023', message = 'MEMORY_EDIT_INVALID_CHILDREN';
  end if;

  select coalesce(array_agg(mc.child_id order by mc.child_id), array[]::uuid[])
    into v_current_children from public.memory_children mc where mc.memory_id = p_memory_id;
  v_current := jsonb_build_object('title', v_memory.title, 'body', v_memory.body,
    'event_date', pg_catalog.to_char(v_memory.event_date, 'YYYY-MM-DD'), 'child_ids', v_current_children);
  v_expected := jsonb_build_object('title', p_expected -> 'title', 'body', p_expected -> 'body',
    'event_date', pg_catalog.to_char((p_expected ->> 'event_date')::date, 'YYYY-MM-DD'), 'child_ids', v_expected_children);
  v_desired := jsonb_build_object('title', v_title, 'body', v_body,
    'event_date', pg_catalog.to_char(v_date, 'YYYY-MM-DD'), 'child_ids', v_children);

  -- Repeating an already achieved replacement is a no-op, not another edit.
  if v_current = v_desired then return p_memory_id; end if;
  if v_current <> v_expected then
    raise exception using errcode = 'P0001', message = 'MEMORY_EDIT_CONFLICT';
  end if;

  select count(*), count(*) filter (where mf.media_type = 'video')
    into v_media_count, v_video_count from public.media_files mf where mf.memory_id = p_memory_id;
  if v_media_count = 0 and v_title is null and v_body is null then
    raise exception using errcode = '22023', message = 'MEMORY_EDIT_EMPTY_NOTE';
  end if;
  v_memory_type := case
    when v_media_count = 0 then 'note'
    when v_title is not null or v_body is not null then 'mixed'
    when v_video_count = 0 then 'photo'
    when v_video_count = v_media_count then 'video'
    else 'mixed' end;

  update public.memories set title = v_title, body = v_body,
    event_date = v_date, memory_type = v_memory_type
  where id = p_memory_id and family_id = p_family_id;
  delete from public.memory_children where memory_id = p_memory_id;
  insert into public.memory_children(memory_id, child_id)
    select p_memory_id, child_id from unnest(v_children) as selected(child_id);
  return p_memory_id;
end;
$$;

revoke all on function moya_private.update_family_memory_details(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function moya_private.update_family_memory_details(uuid, uuid, jsonb, jsonb) to authenticated;

-- Only this invoker wrapper is exposed through the public Data API. The
-- privileged implementation stays outside the exposed schema and checks
-- membership/author/owner itself; no direct table mutation grant is added.
create function public.update_family_memory_details(
  p_memory_id uuid, p_family_id uuid, p_expected jsonb, p_details jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select moya_private.update_family_memory_details(p_memory_id, p_family_id, p_expected, p_details);
$$;
revoke all on function public.update_family_memory_details(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_family_memory_details(uuid, uuid, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
