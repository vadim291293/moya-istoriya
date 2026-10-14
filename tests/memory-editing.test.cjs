const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTypescript } = require('./load-typescript.cjs');

// All identities/rows are synthetic. No real key, session or HTTP is used.
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const MEMORY = '44444444-4444-4444-8444-444444444444';
const CHILD = '55555555-5555-4555-8555-555555555555';
const CHILD2 = '66666666-6666-4666-8666-666666666666';
const scope = { userId: USER, familyId: FAMILY, memoryId: MEMORY };
const details = () => ({ title: 'Первое фото', body: null, eventDate: '2024-02-19', childIds: [CHILD] });
const desired = () => ({ title: 'Прогулка', body: 'Семейная история', eventDate: '2024-03-15', childIds: [CHILD2] });
const editable = () => ({ id: MEMORY, familyId: FAMILY, authorId: USER, hasMedia: true, details: details() });
const payload = (value) => ({ title: value.title, body: value.body, event_date: value.eventDate, child_ids: value.childIds });

function harness() {
  const state = {
    userId: USER, role: 'member', membership: true, memory: editable(),
    membershipError: null, readError: null, rpcError: null, commitOnError: false,
    calls: [], rpcs: [], afterMembership: null, afterRead: null, beforeRpc: null,
    rpcResponse: MEMORY,
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: state.userId ? {
      user: { id: state.userId }, access_token: 'synthetic:' + state.userId,
    } : null }, error: null }) },
    from: (table) => {
      const request = { table, filters: {}, headers: {} };
      const builder = {
        select: (selection) => { request.selection = selection; return builder; },
        eq: (key, value) => { request.filters[key] = value; return builder; },
        setHeader: (key, value) => { request.headers[key] = value; return builder; },
        maybeSingle: async () => {
          state.calls.push(request);
          if (table === 'family_members') {
            const result = { data: state.membership ? { role: state.role } : null, error: state.membershipError };
            state.afterMembership?.();
            return result;
          }
          assert.equal(table, 'memories', 'editing must not touch any other table directly');
          const memory = state.memory;
          const result = { data: memory ? {
            id: memory.id, family_id: memory.familyId, author_id: memory.authorId,
            title: memory.details.title, body: memory.details.body, event_date: memory.details.eventDate,
            diary_category: memory.diaryCategory ?? null,
            memory_children: memory.details.childIds.map((child_id) => ({ child_id })),
            media_files: memory.hasMedia ? [{ id: 'synthetic-media' }] : [],
          } : null, error: state.readError };
          state.afterRead?.();
          return result;
        },
      };
      return builder;
    },
    rpc: (name, args) => {
      const request = { name, args, headers: {} };
      const builder = {
        setHeader: (key, value) => { request.headers[key] = value; return builder; },
        then: (resolve, reject) => Promise.resolve().then(async () => {
          state.rpcs.push(request);
          await state.beforeRpc?.();
          if (state.rpcError && !state.commitOnError) return { data: null, error: state.rpcError };
          // Mock the SQL contract, not SQL execution: comparison/atomic writes
          // still require a separate PostgreSQL/live verification before launch.
          if (JSON.stringify(payload(state.memory.details)) !== JSON.stringify(args.p_expected)) {
            return { data: null, error: { code: 'P0001', message: 'MEMORY_EDIT_CONFLICT' } };
          }
          state.memory.details = {
            title: args.p_details.title, body: args.p_details.body,
            eventDate: args.p_details.event_date, childIds: [...args.p_details.child_ids],
          };
          return { data: state.rpcError ? null : state.rpcResponse, error: state.rpcError };
        }).then(resolve, reject),
      };
      return builder;
    },
  };
  const service = loadTypescript('src/lib/memory-editing-service.ts', { './supabase': { supabase: client } });
  const attempt = () => service.prepareMemoryEdit({ userId: USER, memory: editable(), details: desired() });
  return { state, service, attempt };
}

test('edit preparation copies baseline exactly, trims replacements and does not mutate the form', () => {
  const h = harness(), memory = editable(), requested = desired();
  memory.details.title = '  Старый текст  '; requested.title = '  Новый текст  ';
  const attempt = h.service.prepareMemoryEdit({ userId: USER, memory, details: requested });
  assert.equal(attempt.expected.title, '  Старый текст  ');
  assert.equal(attempt.desired.title, 'Новый текст');
  memory.details.childIds.push(CHILD2); requested.childIds.push(CHILD);
  assert.equal(attempt.expected.childIds.length, 1); assert.equal(attempt.desired.childIds.length, 1);
  assert.equal(requested.title, '  Новый текст  ');
});

test('diary voice attachments do not permit erasing the required diary text', async () => {
  const h = harness(); h.state.memory.diaryCategory = 'words';
  const memory = await h.service.loadEditableMemory(scope);
  assert.equal(memory.hasMedia, true); assert.equal(memory.requiresText, true);
  const empty = { ...details(), title: '  ', body: null };
  assert.throws(() => h.service.prepareMemoryEdit({ userId: USER, memory, details: empty }),
    (error) => error.kind === 'invalid');
  const attempt = { ...h.attempt(), desired: { ...empty, title: null } };
  await assert.rejects(h.service.saveMemoryEdit(attempt), (error) => error.kind === 'invalid');
  assert.equal(h.state.rpcs.length, 0);
  const replacement = h.service.prepareMemoryEdit({ userId: USER, memory, details: desired() });
  assert.equal(await h.service.saveMemoryEdit(replacement), MEMORY);
});

test('child tags are case-normalized, de-duplicated and sorted for snapshot comparison', () => {
  const h = harness(), memory = editable(), requested = desired();
  const letterId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  requested.childIds = [letterId, CHILD2, CHILD2];
  const attempt = h.service.prepareMemoryEdit({ userId: USER, memory, details: requested });
  assert.deepEqual(Array.from(attempt.desired.childIds), [CHILD2, letterId.toLowerCase()]);
});

test('bad IDs, malformed dates, unknown child IDs and oversized arrays fail before an API call', () => {
  const h = harness();
  for (const requested of [
    { ...desired(), eventDate: '2024-02-30' }, { ...desired(), eventDate: '2024-2-3' },
    { ...desired(), childIds: ['bad'] }, { ...desired(), childIds: [null] },
    { ...desired(), childIds: Array(1001).fill(CHILD) },
  ]) assert.throws(() => h.service.prepareMemoryEdit({ userId: USER, memory: editable(), details: requested }),
    (error) => error.kind === 'invalid');
  assert.throws(() => h.service.prepareMemoryEdit({ userId: 'bad', memory: editable(), details: desired() }));
  assert.equal(h.state.calls.length, 0);
});

test('future date and title/body bounds are checked without losing the original value', () => {
  const h = harness();
  for (const requested of [
    { ...desired(), eventDate: '9999-12-31' }, { ...desired(), title: 'x'.repeat(121) },
    { ...desired(), body: 'x'.repeat(4001) },
  ]) assert.throws(() => h.service.prepareMemoryEdit({ userId: USER, memory: editable(), details: requested }));
  assert.doesNotThrow(() => h.service.prepareMemoryEdit({ userId: USER, memory: editable(),
    details: { ...desired(), title: 'x'.repeat(120), body: 'x'.repeat(4000) } }));
});

test('text-only memory cannot become empty; an existing media memory may lose its caption', () => {
  const h = harness(), memory = editable();
  memory.hasMedia = false;
  const requested = { ...desired(), title: '  ', body: '' };
  assert.throws(() => h.service.prepareMemoryEdit({ userId: USER, memory, details: requested }));
  memory.hasMedia = true;
  const attempt = h.service.prepareMemoryEdit({ userId: USER, memory, details: requested });
  assert.equal(attempt.desired.title, null); assert.equal(attempt.desired.body, null);
});

test('own memory is loaded with exact family/account constraints and no signed URL request', async () => {
  const h = harness(); const memory = await h.service.loadEditableMemory(scope);
  assert.equal(memory.id, MEMORY); assert.equal(memory.hasMedia, true);
  assert.deepEqual(h.state.calls.map((call) => call.table), ['family_members', 'memories']);
  assert.deepEqual(h.state.calls[0].filters, { user_id: USER, family_id: FAMILY });
  assert.deepEqual(h.state.calls[1].filters, { id: MEMORY, family_id: FAMILY });
  assert.ok(h.state.calls[1].selection.includes('media_files(id)'));
});

test('owner may prepare a different author in the same family; a regular member cannot', async () => {
  const h = harness(); h.state.memory.authorId = OTHER;
  await assert.rejects(h.service.loadEditableMemory(scope), (error) => error.kind === 'forbidden');
  h.state.role = 'owner';
  assert.equal((await h.service.loadEditableMemory(scope)).authorId, OTHER);
});

test('unknown or null role does not grant editing of another author', async () => {
  for (const role of [null, 'admin', 'viewer', 'OWNER']) {
    const h = harness(); h.state.role = role; h.state.memory.authorId = OTHER;
    await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'forbidden');
    assert.equal(h.state.rpcs.length, 0);
  }
});

test('absent membership stops before reading a memory or sending an edit', async () => {
  const h = harness(); h.state.membership = false;
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'forbidden');
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.rpcs.length, 0);
});

test('read failures and inaccessible memory never turn into a new memory INSERT', async () => {
  for (const field of ['membershipError', 'readError', 'memory']) {
    const h = harness(); h.state[field] = field === 'memory' ? null : new Error('offline');
    await assert.rejects(h.service.saveMemoryEdit(h.attempt()));
    assert.equal(h.state.rpcs.length, 0);
  }
});

test('unexpected memory or family in a server response is rejected', async () => {
  for (const field of ['id', 'familyId']) {
    const h = harness(); h.state.memory[field] = OTHER;
    await assert.rejects(h.service.loadEditableMemory(scope), (error) => error.kind === 'read');
  }
});

test('normal save sends only one editing RPC with baseline and desired detail fields', async () => {
  const h = harness(); assert.equal(await h.service.saveMemoryEdit(h.attempt()), MEMORY);
  assert.equal(h.state.rpcs.length, 1);
  const request = h.state.rpcs[0];
  assert.equal(request.name, 'update_family_memory_details');
  assert.deepEqual(Object.keys(request.args).sort(), ['p_details', 'p_expected', 'p_family_id', 'p_memory_id']);
  assert.equal(request.args.p_family_id, FAMILY); assert.equal(request.args.p_memory_id, MEMORY);
  assert.equal(request.args.p_expected.event_date, details().eventDate);
  assert.equal(request.args.p_details.event_date, desired().eventDate);
  assert.ok(h.state.calls.every((call) => call.headers.Authorization === 'Bearer synthetic:' + USER));
  assert.equal(request.headers.Authorization, 'Bearer synthetic:' + USER);
});

test('already achieved replacement is returned without another RPC', async () => {
  const h = harness(); h.state.memory.details = desired();
  assert.equal(await h.service.saveMemoryEdit(h.attempt()), MEMORY);
  assert.equal(h.state.rpcs.length, 0);
});

test('changed baseline or child tags conflict before sending an edit', async () => {
  for (const change of [{ title: 'Другая подпись' }, { childIds: [] }]) {
    const h = harness(); Object.assign(h.state.memory.details, change);
    await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'conflict');
    assert.equal(h.state.rpcs.length, 0);
  }
});

test('concurrent server change after the client check cannot be silently rebased', async () => {
  const h = harness(); h.state.beforeRpc = () => { h.state.memory.details.title = 'Правка родственника'; };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'conflict');
  assert.equal(h.state.memory.details.title, 'Правка родственника');
  assert.equal(h.state.rpcs.length, 1);
});

test('lost response after a committed edit reconciles requested fields as achieved', async () => {
  const h = harness(); h.state.rpcError = new Error('response lost'); h.state.commitOnError = true;
  assert.equal(await h.service.saveMemoryEdit(h.attempt()), MEMORY);
  assert.equal(h.state.rpcs.length, 1);
  assert.equal(h.state.memory.details.title, desired().title);
});

test('unknown response and unchanged read remain unconfirmed, not a claimed rollback', async () => {
  const h = harness(); h.state.rpcError = new Error('offline');
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'pending');
  assert.equal(h.state.memory.details.title, details().title); assert.equal(h.state.rpcs.length, 1);
});

test('failed reconciliation preserves an unknown outcome and does not auto-repeat the RPC', async () => {
  const h = harness(); h.state.rpcError = new Error('offline');
  h.state.beforeRpc = () => { h.state.readError = new Error('offline'); };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'pending');
  assert.equal(h.state.rpcs.length, 1);
});

test('unknown response followed by a different server version is a conflict', async () => {
  const h = harness(); h.state.rpcError = new Error('offline');
  h.state.beforeRpc = () => { h.state.memory.details.body = 'Изменено другим устройством'; };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'conflict');
});

test('explicit retry uses the same baseline, memory ID and desired fields', async () => {
  const h = harness(), attempt = h.attempt(); h.state.rpcError = new Error('offline');
  await assert.rejects(h.service.saveMemoryEdit(attempt));
  const first = h.state.rpcs[0].args; h.state.rpcError = null;
  assert.equal(await h.service.saveMemoryEdit(attempt), MEMORY);
  assert.deepEqual(h.state.rpcs[1].args, first);
});

test('stale account or logout stops before any read or edit', async () => {
  for (const userId of [OTHER, null]) {
    const h = harness(); h.state.userId = userId;
    await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'scope');
    assert.equal(h.state.calls.length, 0); assert.equal(h.state.rpcs.length, 0);
  }
});

test('account change while checking membership blocks the following memory request', async () => {
  const h = harness(); h.state.afterMembership = () => { h.state.userId = OTHER; };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'scope');
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.rpcs.length, 0);
});

test('account change while reading the original row blocks the RPC', async () => {
  const h = harness(); h.state.afterRead = () => { h.state.userId = OTHER; };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'scope');
  assert.equal(h.state.rpcs.length, 0);
});

test('in-flight edit remains bound to its original token and never reports success in a new account', async () => {
  const h = harness(); h.state.beforeRpc = () => { h.state.userId = OTHER; };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'scope');
  assert.equal(h.state.rpcs[0].headers.Authorization, 'Bearer synthetic:' + USER);
  assert.equal(h.state.calls.length, 2, 'no reconciliation as the next account');
});

test('simultaneous save calls are blocked before a duplicate RPC', async () => {
  const h = harness(), attempt = h.attempt();
  const first = h.service.saveMemoryEdit(attempt);
  await assert.rejects(h.service.saveMemoryEdit(attempt), (error) => error.kind === 'busy');
  await first; assert.equal(h.state.rpcs.length, 1);
});

test('unexpected success response must be reconciled rather than trusted', async () => {
  const h = harness(); h.state.rpcResponse = OTHER;
  assert.equal(await h.service.saveMemoryEdit(h.attempt()), MEMORY);
  assert.equal(h.state.calls.length, 4);
});

test('missing RPC is an explicit not-enabled error with no direct table update fallback', async () => {
  const h = harness(); h.state.rpcError = { code: 'PGRST202', message: 'Function not found' };
  await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === 'unavailable');
  assert.equal(h.state.calls.length, 2); assert.equal(h.state.memory.details.title, details().title);
});

test('server authorization and validation errors are not disguised as network failures', async () => {
  for (const [code, kind] of [['42501', 'forbidden'], ['22023', 'invalid'], ['22007', 'invalid'],
    ['22008', 'invalid'], ['22P02', 'invalid']]) {
    const h = harness(); h.state.rpcError = { code, message: 'synthetic rejection' };
    await assert.rejects(h.service.saveMemoryEdit(h.attempt()), (error) => error.kind === kind);
    assert.equal(h.state.calls.length, 2);
  }
});

test('caller changes to a submitted attempt cannot replace the payload while awaiting reads', async () => {
  const h = harness(), attempt = h.attempt();
  const save = h.service.saveMemoryEdit(attempt);
  attempt.desired.title = 'Не эта отправка'; attempt.desired.childIds.push(CHILD);
  attempt.expected.title = 'Подменённая версия';
  await save;
  assert.equal(h.state.rpcs[0].args.p_details.title, desired().title);
  assert.equal(h.state.rpcs[0].args.p_details.child_ids.length, 1);
  assert.equal(h.state.rpcs[0].args.p_expected.title, details().title);
});

test('reconciliation distinguishes achieved, unconfirmed and conflicting state without writes', async () => {
  const h = harness(), attempt = h.attempt();
  assert.equal((await h.service.reconcileMemoryEdit(attempt)).status, 'not_confirmed');
  h.state.memory.details = desired();
  assert.equal((await h.service.reconcileMemoryEdit(attempt)).status, 'matches_requested');
  h.state.memory.details.title = 'Совсем другое';
  assert.equal((await h.service.reconcileMemoryEdit(attempt)).status, 'conflict');
  assert.equal(h.state.rpcs.length, 0);
});

test('a malformed externally supplied attempt fails before contacting the API', async () => {
  const h = harness(); await assert.rejects(h.service.saveMemoryEdit({ ...h.attempt(), memoryId: 'bad' }));
  assert.equal(h.state.calls.length, 0); assert.equal(h.state.rpcs.length, 0);
});

test('removing all note text is rejected against actual media state even if the caller guessed hasMedia', async () => {
  const h = harness(); h.state.memory.hasMedia = false;
  const attempt = h.service.prepareMemoryEdit({ userId: USER, memory: editable(),
    details: { ...desired(), title: null, body: null } });
  await assert.rejects(h.service.saveMemoryEdit(attempt), (error) => error.kind === 'invalid');
  assert.equal(h.state.rpcs.length, 0);
});

test('editing SQL static boundary checks (not SQL execution or RLS proof)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/setup/003_edit_memory_details.sql'), 'utf8');
  assert.match(sql, /create function moya_private\.update_family_memory_details/);
  assert.match(sql, /returns uuid language sql security invoker/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /author_id is distinct from v_user_id and v_role is distinct from 'owner'/);
  assert.match(sql, /for update/); assert.match(sql, /MEMORY_EDIT_CONFLICT/);
  assert.match(sql, /v_current = v_desired then return p_memory_id/);
  assert.match(sql, /alter policy "members can link children in the same family"/);
  assert.match(sql, /Membership mutation policies exist/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon/);
  assert.doesNotMatch(sql, /(?:update|delete from|insert into)\s+(?:public\.media_files|storage\.)/i);
  assert.doesNotMatch(sql, /grant\s+(?:update|delete)/i);
});

test('draft SQL checks NOT NULL scope and snapshot columns without repairing the schema (static only)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/setup/003_edit_memory_details.sql'), 'utf8');
  assert.match(sql, /not a\.attisdropped and a\.attnotnull/);
  assert.match(sql, /Expected NOT NULL column missing/);
  for (const [table, column] of [['memories', 'author_id'], ['memories', 'event_date'],
    ['memory_children', 'child_id'], ['media_files', 'memory_id'], ['family_members', 'user_id']]) {
    assert.ok(sql.includes(`('${table}', '${column}')`));
  }
  assert.doesNotMatch(sql, /alter table|add constraint|set not null/i);
});

test('draft SQL requires exact immediate valid unique keys rather than partial or larger indexes (static only)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/setup/003_edit_memory_details.sql'), 'utf8');
  for (const key of ["('memories', array['id']::text[])", "('children', array['id']::text[])",
    "('family_members', array['family_id', 'user_id']::text[])",
    "('memory_children', array['memory_id', 'child_id']::text[])"]) assert.ok(sql.includes(key));
  assert.match(sql, /i\.indisunique and i\.indisvalid and i\.indisready and i\.indislive/);
  assert.match(sql, /i\.indimmediate and i\.indpred is null and i\.indexprs is null/);
  assert.match(sql, /i\.indnkeyatts = cardinality\(v_required\.column_names\)/);
  assert.match(sql, /key_column\.position <= i\.indnkeyatts order by key_column\.attnum/);
  assert.match(sql, /Expected immediate unique key missing/);
});

test('draft SQL checks validated immediate known FKs; does not invent membership user FK (static only)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/setup/003_edit_memory_details.sql'), 'utf8');
  assert.match(sql, /con\.contype = 'f' and con\.convalidated and not con\.condeferrable/);
  assert.match(sql, /con\.conkey = array\[source_column\.attnum\]/);
  assert.match(sql, /con\.confkey = array\[target_column\.attnum\]/);
  for (const fk of ["('memories', 'author_id', 'auth.users', 'id')",
    "('memory_children', 'memory_id', 'public.memories', 'id')",
    "('memory_children', 'child_id', 'public.children', 'id')",
    "('media_files', 'memory_id', 'public.memories', 'id')",
    "('children', 'family_id', 'public.families', 'id')"]) assert.ok(sql.includes(fk));
  assert.doesNotMatch(sql, /\('family_members', 'user_id', 'auth\.users'/);
});

test('metadata check includes standalone unique indexes and callable application functions (static read-only check)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/checks/memory_editing_metadata_readonly.sql'), 'utf8');
  assert.match(sql, /'unique_indexes'/); assert.match(sql, /pg_get_indexdef\(i\.indexrelid\)/);
  assert.match(sql, /'application_functions'/); assert.match(sql, /p\.prokind = 'f'/);
  assert.match(sql, /p\.prosecdef or has_function_privilege\('authenticated'/);
  assert.match(sql, /d\.deptype = 'e'/);
  const statements = sql.replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(statements, /\b(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
});

function sdkHarness(rpcFailure = false) {
  const { createClient } = require('@supabase/supabase-js');
  const requests = [];
  const client = createClient('https://editing.example.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const request = { url: new URL(url), method: init.method, headers: new Headers(init.headers), body: init.body };
      requests.push(request);
      let result;
      if (request.url.pathname === '/rest/v1/family_members') result = { role: 'member' };
      else if (request.url.pathname === '/rest/v1/memories') result = {
        id: MEMORY, family_id: FAMILY, author_id: USER, title: details().title, body: null,
        event_date: details().eventDate, memory_children: [{ child_id: CHILD }], media_files: [{ id: 'synthetic-media' }],
      };
      else if (request.url.pathname === '/rest/v1/rpc/update_family_memory_details') {
        if (rpcFailure) return new Response(JSON.stringify({ code: 'PGRST202', message: 'Function is not published' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } });
        result = MEMORY;
      } else throw new Error('Unexpected mock endpoint: ' + request.url.pathname);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  client.auth.getSession = async () => ({ data: { session: {
    user: { id: USER }, access_token: 'synthetic:' + USER,
  } }, error: null });
  const service = loadTypescript('src/lib/memory-editing-service.ts', { './supabase': { supabase: client } });
  const attempt = service.prepareMemoryEdit({ userId: USER, memory: editable(), details: desired() });
  return { service, attempt, requests };
}

test('installed SDK serializes edit scope, exact original snapshot and checked actor (mock HTTP only)', async () => {
  const h = sdkHarness(); assert.equal(await h.service.saveMemoryEdit(h.attempt), MEMORY);
  assert.equal(h.requests.length, 3);
  const [membership, memory, edit] = h.requests;
  assert.equal(membership.method, 'GET'); assert.equal(memory.method, 'GET'); assert.equal(edit.method, 'POST');
  assert.equal(membership.url.searchParams.get('user_id'), 'eq.' + USER);
  assert.equal(membership.url.searchParams.get('family_id'), 'eq.' + FAMILY);
  assert.equal(memory.url.searchParams.get('id'), 'eq.' + MEMORY);
  assert.equal(memory.url.searchParams.get('family_id'), 'eq.' + FAMILY);
  const body = JSON.parse(edit.body);
  assert.equal(body.p_memory_id, MEMORY); assert.equal(body.p_family_id, FAMILY);
  assert.deepEqual(body.p_expected, payload(details())); assert.deepEqual(body.p_details, payload(desired()));
  assert.ok(h.requests.every((request) => request.headers.get('authorization') === 'Bearer synthetic:' + USER));
});

test('installed SDK returns an unpublished edit endpoint as unavailable without fallback writes', async () => {
  const h = sdkHarness(true);
  await assert.rejects(h.service.saveMemoryEdit(h.attempt), (error) => error.kind === 'unavailable');
  assert.equal(h.requests.length, 3);
  assert.ok(h.requests.every((request) => !request.url.pathname.startsWith('/storage/')));
});
