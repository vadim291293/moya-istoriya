const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { screenHarness } = require('./ui-harness.cjs');
const { parseCaptureDate, photoCaptureDate, selectionCaptureDate } = loadTypescript('src/lib/photo-date.ts');
const { authErrorMessage, authErrorCode } = loadTypescript('src/lib/auth-errors.ts');
const image = (date) => ({ type: 'image', exif: date ? { DateTimeOriginal: date } : null });

test('capture date keeps camera calendar day and strictly validates metadata', () => {
  assert.equal(parseCaptureDate('2024:02:29 23:59:59'), '2024-02-29');
  assert.equal(parseCaptureDate('2024-03-01T00:10:00+03:00'), '2024-03-01');
  assert.equal(parseCaptureDate('2024-03-01T23:50:00-08:00'), '2024-03-01');
  for (const value of ['2023:02:29 12:00:00', '0000:00:00 00:00:00', '2024:01:01 24:00:00', '2024:01:01 12:61:00', 1729999, null]) {
    assert.equal(parseCaptureDate(value), null);
  }
  assert.equal(photoCaptureDate({ type: 'image', exif: { '{Exif}': { DateTimeOriginal: '2022:04:05 09:20:00' } } }), '2022-04-05');
  assert.equal(photoCaptureDate({ type: 'image', exif: { DateTime: '2026:01:01 10:00:00', DateTimeDigitized: '2025:01:01 10:00:00' } }), null);
  assert.equal(photoCaptureDate({ type: 'video', exif: { DateTimeOriginal: '2024:01:01 10:00:00' } }), null);
});

test('one memory never silently assigns a known capture day to mixed or undated media', () => {
  const today = '2026-10-07';
  assert.equal(selectionCaptureDate([image('2024:01:02 10:00:00'), image('2024:01:02 15:00:00')], today).date, '2024-01-02');
  assert.equal(selectionCaptureDate([image('2024:01:02 10:00:00'), image('2024:01:03 15:00:00')], today).status, 'mixed');
  assert.equal(selectionCaptureDate([image('2024:01:02 10:00:00'), image(null)], today).status, 'missing');
  assert.equal(selectionCaptureDate([image('2099:01:02 10:00:00')], today).status, 'future');
  assert.equal(selectionCaptureDate([], today).status, 'empty');
});

test('auth feedback distinguishes server rejection, confirmation, rate limit and network errors', () => {
  assert.match(authErrorMessage({ code: 'invalid_credentials' }), /Почта или пароль не совпадают/);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /подтвердите почту/);
  assert.match(authErrorMessage({ status: 429 }), /Слишком много/);
  assert.match(authErrorMessage({ name: 'AuthRetryableFetchError' }), /интернет/);
  assert.equal(authErrorCode({ code: 'invalid_credentials' }), 'invalid_credentials');
  assert.equal(authErrorCode({ code: 'token=secret@email.com' }), null);
});

function authHarness(filename, auth, callbackUrl = 'moyaistoriya://auth/reset-password') {
  return screenHarness(filename, {
    'expo-router': { useRouter: () => ({ replace() {} }) },
    'expo-linking': { createURL: (path) => { assert.equal(path, 'auth/reset-password'); return callbackUrl; } },
    '../lib/supabase': { supabase: { auth } },
    '../components/auth-screen': { AuthScreen: 'AuthScreen', AuthFeedback: 'AuthFeedback', authStyles: {} },
  });
}

test('repeat sign-in keeps exact password, normalizes email, and displays Supabase error inline', async () => {
  const requests = [];
  const screen = authHarness('src/app/login.tsx', { signInWithPassword: async (input) => {
    requests.push(input); return { data: { session: null }, error: { code: 'invalid_credentials' } };
  } });
  screen.render();
  screen.field('Электронная почта').onChangeText(' USER@EXAMPLE.COM ');
  screen.field('Пароль').onChangeText(' MiXeD Password ');
  screen.render();
  screen.button('Войти').onPress();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].email, 'user@example.com');
  assert.equal(requests[0].password, ' MiXeD Password ');
  assert.equal(screen.find((node) => node.type === 'AuthFeedback').props.code, 'invalid_credentials');
});

test('keyboard and button cannot send concurrent sign-in requests', async () => {
  let release;
  let count = 0;
  const screen = authHarness('src/app/login.tsx', { signInWithPassword: () => { count++; return new Promise((resolve) => { release = resolve; }); } });
  screen.render(); screen.field('Электронная почта').onChangeText('user@example.com'); screen.field('Пароль').onChangeText('password'); screen.render();
  screen.button('Войти').onPress(); screen.field('Пароль').onSubmitEditing();
  assert.equal(count, 1);
  release({ data: { session: {} }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  screen.render(); assert.equal(screen.button('Войти').disabled, false);
});

test('new registration rejects a mistyped confirmation without contacting Supabase', async () => {
  let count = 0;
  const screen = authHarness('src/app/register.tsx', { signUp: async () => { count++; return { data: { session: {} }, error: null }; } });
  screen.render(); screen.field('Ваше имя').onChangeText('Имя'); screen.field('Электронная почта').onChangeText('user@example.com');
  screen.field('Пароль').onChangeText('password'); screen.field('Повторите пароль').onChangeText('passw0rd'); screen.render();
  await screen.button('Создать аккаунт').onPress(); screen.render();
  assert.equal(count, 0); assert.match(screen.find((node) => node.type === 'AuthFeedback').props.message, /не совпадают/);
  screen.field('Повторите пароль').onChangeText('password'); screen.render();
  await screen.button('Создать аккаунт').onPress(); assert.equal(count, 1);
});

test('forgot password uses normalized account email and the current Expo callback, with no password required', async () => {
  const requests = [];
  const callback = 'exp://192.168.0.103:8081/--/auth/reset-password';
  const screen = authHarness('src/app/login.tsx', { resetPasswordForEmail: async (...args) => {
    requests.push(args); return { data: {}, error: null };
  } }, callback);
  screen.render(); screen.field('Электронная почта').onChangeText(' USER@EXAMPLE.COM '); screen.render();
  screen.button('Забыли пароль?').onPress(); await new Promise((resolve) => setImmediate(resolve)); screen.render();
  assert.equal(requests.length, 1); assert.equal(requests[0][0], 'user@example.com');
  assert.equal(requests[0][1].redirectTo, callback);
  const feedback = screen.find((node) => node.type === 'AuthFeedback').props;
  assert.equal(feedback.success, true); assert.match(feedback.message, /Запрос принят/);
  assert.match(feedback.message, /Если аккаунт существует/);
});

for (const code of ['email_address_not_authorized', 'over_email_send_rate_limit']) {
  test(`forgot password shows ${code} as a failure, never as a delivered email`, async () => {
    const screen = authHarness('src/app/login.tsx', { resetPasswordForEmail: async () => ({ data: {},
      error: { code, message: 'private server response' } }) });
    screen.render(); screen.field('Электронная почта').onChangeText('user@example.com'); screen.render();
    screen.button('Забыли пароль?').onPress(); await new Promise((resolve) => setImmediate(resolve)); screen.render();
    const feedback = screen.find((node) => node.type === 'AuthFeedback').props;
    assert.notEqual(feedback.success, true); assert.equal(feedback.code, code);
    assert.ok(!feedback.message.includes('private server response'));
  });
}

test('forgot password blocks duplicate emails and sign-in until the request finishes', async () => {
  let release;
  let resets = 0;
  let logins = 0;
  const screen = authHarness('src/app/login.tsx', {
    resetPasswordForEmail: () => { resets++; return new Promise((resolve) => { release = resolve; }); },
    signInWithPassword: async () => { logins++; return { data: { session: {} }, error: null }; },
  });
  screen.render(); screen.field('Электронная почта').onChangeText('user@example.com');
  screen.field('Пароль').onChangeText('new-password'); screen.render();
  screen.button('Забыли пароль?').onPress(); screen.button('Забыли пароль?').onPress(); screen.button('Войти').onPress(); screen.render();
  assert.equal(resets, 1); assert.equal(logins, 0); assert.equal(screen.button('Войти').disabled, true);
  release({ data: {}, error: null }); await new Promise((resolve) => setImmediate(resolve)); screen.render();
  assert.equal(screen.button('Войти').disabled, false);
});

test('unmounted login cannot start requests and ignores the late reset response', async () => {
  let release;
  let resets = 0;
  const screen = authHarness('src/app/login.tsx', {
    resetPasswordForEmail: () => { resets++; return new Promise((resolve) => { release = resolve; }); },
  });
  screen.render(); screen.field('Электронная почта').onChangeText('user@example.com'); screen.render();
  const reset = screen.button('Забыли пароль?').onPress;
  reset(); screen.unmount(); const writes = screen.stateWrites;
  release({ data: {}, error: null }); await new Promise((resolve) => setImmediate(resolve)); reset();
  assert.equal(resets, 1); assert.equal(screen.stateWrites, writes);
});
