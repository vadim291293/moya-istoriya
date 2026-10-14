-- READ ONLY. Intended project: thmzpgugjognrnqtzbqg.
-- Run before reviewing SQL 003; this reads catalogs, not private family rows.
-- Does not call application RPCs or change any data/schema/settings.
select jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'owner', pg_get_userbyid(c.relowner),
      'columns', (
        select jsonb_agg(jsonb_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull
        ) order by a.attnum)
        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ),
      'constraints', (
        select jsonb_agg(jsonb_build_object('name', con.conname,
          'definition', pg_get_constraintdef(con.oid)) order by con.conname)
        from pg_constraint con where con.conrelid = c.oid
      ),
      'unique_indexes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'definition', pg_get_indexdef(i.indexrelid),
          'valid', i.indisvalid, 'ready', i.indisready, 'live', i.indislive,
          'immediate', i.indimmediate, 'key_column_count', i.indnkeyatts,
          'partial', i.indpred is not null, 'expression', i.indexprs is not null
        ) order by i.indexrelid), '[]'::jsonb)
        from pg_index i where i.indrelid = c.oid and i.indisunique
      ),
      'policies', (
        select jsonb_agg(jsonb_build_object('name', p.policyname, 'roles', p.roles,
          'command', p.cmd, 'using', p.qual, 'with_check', p.with_check) order by p.policyname)
        from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
      ),
      'authenticated_grants', jsonb_build_object(
        'select', has_table_privilege('authenticated', c.oid, 'SELECT'),
        'insert', has_table_privilege('authenticated', c.oid, 'INSERT'),
        'update', has_table_privilege('authenticated', c.oid, 'UPDATE'),
        'delete', has_table_privilege('authenticated', c.oid, 'DELETE')
      ),
      'triggers', (
        select coalesce(jsonb_agg(jsonb_build_object('name', t.tgname,
          'definition', pg_get_triggerdef(t.oid))), '[]'::jsonb)
        from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
      )
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname in ('memories', 'memory_children', 'media_files', 'children', 'family_members')
  ),
  -- Inspect non-extension application functions as well as the new RPC:
  -- author/owner authorization is unsafe if another callable definer can
  -- assign arbitrary family roles. Availability through Data API still needs
  -- a separate allowlist check; EXECUTE alone does not prove publication.
  'application_functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname, 'signature', pg_get_function_identity_arguments(p.oid),
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef, 'settings', p.proconfig,
      'definition', pg_get_functiondef(p.oid),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE')
    )), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.prosecdef or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or p.proname = 'update_family_memory_details')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  )
)) as memory_editing_metadata;
