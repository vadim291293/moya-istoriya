-- Read-only metadata inspection before implementing shared-family invitations.
-- Intended project: thmzpgugjognrnqtzbqg. Do not substitute user-row queries.
-- This query does not change rows, functions, grants, policies or schemas.
select jsonb_pretty(jsonb_build_object(
  'core_tables', (
    select jsonb_agg(jsonb_build_object(
      'table', target.table_name,
      'columns', (select jsonb_agg(jsonb_build_object(
        'name', col.column_name, 'type', col.data_type,
        'nullable', col.is_nullable, 'default', col.column_default
      ) order by col.ordinal_position)
        from information_schema.columns col where col.table_schema = 'public'
        and col.table_name = target.table_name),
      'constraints', (select jsonb_agg(jsonb_build_object(
        'name', con.conname, 'definition', pg_get_constraintdef(con.oid)
      ) order by con.conname) from pg_constraint con
        where con.conrelid = relation.oid),
      'rls', jsonb_build_object('enabled', relation.relrowsecurity,
        'forced', relation.relforcerowsecurity),
      'policies', (select jsonb_agg(jsonb_build_object(
        'name', p.policyname, 'roles', p.roles, 'command', p.cmd,
        'using', p.qual, 'with_check', p.with_check
      ) order by p.policyname) from pg_policies p
        where p.schemaname = 'public' and p.tablename = target.table_name),
      'authenticated_grants', jsonb_build_object(
        'select', has_table_privilege('authenticated', relation.oid, 'SELECT'),
        'insert', has_table_privilege('authenticated', relation.oid, 'INSERT'),
        'update', has_table_privilege('authenticated', relation.oid, 'UPDATE'),
        'delete', has_table_privilege('authenticated', relation.oid, 'DELETE')),
      'triggers', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', tr.tgname, 'definition', pg_get_triggerdef(tr.oid)
      ) order by tr.tgname), '[]'::jsonb) from pg_trigger tr
        where tr.tgrelid = relation.oid and not tr.tgisinternal)
    ) order by target.table_name)
    from (values ('families'), ('family_members'), ('profiles'), ('children')) target(table_name)
    join pg_namespace ns on ns.nspname = 'public'
    left join pg_class relation on relation.relnamespace = ns.oid
      and relation.relname = target.table_name and relation.relkind in ('r', 'p')
  ),
  'existing_family_rpc', (
    select jsonb_agg(jsonb_build_object(
      'name', proc.proname, 'signature', pg_get_function_identity_arguments(proc.oid),
      'security_definer', proc.prosecdef, 'settings', proc.proconfig,
      'authenticated_execute', has_function_privilege('authenticated', proc.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', proc.oid, 'EXECUTE'),
      'definition', pg_get_functiondef(proc.oid)
    ) order by proc.proname)
    from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public' and proc.proname in ('create_family', 'create_family_with_child')
  ),
  'existing_invitation_table_columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'type', data_type
    ) order by table_name, ordinal_position), '[]'::jsonb)
    from information_schema.columns where table_schema = 'public'
      and table_name in ('family_invitations', 'family_invites', 'invitations')
  )
)) as family_access_metadata;
