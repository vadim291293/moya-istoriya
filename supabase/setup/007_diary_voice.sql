-- Reviewed source for the live-project migration diary_voice.
-- Existing data, membership policies and original files are not rewritten.
begin;
set local lock_timeout = '5s';

alter table public.media_files drop constraint media_files_media_type_check;
alter table public.media_files add constraint media_files_media_type_check
  check (media_type in ('image', 'video', 'audio'));
alter table public.media_files add constraint media_files_voice_format_check
  check ((media_type = 'audio' and mime_type in ('audio/mp4', 'audio/webm') and file_size <= 5242880)
    or (media_type <> 'audio' and mime_type not like 'audio/%'));
create unique index media_files_one_voice_per_memory on public.media_files(memory_id)
  where media_type = 'audio';

-- Append only the two supported voice MIME types; preserve privacy, limit and
-- every existing supported type. Never enable a public bucket for voice.
update storage.buckets
set allowed_mime_types = array(select distinct mime from unnest(allowed_mime_types || array['audio/mp4', 'audio/webm']) as mime)
where id = 'family-media' and allowed_mime_types is not null;

create or replace function public.create_family_memory(
  p_memory_id uuid, p_family_id uuid, p_title text, p_body text,
  p_event_date date, p_memory_type text, p_child_ids uuid[], p_media_files jsonb,
  p_diary_category text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_child_id uuid;
  v_media jsonb;
  v_voice_count integer;
begin
  if v_user_id is null then raise exception 'Пользователь не авторизован'; end if;
  if jsonb_typeof(p_media_files) is distinct from 'array' then
    raise exception 'Список файлов должен быть массивом';
  end if;
  select count(*) into v_voice_count from jsonb_array_elements(p_media_files) as file
    where file ->> 'media_type' = 'audio';
  if v_voice_count > 1 then raise exception 'К заметке можно прикрепить одну голосовую запись'; end if;
  if v_voice_count > 0 and p_diary_category is null then
    raise exception 'Голосовая запись сохраняется только в дневнике';
  end if;
  if p_diary_category is not null then
    if p_diary_category not in ('words', 'skills', 'quotes', 'moments') then
      raise exception 'Неизвестный раздел дневника';
    end if;
    if nullif(btrim(coalesce(p_title, '')), '') is null
      and nullif(btrim(coalesce(p_body, '')), '') is null then
      raise exception 'Добавьте слова о событии';
    end if;
    if p_diary_category <> 'skills' and exists (
      select 1 from jsonb_array_elements(p_media_files) as file
      where file ->> 'media_type' is distinct from 'audio'
    ) then raise exception 'Фото и видео можно прикрепить только к новым умениям'; end if;
  end if;
  insert into public.memories
    (id, family_id, author_id, title, body, event_date, memory_type, diary_category)
  values (p_memory_id, p_family_id, v_user_id,
    nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(coalesce(p_body, '')), ''),
    p_event_date, p_memory_type, p_diary_category);
  foreach v_child_id in array coalesce(p_child_ids, array[]::uuid[]) loop
    insert into public.memory_children (memory_id, child_id) values (p_memory_id, v_child_id);
  end loop;
  for v_media in select value from jsonb_array_elements(p_media_files) loop
    insert into public.media_files
      (id, memory_id, storage_path, media_type, mime_type, file_size, uploaded_by)
    values ((v_media ->> 'id')::uuid, p_memory_id, v_media ->> 'storage_path',
      v_media ->> 'media_type', v_media ->> 'mime_type', (v_media ->> 'file_size')::bigint, v_user_id);
  end loop;
  return p_memory_id;
end;
$$;
revoke execute on function public.create_family_memory(uuid,uuid,text,text,date,text,uuid[],jsonb,text) from public, anon;
grant execute on function public.create_family_memory(uuid,uuid,text,text,date,text,uuid[],jsonb,text) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
