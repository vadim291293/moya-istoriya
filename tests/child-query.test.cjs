const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadTypescript } = require('./load-typescript.cjs');

test('installed Supabase builder filters membership/child and POSTs only confirmed child columns', async () => {
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const familyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const childId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const requests = [];
  const values = new Map();
  const supabase = createClient('https://child-query.example.invalid', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const request = { url: new URL(url), method: init.method, headers: new Headers(init.headers),
        body: init.body ? JSON.parse(init.body) : null };
      requests.push(request);
      let payload = [];
      if (request.url.pathname.endsWith('/family_members')) payload = [{ family_id: familyId }];
      if (request.method === 'POST') {
        assert.equal(values.size, 1, 'persist journal before POST');
        payload = request.body;
      }
      return new Response(JSON.stringify(payload), { status: request.method === 'POST' ? 201 : 200,
        headers: { 'Content-Type': 'application/json' } });
    } },
  });
  // Only session acquisition is stubbed; query construction/serialization use SDK.
  supabase.auth.getSession = async () => ({ data: { session: { user: { id: userId } } }, error: null });
  const service = loadTypescript('src/lib/child-service.ts', {
    './supabase': { supabase }, 'expo-crypto': { randomUUID: () => childId },
  }, { localStorage: { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } });
  assert.equal(await service.createFamilyChild({ userId, familyId, name: ' Маша ', birthDate: '2024-01-31' }), childId);
  const memberships = requests.filter((request) => request.url.pathname.endsWith('/family_members'));
  assert.equal(memberships.length, 2);
  for (const request of memberships) {
    assert.equal(request.url.searchParams.get('user_id'), `eq.${userId}`);
    assert.equal(request.url.searchParams.get('family_id'), `eq.${familyId}`);
  }
  const read = requests.find((request) => request.url.pathname.endsWith('/children') && request.method === 'GET');
  assert.equal(read.url.searchParams.get('id'), `eq.${childId}`);
  assert.equal(read.url.searchParams.get('family_id'), `eq.${familyId}`);
  const writes = requests.filter((request) => request.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url.pathname, '/rest/v1/children');
  assert.equal(writes[0].url.searchParams.get('select'), 'id,family_id,name,birth_date');
  assert.deepEqual(writes[0].body, { id: childId, family_id: familyId, name: 'Маша', birth_date: '2024-01-31' });
  assert.ok(writes[0].headers.get('prefer').includes('return=representation'));
  assert.ok(!writes[0].headers.get('prefer').includes('resolution='), 'no upsert');
  assert.equal(values.size, 0);
});
