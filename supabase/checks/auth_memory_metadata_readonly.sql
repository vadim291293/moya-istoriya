-- Read-only metadata check. Does not call application RPCs or read private rows.
select
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0 as has_user_lock,
  position('if found then' in pg_get_functiondef(p.oid)) > 0 as returns_existing_child,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous_execute
from pg_proc p
where p.oid = 'public.create_family_with_child(text,text,date)'::regprocedure;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('anon', c.oid, 'SELECT') as anonymous_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('families', 'family_members', 'children', 'memories', 'memory_children', 'media_files')
order by c.relname;

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('families', 'family_members', 'children', 'memories', 'memory_children', 'media_files')
order by tablename, cmd, policyname;
