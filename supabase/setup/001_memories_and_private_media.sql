-- One-time manual setup script; this is not a Supabase migration.
-- Applied to the live project on 2026-10-07 after owner approval.
-- Do not rerun: preflight checks intentionally reject existing memory tables/bucket.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.families') is null
     or to_regclass('public.family_members') is null
     or to_regclass('public.children') is null then
    raise exception 'Expected profiles, families, family_members, and children tables.';
  end if;

  if exists (
    select 1
    from unnest(array['profiles', 'families', 'family_members', 'children']) as t(name)
    join pg_class c on c.oid = to_regclass('public.' || t.name)
    where not c.relrowsecurity
  ) then
    raise exception 'RLS must be enabled on every existing core family table before continuing.';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'families' and cmd = 'SELECT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'family_members' and cmd = 'SELECT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'children' and cmd = 'SELECT') then
    raise exception 'Expected existing SELECT RLS policies on all core family tables; inspect policies before continuing.';
  end if;

  if to_regclass('public.memories') is not null
     or to_regclass('public.memory_children') is not null
     or to_regclass('public.media_files') is not null then
    raise exception 'A memories table already exists. Inspect its schema before applying this setup script.';
  end if;

  if exists (select 1 from storage.buckets where id = 'family-media') then
    raise exception 'The family-media bucket already exists. Inspect its privacy and limits before continuing.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'family members can read linked or own pending media objects',
        'family members can upload to their family paths',
        'uploaders can remove their own family media'
      )
  ) then
    raise exception 'A Storage policy with a setup-script name already exists. Inspect policies before continuing.';
  end if;
end;
$$;

-- The current app already has family-scoped SELECT policies, but the live
-- project did not grant authenticated table SELECT. These grants expose only
-- rows admitted by the existing RLS policies.
grant select on table public.profiles, public.families, public.family_members, public.children to authenticated;

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  title text,
  body text,
  event_date date not null default current_date,
  memory_type text not null check (memory_type in ('note', 'photo', 'video', 'mixed')),
  created_at timestamptz not null default now()
);

create table public.memory_children (
  memory_id uuid not null references public.memories(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  primary key (memory_id, child_id)
);

create table public.media_files (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 52428800),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index memories_family_event_date_idx
  on public.memories (family_id, event_date desc, created_at desc);
create index memory_children_child_id_idx
  on public.memory_children (child_id, memory_id);
create index media_files_memory_id_idx
  on public.media_files (memory_id, created_at);

alter table public.memories enable row level security;
alter table public.memory_children enable row level security;
alter table public.media_files enable row level security;

grant select, insert on table public.memories to authenticated;
grant select, insert on table public.memory_children to authenticated;
grant select, insert on table public.media_files to authenticated;

create policy "family members can read memories"
  on public.memories for select to authenticated
  using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = memories.family_id
        and fm.user_id = (select auth.uid())
    )
  );

create policy "family members can add own memories"
  on public.memories for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = memories.family_id
        and fm.user_id = (select auth.uid())
    )
  );

create policy "family members can read memory child links"
  on public.memory_children for select to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_children.memory_id
    )
  );

create policy "members can link children in the same family"
  on public.memory_children for insert to authenticated
  with check (
    exists (
      select 1
      from public.memories m
      join public.children c on c.family_id = m.family_id
      join public.family_members fm on fm.family_id = m.family_id
      where m.id = memory_children.memory_id
        and c.id = memory_children.child_id
        and fm.user_id = (select auth.uid())
    )
  );

create policy "family members can read media metadata"
  on public.media_files for select to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = media_files.memory_id
    )
  );

create policy "members can add media to family memories"
  on public.media_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1
      from public.memories m
      join public.family_members fm on fm.family_id = m.family_id
      where m.id = media_files.memory_id
        and fm.user_id = (select auth.uid())
        and media_files.storage_path like m.family_id::text || '/' || m.id::text || '/%'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-media',
  'family-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
);

create policy "family members can read linked or own pending media objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'family-media'
    and (
      exists (
        select 1
        from public.media_files mf
        where mf.storage_path = storage.objects.name
      )
      or (
        owner_id = (select auth.uid())::text
        and (storage.foldername(name))[2] is not null
        and exists (
          select 1 from public.family_members fm
          where fm.family_id::text = (storage.foldername(name))[1]
            and fm.user_id = (select auth.uid())
        )
      )
    )
  );

create policy "family members can upload to their family paths"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'family-media'
    and (storage.foldername(name))[2] is not null
    and exists (
      select 1 from public.family_members fm
      where fm.family_id::text = (storage.foldername(name))[1]
        and fm.user_id = (select auth.uid())
    )
  );

create policy "uploaders can remove their own family media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'family-media'
    and owner_id = (select auth.uid())::text
    and exists (
      select 1 from public.family_members fm
      where fm.family_id::text = (storage.foldername(name))[1]
        and fm.user_id = (select auth.uid())
    )
  );

create function public.create_family_memory(
  p_memory_id uuid,
  p_family_id uuid,
  p_title text,
  p_body text,
  p_event_date date,
  p_memory_type text,
  p_child_ids uuid[],
  p_media_files jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_child_id uuid;
  v_media jsonb;
begin
  if v_user_id is null then
    raise exception 'Пользователь не авторизован';
  end if;

  if jsonb_typeof(p_media_files) is distinct from 'array' then
    raise exception 'Список файлов должен быть массивом';
  end if;

  insert into public.memories (
    id, family_id, author_id, title, body, event_date, memory_type
  ) values (
    p_memory_id,
    p_family_id,
    v_user_id,
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_body, '')), ''),
    p_event_date,
    p_memory_type
  );

  foreach v_child_id in array coalesce(p_child_ids, array[]::uuid[]) loop
    insert into public.memory_children (memory_id, child_id)
    values (p_memory_id, v_child_id);
  end loop;

  for v_media in select value from jsonb_array_elements(p_media_files)
  loop
    insert into public.media_files (
      id, memory_id, storage_path, media_type, mime_type, file_size, uploaded_by
    ) values (
      (v_media ->> 'id')::uuid,
      p_memory_id,
      v_media ->> 'storage_path',
      v_media ->> 'media_type',
      v_media ->> 'mime_type',
      (v_media ->> 'file_size')::bigint,
      v_user_id
    );
  end loop;

  return p_memory_id;
end;
$$;

revoke all on function public.create_family_memory(uuid, uuid, text, text, date, text, uuid[], jsonb) from public, anon;
grant execute on function public.create_family_memory(uuid, uuid, text, text, date, text, uuid[], jsonb) to authenticated;

commit;
