const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadTypescript } = require('./load-typescript.cjs');

// Installed SDK, entirely synthetic credentials and a local fetch stub.
// No request reaches Supabase; no real session/key is read or printed.
function harness() {
  const state = { userId: 'user-a', requests: [], journal: new Map() };
  const supabase = createClient('https://memory-request.example.invalid', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const request = { url: new URL(url), method: init.method, headers: new Headers(init.headers), body: init.body };
      state.requests.push(request);
      let result;
      if (request.url.pathname.startsWith('/storage/v1/object/')) result = { Key: 'family-media/fixture' };
      else if (request.url.pathname === '/rest/v1/memories') result = [];
      else if (request.url.pathname === '/rest/v1/rpc/create_family_memory') result = JSON.parse(init.body).p_memory_id;
      else throw new Error('Unexpected mock endpoint');
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  supabase.auth.getSession = async () => ({ data: { session: {
    user: { id: state.userId }, access_token: 'fixture-token:' + state.userId,
  } }, error: null });
  let sequence = 0;
  const service = loadTypescript('src/lib/memory-service.ts', {
    './supabase': { supabase }, 'expo-crypto': { randomUUID: () => `fixture-${++sequence}` },
    './media-file': { readPickedMedia: async () => new ArrayBuffer(8) },
  }, { localStorage: {
    getItem: (key) => state.journal.get(key) ?? null,
    setItem: (key, value) => state.journal.set(key, value), removeItem: (key) => state.journal.delete(key),
  } });
  return { state, service };
}

const input = () => ({ userId: 'user-a', familyId: 'family-a', childIds: [],
  title: 'Fixture', body: '', eventDate: '2024-03-15',
  assets: [{ uri: 'file:///fixture.jpg', type: 'image', mimeType: 'image/jpeg' }] });

test('installed SDK serializes the checked actor on Storage, reconciliation and RPC requests', async () => {
  const h = harness(); await h.service.createFamilyMemory(input());
  assert.equal(h.state.requests.length, 3);
  for (const request of h.state.requests) assert.equal(request.headers.get('authorization'), 'Bearer fixture-token:user-a');
  const [upload, check, rpc] = h.state.requests;
  assert.equal(upload.method, 'POST'); assert.equal(upload.headers.get('content-type'), 'image/jpeg');
  assert.equal(upload.body.byteLength, 8); assert.equal(upload.headers.get('x-upsert'), 'false');
  assert.equal(check.url.searchParams.get('author_id'), 'eq.user-a');
  assert.equal(check.url.searchParams.get('family_id'), 'eq.family-a');
  assert.equal(JSON.parse(rpc.body).p_family_id, 'family-a'); assert.equal(h.state.journal.size, 0);
});

test('installed SDK never swaps a checked upload/RPC actor for a newly changed global session', async () => {
  for (const phase of ['uploading', 'saving']) {
    const h = harness(); const attempt = input();
    if (phase === 'saving') attempt.assets = [];
    attempt.onProgress = (progress) => { if (progress.phase === phase) h.state.userId = 'user-b'; };
    await assert.rejects(h.service.createFamilyMemory(attempt), (error) => phase === 'uploading' ? error.cleanupFailed : error.pending);
    const last = h.state.requests.at(-1);
    assert.ok(last.url.pathname.startsWith(phase === 'uploading' ? '/storage/v1/object/' : '/rest/v1/rpc/'));
    assert.equal(last.headers.get('authorization'), 'Bearer fixture-token:user-a');
    assert.ok(h.state.requests.every((request) => request.method !== 'DELETE'));
    assert.equal(h.state.journal.size, phase === 'uploading' ? 0 : 1);
  }
});
