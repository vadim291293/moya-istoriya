// Read-only check using the public client key. Does not call write RPCs or print private rows.
require('@expo/env').load(process.cwd());
const { createClient } = require('@supabase/supabase-js');

const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publicKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!projectUrl || !publicKey) throw new Error('Missing public Supabase configuration.');
if (new URL(projectUrl).hostname !== 'thmzpgugjognrnqtzbqg.supabase.co') {
  throw new Error('Unexpected project: this check references the approved test fixture project.');
}

const client = createClient(projectUrl, publicKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function check() {
  for (const table of ['families', 'family_members', 'children', 'memories', 'memory_children', 'media_files']) {
    const column = table === 'memory_children' ? 'memory_id' : 'id';
    const { data, error } = await client.from(table).select(column).limit(1);
    const exposedRows = data?.length ?? 0;
    console.log(JSON.stringify({ table, exposedRows, errorCode: error?.code ?? null }));
    if (exposedRows > 0) throw new Error(`Anonymous access returned a private row in ${table}. Stop and review RLS.`);
    if (error && error.code !== '42501') {
      throw new Error(`Endpoint check failed for ${table}; this is not a successful access-isolation test.`);
    }
  }
  for (const [name, args] of [
    ['list_family_access', { p_family_id: '958888d7-31e7-4fc1-94cf-65ec10e5df0c' }],
    ['list_family_trash', { p_family_id: '958888d7-31e7-4fc1-94cf-65ec10e5df0c', p_before: null, p_before_id: null }],
    ['get_memory_lifecycle', { p_family_id: '958888d7-31e7-4fc1-94cf-65ec10e5df0c', p_memory_id: '00000000-0000-4000-8000-000000000001' }],
  ]) {
    // These three RPCs only read. No anonymous mutation RPC is invoked.
    const { data, error } = await client.rpc(name, args);
    console.log(JSON.stringify({ check: 'anonymous_read_rpc', name, errorCode: error?.code ?? null }));
    if (data !== null || error?.code !== '42501') throw new Error('Anonymous RPC was not explicitly denied: ' + name);
  }
  // Syntax/schema check for the actual chapter query. There is no session, so
  // zero rows are expected even when the known test family has a memory.
  // This does not prove the result of an authenticated chapter query.
  const { data: chapter, error: chapterError } = await client.from('memories')
    .select('id,event_date,memory_children!inner(child_id),media_files(id)')
    .eq('family_id', '958888d7-31e7-4fc1-94cf-65ec10e5df0c')
    .eq('memory_children.child_id', 'b9f7d2b6-05e2-4839-9a5b-a8c5f61e64c2')
    .gte('event_date', '2024-01-02').lt('event_date', '2024-01-03')
    .order('event_date', { ascending: true }).order('created_at', { ascending: true })
    .order('id', { ascending: true }).limit(11);
  console.log(JSON.stringify({ check: 'anonymous_chapter_query', exposedRows: chapter?.length ?? 0, errorCode: chapterError?.code ?? null }));
  if (chapterError || chapter?.length !== 0) throw new Error('Chapter query failed or exposed anonymous rows.');
  // Exercise the actual production read query including the new raw .or()
  // predicate. The anchor is synthetic, this client has no user session, and
  // no signed URLs are requested unless anonymous access exposes private rows.
  const { loadTypescript } = require('../tests/load-typescript.cjs');
  const { getFamilyMemories } = loadTypescript('src/lib/memory-service.ts', {
    './supabase': { supabase: client }, 'expo-crypto': {}, './media-file': {},
  });
  const { createMemoryCursor } = loadTypescript('src/lib/memory-pagination.ts');
  for (const orderBy of ['event', 'added']) for (const ascending of [false, true]) {
    const input = { familyId: '958888d7-31e7-4fc1-94cf-65ec10e5df0c',
      childId: 'b9f7d2b6-05e2-4839-9a5b-a8c5f61e64c2',
      dateRange: { fromInclusive: '2024-01-01', toExclusive: '2025-01-01' }, orderBy, ascending, limit: 1 };
    const after = createMemoryCursor({ id: '00000000-0000-4000-8000-000000000001',
      event_date: '2024-03-01', created_at: '2026-10-08T10:00:00.000123+00:00' }, input);
    const page = await getFamilyMemories({ ...input, after });
    console.log(JSON.stringify({ check: 'anonymous_cursor_query', orderBy, ascending,
      exposedRows: page.items.length, hasMore: page.hasMore }));
    if (page.items.length || page.hasMore || page.nextCursor !== null) throw new Error('Cursor query exposed anonymous rows.');
  }
  console.log('No private rows returned to the anonymous API client. This does not replace two-account RLS tests.');
}

check().catch((error) => { console.error(error.message); process.exitCode = 1; });
