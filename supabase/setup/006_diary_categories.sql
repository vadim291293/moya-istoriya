-- Additive diary metadata. Existing records remain NULL and files stay in place.
-- The original 8-argument API remains compatible through the nullable default.
-- One signature only: no ambiguous PostgREST overloads, no SECURITY DEFINER.
begin;
set local lock_timeout = '5s';

alter table public.memories add column diary_category text;
alter table public.memories add constraint memories_diary_category_check
  check (diary_category is null or diary_category in ('words', 'skills', 'quotes', 'moments'));
alter table public.memories add constraint memories_diary_text_only_check
  check (diary_category is null or diary_category = 'skills' or memory_type = 'note');
create index memories_active_diary_idx on public.memories
  (family_id, created_at desc, event_date desc, id desc)
  where deleted_at is null and (diary_category is not null or memory_type = 'note');

-- RESTRICT is intentional: unexpected dependencies must abort the transaction.
drop function public.create_family_memory(uuid, uuid, text, text, date, text, uuid[], jsonb);
create function public.create_family_memory(
  p_memory_id uuid, p_family_id uuid, p_title text, p_body text,
  p_event_date date, p_memory_type text, p_child_ids uuid[], p_media_files jsonb,
  p_diary_category text default null
) returns uuid language plpgsql security invoker set search_path = '' as $function$
declare
  v_user_id uuid := auth.uid();
  v_child_id uuid;
  v_media jsonb;
begin
  if v_user_id is null then raise exception 'Пользователь не авторизован'; end if;
  if jsonb_typeof(p_media_files) is distinct from 'array' then
    raise exception 'Список файлов должен быть массивом';
  end if;
  if p_diary_category is not null then
    if p_diary_category not in ('words', 'skills', 'quotes', 'moments') then
      raise exception 'Неизвестный раздел дневника';
    end if;
    if nullif(btrim(coalesce(p_title, '')), '') is null
      and nullif(btrim(coalesce(p_body, '')), '') is null then
      raise exception 'Добавьте слова о событии';
    end if;
    if p_diary_category <> 'skills' and jsonb_array_length(p_media_files) > 0 then
      raise exception 'Фото и видео можно прикрепить только к новым умениям';
    end if;
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
$function$;
revoke all on function public.create_family_memory(uuid, uuid, text, text, date, text, uuid[], jsonb, text)
  from public, anon;
grant execute on function public.create_family_memory(uuid, uuid, text, text, date, text, uuid[], jsonb, text)
  to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
