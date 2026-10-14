-- Applied to thmzpgugjognrnqtzbqg on 2026-10-07 after explicit owner approval.
-- Do not rerun without comparing this definition with the live function.
-- Replaces only the existing onboarding RPC; does not change existing rows,
-- tables, membership rules, Auth settings or Storage.
begin;

do $$
begin
  if to_regprocedure('public.create_family_with_child(text,text,date)') is null then
    raise exception 'Expected onboarding RPC is missing; stop and inspect the project';
  end if;
end;
$$;

create or replace function public.create_family_with_child(
  p_family_name text,
  p_child_name text,
  p_birth_date date
)
returns public.children
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_family public.families;
  v_child public.children;
begin
  if v_user_id is null then
    raise exception 'Пользователь не авторизован';
  end if;

  -- Serialize repeated/concurrent onboarding requests from the same user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select c.* into v_child
  from public.children c
  join public.family_members fm on fm.family_id = c.family_id
  where fm.user_id = v_user_id
  order by fm.created_at, c.created_at, c.id
  limit 1;

  if found then
    return v_child;
  end if;

  if exists (select 1 from public.family_members fm where fm.user_id = v_user_id) then
    raise exception 'Семья уже существует. Обновите семейную историю';
  end if;

  if p_family_name is null or pg_catalog.btrim(p_family_name) = '' then
    raise exception 'Название семьи не может быть пустым';
  end if;
  if p_child_name is null or pg_catalog.btrim(p_child_name) = '' then
    raise exception 'Имя ребёнка не может быть пустым';
  end if;
  if p_birth_date is null then
    raise exception 'Дата рождения обязательна';
  end if;

  insert into public.families (name)
  values (pg_catalog.btrim(p_family_name))
  returning * into v_family;

  insert into public.family_members (family_id, user_id, role)
  values (v_family.id, v_user_id, 'owner');

  insert into public.children (family_id, name, birth_date)
  values (v_family.id, pg_catalog.btrim(p_child_name), p_birth_date)
  returning * into v_child;

  return v_child;
end;
$$;

revoke all on function public.create_family_with_child(text, text, date) from public, anon;
grant execute on function public.create_family_with_child(text, text, date) to authenticated;
commit;
