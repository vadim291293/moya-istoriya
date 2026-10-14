const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const session = (id) => ({ user: { id }, access_token: `synthetic-${id}` });
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const response = (value) => ({ data: { session: value }, error: null });

function provider(initial = null) {
  const state = { sdkSession: initial, sessionQueue: [], queries: [], signOuts: [], listeners: [],
    query: null, logout: null, subscriptions: 0, unsubscriptions: 0 };
  const client = {
    auth: {
      onAuthStateChange(callback) {
        state.subscriptions++;
        const listener = { callback, active: true }; state.listeners.push(listener);
        return { data: { subscription: { unsubscribe() { listener.active = false; state.unsubscriptions++; } } } };
      },
      getSession: () => state.sessionQueue.shift() ?? Promise.resolve(response(state.sdkSession)),
      signOut: async (options) => {
        state.signOuts.push(options);
        if (state.logout) return state.logout();
        emit('SIGNED_OUT', null); return { error: null };
      },
    },
    from(table) {
      const query = { table, filters: {}, orders: [], selection: null };
      const builder = {
        select(value) { query.selection = value; return builder; },
        eq(key, value) { query.filters[key] = value; return builder; },
        in(key, value) { query.filters[key] = value; return builder; },
        order(key, options) { query.orders.push({ key, ...options }); return builder; },
        then(resolve, reject) {
          state.queries.push(query);
          const fallback = table === 'family_members'
            ? [{ family_id: `family-${query.filters.user_id}`, role: 'owner', created_at: '2024-01-01' }]
            : table === 'families'
              ? query.filters.id.map((id) => ({ id, name: id }))
              : [{ id: `child-${query.filters.family_id}`, name: 'Child', birth_date: '2024-01-01', photo: null }];
          return Promise.resolve(state.query?.(query) ?? { data: fallback, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const screen = screenHarness('src/lib/auth-context.tsx', { './supabase': { supabase: client } }, 'AuthProvider');
  const render = () => screen.render({ children: null }).props.value;
  function emit(event, nextSession) {
    state.sdkSession = nextSession;
    for (const listener of state.listeners) if (listener.active) listener.callback(event, nextSession);
  }
  async function settle() { await flush(); render(); await flush(); return render(); }
  return { state, screen, emit, render, settle };
}

test('provider restores session, reads only own memberships, then family and its children', async () => {
  const h = provider(session('a')); h.render(); const value = await h.settle();
  assert.equal(value.session.user.id, 'a'); assert.equal(value.isInitializing, false);
  assert.equal(value.family.status, 'ready'); assert.equal(value.family.family.id, 'family-a');
  assert.deepEqual(h.state.queries.map((item) => item.table), ['family_members', 'families', 'children']);
  assert.equal(h.state.queries[0].filters.user_id, 'a');
  assert.equal(h.state.queries[2].filters.family_id, 'family-a');
  assert.equal(h.state.subscriptions, 1);
});

test('new auth event wins over a late initial getSession response', async () => {
  const h = provider(); const initial = deferred(); h.state.sessionQueue.push(initial.promise); h.render();
  h.emit('SIGNED_IN', session('b')); h.render(); await h.settle();
  initial.resolve(response(session('a'))); await flush();
  assert.equal(h.render().session.user.id, 'b'); assert.equal(h.render().family.family.id, 'family-b');
});

test('manual session retry wins over a late initial restoration without requiring an auth event', async () => {
  const h = provider(); const initial = deferred(); h.state.sessionQueue.push(initial.promise);
  const first = h.render(); h.state.sessionQueue.push(Promise.resolve(response(session('b'))));
  await first.retrySession(); await h.settle();
  initial.resolve(response(session('a'))); await flush();
  assert.equal(h.render().session.user.id, 'b');
});

test('newer retry invalidates an earlier retry even before the newer response arrives', async () => {
  const h = provider(session('a')); h.render(); const value = await h.settle();
  const old = deferred(), latest = deferred(); h.state.sessionQueue.push(old.promise, latest.promise);
  const p1 = value.retrySession(), p2 = value.retrySession();
  old.resolve(response(session('old'))); await p1;
  assert.equal(h.render().session.user.id, 'a'); assert.equal(h.render().isInitializing, true);
  latest.resolve(response(session('b'))); await p2;
  assert.equal(h.render().session.user.id, 'b');
});

test('old account refresh callback cannot issue reads or reset the new account family', async () => {
  const h = provider(session('a')); h.render(); const old = await h.settle();
  const count = h.state.queries.length; h.emit('SIGNED_IN', session('b'));
  await old.refreshFamily(); assert.equal(h.state.queries.length, count);
  assert.equal((await h.settle()).family.family.id, 'family-b');
});

test('stale guest refresh never sets idle after sign-in has already been accepted', async () => {
  const h = provider(); h.render(); const guest = await h.settle();
  h.emit('SIGNED_IN', session('a')); await guest.refreshFamily();
  assert.equal(h.render().family.status, 'loading');
  assert.equal((await h.settle()).family.family.id, 'family-a');
});

test('old family query completion cannot replace a newer account result', async () => {
  for (const table of ['family_members', 'families', 'children']) {
    const h = provider(session('a')); const old = deferred();
    h.state.query = (query) => {
      const belongsToA = query.filters.user_id === 'a' || query.filters.id?.includes('family-a') || query.filters.family_id === 'family-a';
      if (query.table === table && belongsToA) return old.promise;
    };
    h.render(); await h.settle(); h.emit('SIGNED_IN', session('b')); const ready = await h.settle();
    assert.equal(ready.family.family.id, 'family-b');
    old.resolve({ data: table === 'family_members' ? [{ family_id: 'family-a', role: 'owner' }]
      : table === 'families' ? [{ id: 'family-a', name: 'Old private family' }] : [{ id: 'child-a' }], error: null });
    await flush(); assert.equal(h.render().family.family.id, 'family-b');
  }
});

test('unreadable memberships/family/children is an error, not the no-family setup branch', async () => {
  for (const table of ['family_members', 'families', 'children']) {
    const h = provider(session('a'));
    h.state.query = (query) => query.table === table ? { data: null, error: { code: '42501', message: 'permission denied' } } : undefined;
    h.render(); const value = await h.settle();
    assert.equal(value.family.status, 'error'); assert.match(value.family.message, /доступы|разрешено/);
  }
  const missing = provider(session('a'));
  missing.state.query = (query) => query.table === 'families' ? { data: [], error: null } : undefined;
  missing.render(); assert.equal((await missing.settle()).family.status, 'error');
});

test('no memberships opens setup; multiple memberships require a validated family choice', async () => {
  const empty = provider(session('a'));
  empty.state.query = (query) => query.table === 'family_members' ? { data: [], error: null } : undefined;
  empty.render(); assert.equal((await empty.settle()).family.status, 'none');
  const h = provider(session('a'));
  h.state.query = (query) => query.table === 'family_members' ? { data: [
    { family_id: 'one', role: 'owner' }, { family_id: 'two', role: 'member' }], error: null } : undefined;
  h.render(); const choices = await h.settle(); assert.equal(choices.family.status, 'multiple');
  const count = h.state.queries.length; await choices.selectFamily('foreign'); assert.equal(h.state.queries.length, count);
  await choices.selectFamily('two'); assert.equal(h.render().family.family.id, 'two');
});

test('stale family picker callback cannot choose an old account family after a new sign-in', async () => {
  const h = provider(session('a'));
  h.state.query = (query) => query.table === 'family_members' && query.filters.user_id === 'a' ? { data: [
    { family_id: 'one', role: 'owner' }, { family_id: 'two', role: 'member' }], error: null } : undefined;
  h.render(); const choices = await h.settle(); const count = h.state.queries.length;
  h.emit('SIGNED_IN', session('b')); await choices.selectFamily('one');
  assert.equal(h.state.queries.length, count); assert.equal((await h.settle()).family.family.id, 'family-b');
});

test('old logout callback cannot sign out a newer account', async () => {
  const h = provider(session('a')); h.render(); const old = await h.settle();
  h.emit('SIGNED_IN', session('b')); await old.signOut();
  assert.equal(h.state.signOuts.length, 0); assert.equal(h.render().session.user.id, 'b');
});

test('logout rechecks account after async preflight, before calling the SDK mutation', async () => {
  const h = provider(session('a')); h.render(); const value = await h.settle();
  const preflight = deferred(); h.state.sessionQueue.push(preflight.promise);
  const attempt = value.signOut(); h.emit('SIGNED_IN', session('b'));
  preflight.resolve(response(session('a'))); assert.match(await attempt, /изменился/);
  assert.equal(h.state.signOuts.length, 0); assert.equal(h.render().session.user.id, 'b');
});

test('failed logout preflight keeps the session and allows another attempt', async () => {
  const h = provider(session('a')); h.render(); const value = await h.settle();
  h.state.sessionQueue.push(Promise.resolve({ data: { session: null }, error: new Error('offline') }));
  assert.match(await value.signOut(), /проверить вход/);
  assert.equal(h.state.signOuts.length, 0); assert.equal(h.render().session.user.id, 'a');
  assert.equal(await value.signOut(), null); assert.equal(h.state.signOuts.length, 1);
  assert.equal(h.render().session, null);
});

test('concurrent logout is single-flight; local logout clears session and recovery state', async () => {
  const h = provider(session('a')); h.render(); const value = await h.settle();
  const logout = deferred(); h.state.logout = () => logout.promise;
  const p1 = value.signOut(), p2 = value.signOut(); await flush();
  assert.equal(h.state.signOuts.length, 1);
  h.emit('PASSWORD_RECOVERY', session('a')); h.render();
  h.emit('SIGNED_OUT', null); logout.resolve({ error: null }); await Promise.all([p1, p2]);
  const guest = h.render(); assert.equal(guest.session, null); assert.equal(guest.isPasswordRecovery, false);
  assert.equal(guest.family.status, 'idle'); assert.equal(h.state.signOuts[0].scope, 'local');
});

test('unmounted provider ignores queued auth callbacks, retry results and stale methods', async () => {
  const h = provider(session('a')); h.render(); const value = await h.settle();
  const retry = deferred(); h.state.sessionQueue.push(retry.promise); const attempt = value.retrySession();
  h.screen.unmount(); const writes = h.screen.stateWrites, reads = h.state.queries.length;
  h.state.listeners[0].callback('SIGNED_IN', session('b'));
  retry.resolve(response(session('a'))); await attempt; await value.refreshFamily(); await value.signOut();
  assert.equal(h.screen.stateWrites, writes); assert.equal(h.state.queries.length, reads);
  assert.equal(h.state.signOuts.length, 0); assert.equal(h.state.unsubscriptions, 1);
});

test('token refresh for the same user preserves ready family and does not reread membership', async () => {
  const h = provider(session('a')); h.render(); await h.settle(); const reads = h.state.queries.length;
  h.emit('TOKEN_REFRESHED', { ...session('a'), access_token: 'synthetic-new-token' }); await h.settle();
  assert.equal(h.render().family.status, 'ready'); assert.equal(h.state.queries.length, reads);
});

test('newer family refresh wins over an older response/error for the same account', async () => {
  const h = provider(session('a')); const old = deferred(); let membershipCalls = 0;
  h.state.query = (query) => {
    if (query.table === 'family_members' && ++membershipCalls === 1) return old.promise;
  };
  h.render(); const loading = await h.settle(); assert.equal(loading.family.status, 'loading');
  await loading.refreshFamily(); assert.equal(h.render().family.status, 'ready');
  old.resolve({ data: null, error: { code: '42501' } }); await flush();
  assert.equal(h.render().family.status, 'ready');
});

test('rapid valid family choices use latest request and ignore an old child response', async () => {
  const h = provider(session('a')); const oldChildren = deferred();
  h.state.query = (query) => {
    if (query.table === 'family_members') return { data: [
      { family_id: 'one', role: 'owner' }, { family_id: 'two', role: 'member' }], error: null };
    if (query.table === 'children' && query.filters.family_id === 'one') return oldChildren.promise;
  };
  h.render(); const choices = await h.settle();
  const oldChoice = choices.selectFamily('one'); await flush();
  await choices.selectFamily('two'); assert.equal(h.render().family.family.id, 'two');
  oldChildren.resolve({ data: [{ id: 'old-child', name: 'Old' }], error: null }); await oldChoice;
  assert.equal(h.render().family.family.id, 'two');
  assert.equal(h.render().family.children[0].id, 'child-two');
});
