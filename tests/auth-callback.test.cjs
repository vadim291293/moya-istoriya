const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { screenHarness } = require('./ui-harness.cjs');
const { readAuthCallback, redeemAuthCallback, createAuthTaskQueue } = loadTypescript('src/lib/auth-callback.ts');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const sessionResult = (id = 'account-a') => ({ data: { user: { id }, session: { user: { id } } }, error: null });
const recoveryUrl = 'moyaistoriya://auth/reset-password#access_token=test-access&refresh_token=test-refresh&type=recovery';

function mockAuth(overrides = {}) {
  const listeners = new Set();
  const auth = {
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    emit(event, session) { for (const callback of listeners) callback(event, session); },
    listenerCount: () => listeners.size,
    setSession: async () => sessionResult(),
    exchangeCodeForSession: async () => sessionResult(),
    verifyOtp: async () => sessionResult(),
    getSession: async () => sessionResult(),
    updateUser: async () => ({ data: { user: { id: 'account-a' } }, error: null }),
    ...overrides,
  };
  return auth;
}

function callbackHarness(auth, initialUrl = recoveryUrl, initialOverride) {
  let url = initialUrl;
  const calls = { begin: 0, finish: 0, routes: [], signOut: 0 };
  const context = {
    beginPasswordRecovery: () => { calls.begin++; },
    finishPasswordRecovery: () => { calls.finish++; },
    signOut: async () => { calls.signOut++; auth.emit('SIGNED_OUT', null); return null; },
  };
  const screen = screenHarness('src/app/auth/reset-password.tsx', {
    'expo-router': { useRouter: () => ({ replace: (path) => calls.routes.push(path) }) },
    'expo-linking': { useURL: () => url, getInitialURL: initialOverride ?? (async () => initialUrl) },
    '../../lib/auth-context': { useAuth: () => context },
    '../../lib/supabase': { supabase: { auth } },
    '../../components/auth-screen': { AuthScreen: 'AuthScreen', authStyles: {} },
  });
  return { screen, calls, context, setUrl: (value) => { url = value; },
    view: () => screen.find((node) => node.type === 'AuthScreen').props };
}

test('callback supports query/hash credentials, rejects errors and incomplete tokens without leaking secrets', () => {
  assert.equal(readAuthCallback(recoveryUrl).kind, 'tokens');
  assert.equal(readAuthCallback('exp://192.168.0.103:8081/--/auth/reset-password?code=test-code').kind, 'code');
  assert.equal(readAuthCallback('moyaistoriya://auth/reset-password?token_hash=test-hash&type=signup').kind, 'hash');
  assert.equal(readAuthCallback('moyaistoriya://auth/reset-password?token=test-otp&email=test%40example.com&type=recovery').kind, 'otp');
  for (const url of ['not-a-url', 'moyaistoriya://auth/reset-password',
    'moyaistoriya://auth/reset-password#access_token=private-value',
    'moyaistoriya://auth/reset-password?token_hash=private-value&type=phone_change',
    'moyaistoriya://auth/reset-password?code=private-value&error=access_denied']) {
    assert.throws(() => readAuthCallback(url), (error) => !error.message.includes('private-value'));
  }
});

test('PKCE passes exact native flow ID and distinguishes recovery event from ordinary confirmation', async () => {
  const requests = [];
  const flowId = '0123456789abcdef0123456789abcdef';
  const auth = mockAuth({ exchangeCodeForSession: async (...args) => {
    requests.push(args); auth.emit('PASSWORD_RECOVERY', sessionResult().data.session); return sessionResult();
  } });
  const result = await redeemAuthCallback(auth, readAuthCallback(`moyaistoriya://auth/reset-password?code=test-code&sb_flow_id=${flowId}`));
  assert.equal(requests[0][1].flowId, flowId);
  assert.equal(result.recovery, true);
  assert.equal(result.userId, 'account-a');
  assert.equal(auth.listenerCount(), 0);
  const ordinary = await redeemAuthCallback(mockAuth(), readAuthCallback('moyaistoriya://auth/reset-password?code=test-code'));
  assert.equal(ordinary.recovery, false);
  assert.equal(readAuthCallback('moyaistoriya://auth/reset-password?code=test-code&sb_flow_id=').flowId, '');
});

test('OTP/hash calls use correct SDK arguments and missing session/failure unsubscribes observer', async () => {
  const requests = [];
  const auth = mockAuth({ verifyOtp: async (args) => { requests.push(args); return sessionResult(); } });
  await redeemAuthCallback(auth, readAuthCallback('moyaistoriya://auth/reset-password?token_hash=test-hash&type=signup'));
  await redeemAuthCallback(auth, readAuthCallback('moyaistoriya://auth/reset-password?token=test-otp&email=test%40example.com&type=recovery'));
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ token_hash: 'test-hash', type: 'signup' }, { token: 'test-otp', email: 'test@example.com', type: 'recovery' }]);
  const failed = mockAuth({ setSession: async () => ({ data: { session: null, user: null }, error: { code: 'otp_expired' } }) });
  await assert.rejects(redeemAuthCallback(failed, readAuthCallback(recoveryUrl)));
  assert.equal(failed.listenerCount(), 0);
  const missing = mockAuth({ setSession: async () => ({ data: { session: null, user: null }, error: null }) });
  await assert.rejects(redeemAuthCallback(missing, readAuthCallback(recoveryUrl)));
});

test('serialized auth queue continues after rejection without concurrent mutation', async () => {
  const enqueue = createAuthTaskQueue();
  let release;
  const order = [];
  const first = enqueue(async () => { order.push('first'); await new Promise((resolve) => { release = resolve; }); throw new Error('test failure'); });
  const rejection = assert.rejects(first);
  const second = enqueue(async () => { order.push('second'); });
  await settle(); assert.deepEqual(order, ['first']);
  release(); await rejection; await second;
  assert.deepEqual(order, ['first', 'second']);
});

test('signup link never opens a password form; duplicate delivery never consumes it twice', async () => {
  let count = 0;
  const auth = mockAuth({ verifyOtp: async () => { count++; return sessionResult(); } });
  const h = callbackHarness(auth, 'moyaistoriya://auth/reset-password?token_hash=test-hash&type=signup');
  h.screen.render(); await settle(); h.screen.render(); await settle(); h.screen.render();
  assert.equal(h.view().title, 'Почта подтверждена');
  assert.equal(count, 1); assert.equal(h.calls.begin, 0);
  h.screen.button('Продолжить').onPress(); assert.deepEqual(h.calls.routes, ['/']);
});

test('a newer callback waits for old exchange and cannot be overwritten by its late failure', async () => {
  let release;
  const requests = [];
  const auth = mockAuth({ exchangeCodeForSession: (code) => {
    requests.push(code);
    return code === 'old' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(sessionResult());
  } });
  const h = callbackHarness(auth, 'moyaistoriya://auth/reset-password?code=old');
  h.screen.render(); await settle();
  h.setUrl('moyaistoriya://auth/reset-password?code=new&type=recovery'); h.screen.render(); await settle();
  assert.deepEqual(requests, ['old']);
  release({ data: { session: null, user: null }, error: { code: 'otp_expired' } });
  await settle(); h.screen.render();
  assert.deepEqual(requests, ['old', 'new']);
  assert.match(h.view().subtitle, /Задайте новый пароль/);
  assert.equal(h.screen.field('Новый пароль').editable, true);
});

test('recovery save is single-flight, disables edits and cancel, and clears password after success', async () => {
  let release;
  let count = 0;
  const auth = mockAuth({ updateUser: () => { count++; return new Promise((resolve) => { release = resolve; }); } });
  const h = callbackHarness(auth);
  h.screen.render(); await settle(); h.screen.render();
  h.screen.field('Новый пароль').onChangeText('new-password'); h.screen.field('Повторите пароль').onChangeText('new-password'); h.screen.render();
  h.screen.button('Сохранить пароль').onPress(); h.screen.field('Повторите пароль').onSubmitEditing(); h.screen.button('Отменить и выйти').onPress();
  await settle(); h.screen.render();
  assert.equal(count, 1); assert.equal(h.calls.signOut, 0);
  assert.equal(h.screen.field('Новый пароль').editable, false);
  assert.equal(h.screen.button('Отменить и выйти').disabled, true);
  release({ data: { user: { id: 'account-a' } }, error: null }); await settle(); h.screen.render();
  assert.equal(h.view().title, 'Всё готово');
  const login = h.screen.button('Войти с новым паролем').onPress;
  login(); login(); await settle();
  assert.equal(h.calls.signOut, 1); assert.deepEqual(h.calls.routes, ['/login']);
});

test('recovery refuses password update for a different account or mismatched new password', async () => {
  let count = 0;
  const auth = mockAuth({ getSession: async () => sessionResult('account-b'), updateUser: async () => { count++; return sessionResult(); } });
  const h = callbackHarness(auth);
  h.screen.render(); await settle(); h.screen.render();
  h.screen.field('Новый пароль').onChangeText('new-password'); h.screen.field('Повторите пароль').onChangeText('mistyped-password'); h.screen.render();
  h.screen.button('Сохранить пароль').onPress(); h.screen.render();
  assert.match(h.view().subtitle, /не совпадают/); assert.equal(count, 0);
  h.screen.field('Повторите пароль').onChangeText('new-password'); h.screen.render();
  h.screen.button('Сохранить пароль').onPress(); await settle(); h.screen.render();
  assert.equal(count, 0); assert.match(h.view().subtitle, /аккаунт изменился/);
});

test('new recovery waits for an in-flight password update without displaying the old success', async () => {
  let release;
  let exchanges = 0;
  const auth = mockAuth({ updateUser: () => new Promise((resolve) => { release = resolve; }),
    exchangeCodeForSession: async () => { exchanges++; return sessionResult('account-b'); } });
  const h = callbackHarness(auth);
  h.screen.render(); await settle(); h.screen.render();
  h.screen.field('Новый пароль').onChangeText('new-password'); h.screen.field('Повторите пароль').onChangeText('new-password'); h.screen.render();
  h.screen.button('Сохранить пароль').onPress(); await settle();
  h.setUrl('moyaistoriya://auth/reset-password?code=new&type=recovery'); h.screen.render(); await settle();
  assert.equal(exchanges, 0);
  release({ data: { user: { id: 'account-a' } }, error: null }); await settle(); h.screen.render();
  assert.equal(exchanges, 1); assert.match(h.view().subtitle, /Задайте новый пароль/);
  assert.equal(h.screen.field('Новый пароль').value, '');
  assert.deepEqual(h.calls.routes, []);
});

test('successful cancel signs out; late cancel cannot navigate away from a newer link', async () => {
  const normal = callbackHarness(mockAuth());
  normal.screen.render(); await settle(); normal.screen.render();
  normal.screen.button('Отменить и выйти').onPress(); await settle();
  assert.equal(normal.calls.signOut, 1); assert.deepEqual(normal.calls.routes, ['/login']);
  let release;
  const h = callbackHarness(mockAuth());
  h.context.signOut = () => new Promise((resolve) => { release = resolve; });
  h.screen.render(); await settle(); h.screen.render();
  h.screen.button('Отменить и выйти').onPress(); await settle();
  h.setUrl('moyaistoriya://auth/reset-password?code=new&type=recovery'); h.screen.render();
  release(null); await settle(); h.screen.render();
  assert.deepEqual(h.calls.routes, []); assert.match(h.view().subtitle, /Задайте новый пароль/);
});

test('recovery is invalidated synchronously on logout even before React rerender', async () => {
  let count = 0;
  const auth = mockAuth({ updateUser: async () => { count++; return sessionResult(); } });
  const h = callbackHarness(auth);
  h.screen.render(); await settle(); h.screen.render();
  h.screen.field('Новый пароль').onChangeText('new-password'); h.screen.field('Повторите пароль').onChangeText('new-password'); h.screen.render();
  auth.emit('SIGNED_OUT', null);
  h.screen.button('Сохранить пароль').onPress(); await settle(); h.screen.render();
  assert.equal(count, 0); assert.match(h.view().subtitle, /Аккаунт изменился/);
});

test('no initial URL shows an error; late results after unmount do not finish another recovery', async () => {
  const absent = callbackHarness(mockAuth(), null);
  absent.screen.render(); await settle(); absent.screen.render();
  assert.match(absent.view().subtitle, /Ссылка не найдена/);
  let release;
  const auth = mockAuth({ setSession: () => new Promise((resolve) => { release = resolve; }) });
  const h = callbackHarness(auth);
  h.screen.render(); await settle(); const finishCount = h.calls.finish;
  h.screen.unmount(); release(sessionResult()); await settle();
  assert.equal(h.calls.finish, finishCount); assert.equal(auth.listenerCount(), 0);
});

test('an old confirmation button cannot exit a newer recovery form', async () => {
  const h = callbackHarness(mockAuth(), 'moyaistoriya://auth/reset-password?token_hash=old&type=signup');
  h.screen.render(); await settle(); h.screen.render();
  const oldContinue = h.screen.button('Продолжить').onPress;
  h.setUrl(recoveryUrl); h.screen.render(); await settle(); h.screen.render();
  const finishCount = h.calls.finish;
  oldContinue();
  assert.deepEqual(h.calls.routes, []);
  assert.equal(h.calls.finish, finishCount);
  assert.match(h.view().subtitle, /Задайте новый пароль/);
});

test('old form handlers cannot supply a password to another recovered account', async () => {
  let updates = 0;
  const auth = mockAuth({ exchangeCodeForSession: async () => sessionResult('account-b'),
    getSession: async () => sessionResult('account-b'), updateUser: async () => { updates++; return sessionResult('account-b'); } });
  const h = callbackHarness(auth);
  h.screen.render(); await settle(); h.screen.render();
  const oldInput = h.screen.field('Новый пароль').onChangeText;
  h.screen.field('Новый пароль').onChangeText('account-a-password');
  h.screen.field('Повторите пароль').onChangeText('account-a-password'); h.screen.render();
  const oldSave = h.screen.button('Сохранить пароль').onPress;
  h.setUrl('moyaistoriya://auth/reset-password?code=account-b&type=recovery'); h.screen.render(); await settle(); h.screen.render();
  oldInput('account-a-password'); oldSave(); await settle(); h.screen.render();
  assert.equal(updates, 0);
  assert.equal(h.screen.field('Новый пароль').value, '');
  assert.deepEqual(h.calls.routes, []);
});

test('another sign-in during cancellation prevents the old recovery redirect', async () => {
  let release;
  const auth = mockAuth();
  const h = callbackHarness(auth);
  h.context.signOut = () => new Promise((resolve) => { release = resolve; });
  h.screen.render(); await settle(); h.screen.render();
  h.screen.button('Отменить и выйти').onPress(); await settle();
  auth.emit('SIGNED_IN', sessionResult('account-b').data.session);
  release(null); await settle(); h.screen.render();
  assert.deepEqual(h.calls.routes, []);
  assert.match(h.view().subtitle, /Аккаунт изменился/);
});

function fillPassword(h, value = 'new-password') {
  h.screen.field('Новый пароль').onChangeText(value);
  h.screen.field('Повторите пароль').onChangeText(value);
  h.screen.render();
}

for (const [code, message] of [
  ['weak_password', /требованиям сервера/],
  ['same_password', /отличаться от прежнего/],
  ['over_request_rate_limit', /Слишком много попыток/],
]) {
  test(`known password rejection ${code} keeps an editable recovery form`, async () => {
    const h = callbackHarness(mockAuth({ updateUser: async () => ({ data: { user: null }, error: { code } }) }));
    h.screen.render(); await settle(); h.screen.render(); fillPassword(h);
    h.screen.button('Сохранить пароль').onPress(); await settle(); h.screen.render();
    assert.match(h.view().subtitle, message);
    assert.equal(h.screen.field('Новый пароль').editable, true);
    assert.equal(h.calls.signOut, 0); assert.deepEqual(h.calls.routes, []);
  });
}

for (const [name, outcome] of [
  ['lost connection', () => Promise.reject(new Error('Network request failed'))],
  ['server failure', async () => ({ data: { user: null }, error: { status: 503 } })],
  ['missing user', async () => ({ data: { user: null }, error: null })],
  ['unexpected user', async () => sessionResult('account-b')],
]) {
  test(`unconfirmed password update (${name}) offers login, not a blind retry or false success`, async () => {
    let updates = 0;
    const h = callbackHarness(mockAuth({ updateUser: (...args) => { updates++; return outcome(...args); } }));
    h.screen.render(); await settle(); h.screen.render(); fillPassword(h);
    const oldSave = h.screen.button('Сохранить пароль').onPress;
    oldSave(); await settle(); oldSave(); await settle(); h.screen.render();
    assert.equal(updates, 1);
    assert.equal(h.view().title, 'Проверьте вход');
    assert.match(h.view().subtitle, /пароль мог измениться/);
    assert.doesNotThrow(() => h.screen.button('Проверить вход'));
    assert.throws(() => h.screen.field('Новый пароль'));
    h.screen.button('Проверить вход').onPress(); await settle();
    assert.equal(h.calls.signOut, 1); assert.deepEqual(h.calls.routes, ['/login']);
    h.setUrl('moyaistoriya://auth/reset-password?code=next&type=recovery'); h.screen.render(); await settle(); h.screen.render();
    assert.equal(h.screen.field('Новый пароль').value, '');
    assert.equal(h.screen.field('Повторите пароль').value, '');
  });
}

test('failure to read session before saving does not pretend the password was changed', async () => {
  let updates = 0;
  const h = callbackHarness(mockAuth({ getSession: async () => ({ data: { session: null }, error: { status: 503 } }),
    updateUser: async () => { updates++; return sessionResult(); } }));
  h.screen.render(); await settle(); h.screen.render(); fillPassword(h);
  h.screen.button('Сохранить пароль').onPress(); await settle(); h.screen.render();
  assert.equal(updates, 0); assert.match(h.view().subtitle, /Не удалось проверить сессию/);
  assert.equal(h.screen.field('Новый пароль').editable, true);
});

test('the success back button signs out; failed logout remains retryable without opening the app', async () => {
  const h = callbackHarness(mockAuth());
  h.screen.render(); await settle(); h.screen.render(); fillPassword(h);
  const oldSave = h.screen.button('Сохранить пароль').onPress;
  oldSave(); await settle(); oldSave(); h.screen.render();
  let attempts = 0;
  h.context.signOut = async () => {
    attempts++;
    if (attempts === 1) return 'Test logout failure';
    h.calls.signOut++; return null;
  };
  h.screen.render(); h.view().onBack(); await settle(); h.screen.render();
  assert.match(h.view().subtitle, /Не удалось выйти/); assert.deepEqual(h.calls.routes, []);
  assert.equal(h.view().title, 'Всё готово');
  h.screen.button('Войти с новым паролем').onPress(); await settle();
  assert.equal(attempts, 2); assert.deepEqual(h.calls.routes, ['/login']);
});

test('a held success button cannot sign out a newer recovered account', async () => {
  const h = callbackHarness(mockAuth({ exchangeCodeForSession: async () => sessionResult('account-b') }));
  h.screen.render(); await settle(); h.screen.render(); fillPassword(h);
  h.screen.button('Сохранить пароль').onPress(); await settle(); h.screen.render();
  const oldLogin = h.screen.button('Войти с новым паролем').onPress;
  h.setUrl('moyaistoriya://auth/reset-password?code=account-b&type=recovery'); h.screen.render(); await settle(); h.screen.render();
  oldLogin(); await settle();
  assert.equal(h.calls.signOut, 0); assert.deepEqual(h.calls.routes, []);
  assert.equal(h.screen.field('Новый пароль').value, '');
});

test('leaving checks the actual session and never logs out an unexpected account', async () => {
  const h = callbackHarness(mockAuth({ getSession: async () => sessionResult('account-b') }));
  h.screen.render(); await settle(); h.screen.render();
  h.screen.button('Отменить и выйти').onPress(); await settle(); h.screen.render();
  assert.equal(h.calls.signOut, 0); assert.deepEqual(h.calls.routes, []);
  assert.match(h.view().subtitle, /Аккаунт изменился/);
});

test('held form and confirmation handlers do nothing after unmount', async () => {
  const h = callbackHarness(mockAuth());
  h.screen.render(); await settle(); h.screen.render(); fillPassword(h);
  const input = h.screen.field('Новый пароль').onChangeText;
  const save = h.screen.button('Сохранить пароль').onPress;
  const cancel = h.screen.button('Отменить и выйти').onPress;
  h.screen.unmount(); const writes = h.screen.stateWrites;
  input('late-password'); save(); cancel(); await settle();
  assert.equal(h.screen.stateWrites, writes); assert.equal(h.calls.signOut, 0);
  const confirmed = callbackHarness(mockAuth(), 'moyaistoriya://auth/reset-password?token_hash=test&type=signup');
  confirmed.screen.render(); await settle(); confirmed.screen.render();
  const next = confirmed.screen.button('Продолжить').onPress;
  confirmed.screen.unmount(); const finish = confirmed.calls.finish; next();
  assert.equal(confirmed.calls.finish, finish); assert.deepEqual(confirmed.calls.routes, []);
});
