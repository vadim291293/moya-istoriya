const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadTypescript } = require('./load-typescript.cjs');

function harness() {
  const requests = [];
  const supabase = createClient('https://book-query.example.invalid', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url) => {
      requests.push(new URL(url));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const service = loadTypescript('src/lib/memory-service.ts', {
    './supabase': { supabase }, 'expo-crypto': {}, './media-file': {},
  });
  return { requests, service };
}

test('real Supabase query builder sends child/family filters and inclusive/exclusive chapter bounds to server', async () => {
  const h = harness();
  await h.service.getFamilyMemories({ familyId: 'family-a', childId: 'child-a',
    dateRange: { fromInclusive: '2024-02-29', toExclusive: '2024-03-31' }, ascending: true, limit: 10 });
  assert.equal(h.requests.length, 1);
  const query = h.requests[0].searchParams;
  assert.equal(query.get('family_id'), 'eq.family-a');
  assert.equal(query.get('memory_children.child_id'), 'eq.child-a');
  assert.ok(query.get('select').includes('memory_children!inner(child_id)'));
  assert.deepEqual(query.getAll('event_date'), ['gte.2024-02-29', 'lt.2024-03-31']);
  assert.equal(query.get('order'), 'event_date.asc,created_at.asc,id.asc');
  assert.equal(query.get('media_files.order'), 'created_at.asc,id.asc');
  assert.equal(query.get('offset'), null); assert.equal(query.get('limit'), '11');
});

test('family activity orders newly added old memories first; before-birth chapter has no invented lower bound', async () => {
  const h = harness();
  await h.service.getFamilyMemories({ familyId: 'family-a', limit: 3 });
  const family = h.requests[0].searchParams;
  assert.equal(family.get('order'), 'created_at.desc,event_date.desc,id.desc');
  assert.equal(family.get('event_date'), null);
  assert.equal(family.get('memory_children.child_id'), null);
  assert.equal(family.get('limit'), '4');
  await h.service.getFamilyMemories({ familyId: 'family-a', childId: 'child-a',
    dateRange: { toExclusive: '2024-01-01' }, ascending: true });
  assert.deepEqual(h.requests[1].searchParams.getAll('event_date'), ['lt.2024-01-01']);
});

test('invalid chapter dates and invalid pagination fail before any API request', async () => {
  const h = harness();
  for (const options of [
    { dateRange: { fromInclusive: '2024-02-30' } },
    { dateRange: { toExclusive: '2024-2-3' } },
    { dateRange: { fromInclusive: '2024-03-01', toExclusive: '2024-02-01' } },
    { dateRange: { fromInclusive: '2024-03-01', toExclusive: '2024-03-01' } },
    { after: {} }, { after: 'invalid' }, { limit: 0 }, { limit: 1000 },
  ]) await assert.rejects(h.service.getFamilyMemories({ familyId: 'family-a', ...options }));
  assert.equal(h.requests.length, 0);
});

test('family gallery uses event dates and calendar filters on the real server query before pagination', async () => {
  const h = harness();
  await h.service.getFamilyMemories({ familyId: 'family-a', orderBy: 'event',
    dateRange: { fromInclusive: '2024-12-01', toExclusive: '2025-01-01' }, limit: 10 });
  const query = h.requests[0].searchParams;
  assert.equal(query.get('order'), 'event_date.desc,created_at.desc,id.desc');
  assert.deepEqual(query.getAll('event_date'), ['gte.2024-12-01', 'lt.2025-01-01']);
  assert.equal(query.get('offset'), null); assert.equal(query.get('limit'), '11');
  assert.equal(query.get('memory_children.child_id'), null);
});
