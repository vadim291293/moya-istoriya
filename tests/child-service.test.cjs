const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAMILY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHILD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY = `moya-istoriya:pending-child:v1:${USER}:${FAMILY}`;
const input = () => ({ userId: USER, familyId: FAMILY, name: '  Маша  ', birthDate: '2024-01-31' });
// Production modules run in a VM; compare JSON data, not cross-realm prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness() {
  const values = new Map();
  const journal = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const state = { userId: USER, membership: true, rows: new Map(), inserts: [], reads: [],
    insertError: null, readError: null, commitOnError: false, onMembership: null, onInsert: null };
  let sequence = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: state.userId ? { user: { id: state.userId } } : null }, error: null }) },
    from(table) {
      const filters = {};
      let payload;
      const builder = {
        select: () => builder,
        eq: (key, value) => { filters[key] = value; return builder; },
        insert: (value) => { payload = value; return builder; },
        async maybeSingle() {
          if (table === 'family_members') {
            state.onMembership?.();
            return { data: state.membership ? { family_id: filters.family_id } : null, error: null };
          }
          state.reads.push({ ...filters });
          const row = state.rows.get(filters.id);
          return { data: row?.family_id === filters.family_id ? row : null, error: state.readError };
        },
        async single() {
          assert.equal(table, 'children');
          assert.ok(values.has(KEY), 'journal must exist before any insert');
          state.inserts.push(payload);
          await state.onInsert?.();
          const duplicate = state.rows.has(payload.id);
          if (!duplicate && (!state.insertError || state.commitOnError)) state.rows.set(payload.id, payload);
          return { data: duplicate || state.insertError ? null : payload,
            error: duplicate ? { code: '23505' } : state.insertError };
        },
      };
      return builder;
    },
  };
  const load = () => loadTypescript('src/lib/child-service.ts', {
    './supabase': { supabase: client },
    'expo-crypto': { randomUUID: () => `${String(++sequence).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` },
  }, { localStorage: journal });
  return { state, journal, values, load };
}

test('add child uses only confirmed columns, trimmed name and a journal before writing', async () => {
  const h = harness();
  const id = await h.load().createFamilyChild(input());
  assert.deepEqual(plain(h.state.inserts), [{ id, family_id: FAMILY, name: 'Маша', birth_date: '2024-01-31' }]);
  assert.equal(h.values.size, 0);
  assert.deepEqual(h.state.reads[0], { id, family_id: FAMILY });
});

test('lost insert response is reconciled to the exact same child', async () => {
  const h = harness();
  h.state.insertError = new Error('lost response'); h.state.commitOnError = true;
  const id = await h.load().createFamilyChild(input());
  assert.ok(h.state.rows.has(id)); assert.equal(h.state.inserts.length, 1); assert.equal(h.values.size, 0);
});

test('unknown result survives reload and keeps UUID and original form values', async () => {
  const h = harness(); h.state.insertError = new Error('offline');
  await assert.rejects(h.load().createFamilyChild(input()), (error) => error.pending === true);
  const original = JSON.parse(h.values.get(KEY));
  h.state.insertError = null;
  const id = await h.load().createFamilyChild({ ...input(), name: 'Changed form', birthDate: '2025-02-01' });
  assert.equal(id, original.childId);
  assert.deepEqual(plain(h.state.inserts[1]), plain(h.state.inserts[0]));
  assert.equal(h.state.rows.size, 1); assert.equal(h.values.size, 0);
});

test('committed child found after restart is not inserted again', async () => {
  const h = harness(); h.state.insertError = new Error('offline');
  await assert.rejects(h.load().createFamilyChild(input()));
  const row = h.state.inserts[0]; h.state.rows.set(row.id, row);
  assert.equal(await h.load().createFamilyChild(input()), row.id);
  assert.equal(h.state.inserts.length, 1);
});

test('duplicate primary key race reconciles without upsert or overwrite', async () => {
  const h = harness();
  h.state.onInsert = () => {
    const row = h.state.inserts[0]; h.state.rows.set(row.id, row);
  };
  const id = await h.load().createFamilyChild(input());
  assert.equal(h.state.rows.size, 1); assert.equal(h.state.inserts.length, 1);
  assert.equal(h.state.rows.get(id).name, 'Маша');
});

test('same UUID with different fields is not mistaken for a successful retry', async () => {
  const h = harness(); h.state.insertError = new Error('offline');
  await assert.rejects(h.load().createFamilyChild(input()));
  const row = h.state.inserts[0]; h.state.rows.set(row.id, { ...row, name: 'Different child' });
  await assert.rejects(h.load().createFamilyChild(input()), (error) => error.pending === true);
  assert.equal(h.state.inserts.length, 1); assert.equal(h.values.size, 1);
});

test('failed lookup does not start insert or discard the pending journal', async () => {
  const h = harness(); h.state.readError = new Error('offline');
  await assert.rejects(h.load().createFamilyChild(input()), (error) => error.pending === true);
  assert.equal(h.state.inserts.length, 0); assert.equal(h.values.size, 1);
});

test('invalid name, date, future date and family ID fail before journaling or insert', async () => {
  for (const change of [{ name: ' ' }, { name: 'a'.repeat(81) }, { birthDate: '' },
    { birthDate: '2024-02-30' }, { birthDate: '9999-01-01' }, { familyId: 'invalid' }]) {
    const h = harness();
    await assert.rejects(h.load().createFamilyChild({ ...input(), ...change }));
    assert.equal(h.values.size, 0); assert.equal(h.state.inserts.length, 0);
  }
});

test('missing membership or different account stops before any server write', async () => {
  for (const mode of ['membership', 'account', 'logout']) {
    const h = harness();
    if (mode === 'membership') h.state.membership = false;
    else h.state.userId = mode === 'account' ? OTHER : null;
    await assert.rejects(h.load().createFamilyChild(input()));
    assert.equal(h.values.size, 0); assert.equal(h.state.inserts.length, 0);
  }
});

test('account change during membership preflight prevents journaling', async () => {
  const h = harness(); h.state.onMembership = () => { h.state.userId = OTHER; };
  await assert.rejects(h.load().createFamilyChild(input()));
  assert.equal(h.state.inserts.length, 0); assert.equal(h.values.size, 0);
});

test('account change after insert keeps the old account journal until reconciliation', async () => {
  const h = harness(); h.state.onInsert = () => { h.state.userId = OTHER; };
  await assert.rejects(h.load().createFamilyChild(input()), (error) => error.pending === true);
  assert.equal(h.values.size, 1);
  h.state.userId = USER; h.state.onInsert = null;
  const id = await h.load().createFamilyChild(input());
  assert.equal(h.state.inserts.length, 1); assert.equal(h.values.size, 0); assert.ok(h.state.rows.has(id));
});

test('corrupt journal blocks new submission; pending data is scoped by user and family', async () => {
  const h = harness(); const service = h.load(); h.values.set(KEY, '{broken');
  await assert.rejects(service.createFamilyChild(input()), (error) => error.pending === true);
  assert.equal(h.values.get(KEY), '{broken'); assert.equal(h.state.inserts.length, 0);
  assert.equal(service.getPendingFamilyChild(OTHER, FAMILY), null);
  assert.equal(service.getPendingFamilyChild(USER, OTHER), null);
  h.values.set(KEY, JSON.stringify({ version: 1, userId: OTHER, familyId: FAMILY, childId: CHILD,
    name: 'Child', birthDate: '2024-01-01' }));
  assert.throws(() => service.getPendingFamilyChild(USER, FAMILY));
});

test('storage quota failure prevents insert; failed cleanup safely retains committed journal', async () => {
  const h = harness(); h.journal.setItem = () => { throw new Error('quota'); };
  await assert.rejects(h.load().createFamilyChild(input())); assert.equal(h.state.inserts.length, 0);
  const second = harness(); second.journal.removeItem = () => { throw new Error('unavailable'); };
  const id = await second.load().createFamilyChild(input());
  assert.equal(second.values.size, 1);
  assert.equal(await second.load().createFamilyChild(input()), id); assert.equal(second.state.inserts.length, 1);
});

test('concurrent same-family submissions are blocked before creating another UUID', async () => {
  const h = harness(); const service = h.load();
  const first = service.createFamilyChild(input());
  await assert.rejects(service.createFamilyChild(input()));
  await first; assert.equal(h.state.inserts.length, 1);
});
