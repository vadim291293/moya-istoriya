const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadTypescript } = require('./load-typescript.cjs');

const fixture = (n, values = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: null, body: 'Synthetic memory', event_date: '2024-03-01', memory_type: 'note',
  created_at: '2026-10-08T10:00:00.000123+00:00', author_id: 'test-author',
  memory_children: [], media_files: [], ...values,
});

// A small independent fixture evaluator, not PostgreSQL. It evaluates the
// actual URL produced by the installed SDK; real RLS/native QA is separate.
function terms(value) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') depth--;
    if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start)); return parts;
}
function matches(row, expression) {
  if (expression.startsWith('and(')) return terms(expression.slice(4, -1)).every((term) => matches(row, term));
  if (expression.startsWith('or(')) return terms(expression.slice(3, -1)).some((term) => matches(row, term));
  if (expression.endsWith('.not.is.null')) return row[expression.slice(0, -12)] != null;
  if (expression.endsWith('.is.null')) return row[expression.slice(0, -8)] == null;
  const [, key, op, literal] = /^([a-z_]+)\.(eq|gt|lt)\.(.+)$/.exec(expression) ?? [];
  assert.ok(key, `Unexpected synthetic filter: ${expression}`);
  return op === 'eq' ? row[key] === literal : op === 'gt' ? row[key] > literal : row[key] < literal;
}

test('diary is filtered before pagination; ordinary media does not displace text and achievements', async () => {
  const rows = Array.from({ length: 24 }, (_, i) => fixture(i + 1, { memory_type: 'photo', diary_category: null }));
  rows.push(fixture(50, { diary_category: 'skills', memory_type: 'mixed' }), fixture(51, { diary_category: 'words' }),
    fixture(52, { diary_category: null }), fixture(53, { diary_category: 'moments' }));
  const h = harness(rows), input = { familyId: 'family-a', diary: 'all', limit: 2 };
  const first = await h.service.getFamilyMemories(input);
  assert.deepEqual(Array.from(first.items, row => row.id), [fixture(53).id, fixture(52).id]);
  const next = await h.service.getFamilyMemories({ ...input, after: first.nextCursor });
  assert.deepEqual(Array.from(next.items, row => row.id), [fixture(51).id, fixture(50).id]);
  assert.match(h.requests[1].get('or'), /and\(or\(diary_category/);
  assert.equal(next.hasMore, false);
  await assert.rejects(h.service.getFamilyMemories({ ...input, diary: 'skills', after: first.nextCursor }));
});

test('warm moments include legacy text notes but no legacy media; sections never interpolate arbitrary filters', async () => {
  const h = harness([fixture(1, { diary_category: null }), fixture(2, { diary_category: 'moments' }),
    fixture(3, { diary_category: null, memory_type: 'mixed' }), fixture(4, { diary_category: 'words' })]);
  const page = await h.service.getFamilyMemories({ familyId: 'family-a', diary: 'moments' });
  assert.deepEqual(Array.from(page.items, row => row.id), [fixture(2).id, fixture(1).id]);
  await assert.rejects(h.service.getFamilyMemories({ familyId: 'family-a', diary: 'words),author_id.not.is.null' }));
});
function harness(initialRows) {
  const requests = [];
  let rows = initialRows;
  const supabase = createClient('https://pagination.example.invalid', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url) => {
      const query = new URL(url).searchParams; requests.push(query);
      let result = [...rows];
      if (query.has('or')) result = result.filter((row) => terms(query.get('or').slice(1, -1)).some((term) => matches(row, term)));
      const order = query.get('order').split(',').map((part) => part.split('.'));
      result.sort((a, b) => {
        for (const [column, direction] of order) {
          const comparison = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
          if (comparison) return direction === 'asc' ? comparison : -comparison;
        }
        return 0;
      });
      const start = Number(query.get('offset') ?? 0);
      result = result.slice(start, start + Number(query.get('limit')));
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const service = loadTypescript('src/lib/memory-service.ts', {
    './supabase': { supabase }, 'expo-crypto': {}, './media-file': {},
  });
  return { requests, service, replaceRows: (next) => { rows = next; } };
}

for (const orderBy of ['event', 'added']) for (const ascending of [false, true]) {
  test(`keyset ${orderBy}/${ascending ? 'ascending' : 'descending'} survives insert and deletion before its boundary`, async () => {
    const original = Array.from({ length: 7 }, (_, i) => fixture(i + 1));
    const h = harness(original);
    const input = { familyId: 'family-a', orderBy, ascending, limit: 2 };
    const first = await h.service.getFamilyMemories(input);
    const expected = ascending ? [...original] : [...original].reverse();
    assert.deepEqual(Array.from(first.items, (row) => row.id), expected.slice(0, 2).map((row) => row.id));
    const newRow = ascending ? fixture(0) : fixture(999);
    // The last displayed row is also deleted: its tuple, not its existence,
    // must be enough to continue at the next original row.
    h.replaceRows([...original.filter((row) => !first.items.some((item) => item.id === row.id)), newRow]);
    const continuation = first.nextCursor ? { after: first.nextCursor } : { offset: first.nextOffset };
    const second = await h.service.getFamilyMemories({ ...input, ...continuation });
    assert.deepEqual(Array.from(second.items, (row) => row.id), expected.slice(2, 4).map((row) => row.id));
    assert.equal(second.hasMore, true); assert.equal(h.requests[1].get('offset'), null);
  });
}

test('lookahead is not skipped, exact created_at microseconds survive, and the last page has no continuation', async () => {
  const h = harness([fixture(1), fixture(2), fixture(3)]);
  const input = { familyId: 'family-a', orderBy: 'event', ascending: true, limit: 2 };
  const first = await h.service.getFamilyMemories(input);
  assert.equal(first.nextCursor.id, fixture(2).id);
  assert.equal(first.nextCursor.createdAt, '2026-10-08T10:00:00.000123+00:00');
  const second = await h.service.getFamilyMemories({ ...input, after: first.nextCursor });
  assert.deepEqual(Array.from(second.items, (row) => row.id), [fixture(3).id]);
  assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
  assert.match(h.requests[1].get('or'), /created_at\.eq\.2026-10-08T10:00:00\.000123\+00:00/);
});

test('a cursor cannot be reused for another family, child, range, sort or direction', async () => {
  const h = harness([fixture(1), fixture(2), fixture(3)]);
  const input = { familyId: 'family-a', childId: 'child-a', orderBy: 'event', ascending: true, limit: 2,
    dateRange: { fromInclusive: '2024-03-01', toExclusive: '2024-04-01' } };
  const first = await h.service.getFamilyMemories(input);
  const before = h.requests.length;
  for (const changed of [{ familyId: 'family-b' }, { childId: 'child-b' }, { childId: undefined },
    { orderBy: 'added' }, { ascending: false }, { dateRange: undefined },
    { dateRange: { fromInclusive: '2024-02-01', toExclusive: '2024-04-01' } }]) {
    await assert.rejects(h.service.getFamilyMemories({ ...input, ...changed, after: first.nextCursor }));
  }
  assert.equal(h.requests.length, before);
});

test('malformed cursor values never reach the raw PostgREST filter', async () => {
  const h = harness([fixture(1), fixture(2), fixture(3)]);
  const input = { familyId: 'family-a', ascending: true, limit: 2 };
  const first = await h.service.getFamilyMemories(input);
  const before = h.requests.length;
  for (const changed of [null, {}, { version: 99 }, { id: 'x),family_id.neq.x' },
    { eventDate: '2024-02-30' }, { eventDate: '2024-3-1' }, { createdAt: '2026-10-08' },
    { createdAt: '2026-10-08T24:00:00+00:00' }, { createdAt: '2026-10-08T10:00:00Z),id.neq.x' },
    { scope: 'another-scope' }]) {
    const after = changed === null ? 'not-a-cursor' : Object.keys(changed).length ? { ...first.nextCursor, ...changed } : {};
    await assert.rejects(h.service.getFamilyMemories({ ...input, after }));
  }
  assert.equal(h.requests.length, before);
});

for (const orderBy of ['event', 'added']) for (const ascending of [false, true]) {
  test(`all three tuple keys participate in ${orderBy}/${ascending ? 'ascending' : 'descending'} ordering`, async () => {
    const rows = [
      fixture(1, { event_date: '2024-03-02', created_at: '2026-10-08T10:00:00.000123+00:00' }),
      fixture(2, { event_date: '2024-03-01', created_at: '2026-10-08T10:00:00.000123+00:00' }),
      fixture(3, { event_date: '2024-03-01', created_at: '2026-10-08T10:00:00.000124+00:00' }),
      fixture(4, { event_date: '2024-03-01', created_at: '2026-10-08T10:00:00.000124+00:00' }),
      fixture(5, { event_date: '2024-02-29', created_at: '2026-10-09T10:00:00.000000+00:00' }),
    ];
    const h = harness(rows), input = { familyId: 'family-a', orderBy, ascending, limit: 1 };
    const ascendingIds = orderBy === 'event' ? [5, 2, 3, 4, 1] : [2, 1, 3, 4, 5];
    const expected = (ascending ? ascendingIds : ascendingIds.reverse()).map((n) => fixture(n).id);
    const actual = []; let after = null;
    do {
      const page = await h.service.getFamilyMemories({ ...input, after });
      actual.push(...Array.from(page.items, (row) => row.id)); after = page.nextCursor;
      assert.ok(actual.length <= rows.length, 'continuation must progress, not repeat a page');
    } while (after);
    assert.deepEqual(actual, expected);
  });
}

test('the cursor is based on the last memory even if it has no media', async () => {
  const h = harness([fixture(1), fixture(2), fixture(3)]);
  const page = await h.service.getFamilyMemories({ familyId: 'family-a', ascending: true, limit: 2 });
  assert.equal(page.items[1].media.length, 0); assert.equal(page.nextCursor.id, page.items[1].id);
});

test('empty and exact-size final pages have no false continuation', async () => {
  for (const rows of [[], [fixture(1), fixture(2)]]) {
    const h = harness(rows);
    const page = await h.service.getFamilyMemories({ familyId: 'family-a', limit: 2 });
    assert.equal(page.items.length, rows.length); assert.equal(page.hasMore, false); assert.equal(page.nextCursor, null);
  }
});

test('page size can change without losing the boundary', async () => {
  const h = harness([fixture(1), fixture(2), fixture(3), fixture(4)]);
  const input = { familyId: 'family-a', ascending: true };
  const first = await h.service.getFamilyMemories({ ...input, limit: 1 });
  const next = await h.service.getFamilyMemories({ ...input, limit: 2, after: first.nextCursor });
  assert.deepEqual(Array.from(next.items, (row) => row.id), [fixture(2).id, fixture(3).id]);
});
