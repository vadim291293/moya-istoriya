-- Read-only catalog inspection. No user rows, schema or permissions are changed.
-- Intended project: thmzpgugjognrnqtzbqg. Review before executing in SQL Editor.
select jsonb_pretty(jsonb_build_object(
  'columns', (select jsonb_agg(jsonb_build_object(
    'name', column_name, 'type', data_type, 'nullable', is_nullable,
    'default', column_default) order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'children'),
  'constraints', (select jsonb_agg(jsonb_build_object(
    'name', conname, 'definition', pg_get_constraintdef(oid)) order by conname)
    from pg_constraint where conrelid = 'public.children'::regclass),
  'authenticated_table_grants', jsonb_build_object(
    'select', has_table_privilege('authenticated', 'public.children', 'SELECT'),
    'insert', has_table_privilege('authenticated', 'public.children', 'INSERT'),
    'update', has_table_privilege('authenticated', 'public.children', 'UPDATE'),
    'delete', has_table_privilege('authenticated', 'public.children', 'DELETE')),
  'authenticated_insert_columns', (select jsonb_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'public'
    and table_name = 'children'
    and has_column_privilege('authenticated', 'public.children', column_name, 'INSERT')),
  'rls', (select jsonb_build_object('enabled', relrowsecurity, 'forced', relforcerowsecurity)
    from pg_class where oid = 'public.children'::regclass),
  'policies', (select jsonb_agg(jsonb_build_object(
    'name', policyname, 'roles', roles, 'command', cmd,
    'using', qual, 'with_check', with_check) order by policyname)
    from pg_policies where schemaname = 'public' and tablename = 'children'),
  'triggers', (select coalesce(jsonb_agg(jsonb_build_object(
    'name', tgname, 'definition', pg_get_triggerdef(oid)) order by tgname), '[]'::jsonb)
    from pg_trigger where tgrelid = 'public.children'::regclass and not tgisinternal)
)) as children_metadata;
