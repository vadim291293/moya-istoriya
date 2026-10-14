const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const photo = (date = '2021:05:06 09:08:07', uri = 'file://new.jpg') => ({ uri, type: 'image', width: 800, height: 600,
  fileSize: 1024, mimeType: 'image/jpeg', exif: date ? { DateTimeOriginal: date } : null });
const original = (extra = {}) => ({ title: 'Before picker', body: 'Remember this day', eventDate: '2020-01-02',
  dateChosen: true, manualDate: true, archived: false, childIds: ['child-a'], assets: [], ...extra });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function fixture({ seed = true, snapshot = original(), result = { canceled: false, assets: [photo()] },
  nativeHold, memoryPending = null, memoryError = false, launch } = {}) {
  const module = loadTypescript('src/lib/media-picker.ts', { 'expo-crypto': { randomUUID: () => 'unused' },
    'expo-image-picker': {}, 'react-native': { Platform: { OS: 'android' } } });
  const values = new Map(), store = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const scope = { userId: 'user-a', familyId: 'family-a' }, calls = { pending: 0, launch: 0, clear: 0 };
  const old = module.createMediaPickerController({ platform: () => 'android', storage: () => store,
    randomId: () => 'original-pick', launch: () => new Promise(() => {}), getPending: async () => null });
  const seedPending = () => { void old.choose(scope, snapshot); };
  if (seed) seedPending();
  const picker = module.createMediaPickerController({ platform: () => 'android', storage: () => store,
    randomId: () => 'new-pick', launch: () => { calls.launch++; return launch?.() ?? Promise.resolve(result); },
    getPending: () => { calls.pending++; return nativeHold?.promise ?? Promise.resolve(result); } });
  const auth = { family: { status: 'ready', family: { id: scope.familyId, name: 'Family' },
    children: [{ id: 'child-a', name: 'Alice' }, { id: 'child-b', name: 'Bob' }] }, session: { user: { id: scope.userId } } };
  let focused = true;
  const paths = [], saves = [];
  const screen = screenHarness('src/app/memory/new.tsx', {
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    'expo-router': { useRouter: () => ({ canGoBack: () => false, replace: (path) => paths.push(path) }),
      useLocalSearchParams: () => ({}), useIsFocused: () => focused },
    'expo-router/react-navigation': { usePreventRemove() {} }, 'expo-image-picker': {},
    '../../lib/auth-context': { useAuth: () => auth },
    '../../lib/media-picker': { ...module, hasPendingMediaPicker: picker.hasPending,
      chooseFamilyMedia: picker.choose, recoverFamilyMedia: picker.recover, finishMediaPicker: picker.finish,
      clearMediaPickerBeforeSave: (input) => { calls.clear++; picker.clearBeforeSave(input); } },
    '../../lib/memory-service': { getPendingFamilyMemory: () => { if (memoryError) throw new Error('Bad RPC journal'); return memoryPending; },
      MAX_MEDIA_FILE_SIZE: 50 * 1024 * 1024, MemoryWriteError: class extends Error {},
      createFamilyMemory: async (input) => { saves.push(input); } },
  });
  const settle = async () => { await flush(); screen.render(); screen.render(); };
  return { screen, auth, picker, store, values, calls, paths, saves, settle, seedPending,
    setFocused: (value) => { focused = value; } };
}
function hasText(screen, pattern) {
  return screen.find((node) => node.type === 'Text' && typeof node.props.children === 'string' && pattern.test(node.props.children));
}

test('Android picker recovery restores achievement category along with text, child and files', async () => {
  const f = fixture({ snapshot: original({ diaryCategory: 'skills' }) });
  f.screen.render(); await f.settle();
  assert.equal(f.screen.find(node => node.type?.name === 'DiaryCategories').props.selected, 'skills');
  f.screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(f.saves[0].diaryCategory, 'skills'); assert.equal(f.saves[0].assets.length, 1);
  assert.equal(f.saves[0].childIds[0], 'child-a');
});

test('recovery locks inputs and save until native result is ready; saving remains explicitly user initiated', async () => {
  const nativeHold = deferred(), f = fixture({ nativeHold, snapshot: original({ assets: [photo('2021:05:06 09:08:07', 'file://old.jpg')] }) });
  f.screen.render();
  assert.equal(f.screen.field('Заголовок воспоминания').editable, false);
  assert.equal(f.screen.button('Выбрать фото или видео').disabled, true);
  const staleSave = f.screen.button('Сохранить воспоминание'); assert.equal(staleSave.disabled, true);
  staleSave.onPress(); assert.equal(f.saves.length, 0); assert.equal(f.calls.pending, 1);
  nativeHold.resolve({ canceled: false, assets: [photo()] }); await f.settle();
  assert.equal(f.screen.field('Заголовок воспоминания').value, 'Before picker');
  assert.equal(f.screen.field('Текст воспоминания').value, 'Remember this day');
  assert.equal(f.screen.field('Заголовок воспоминания').editable, true);
  assert.equal(f.saves.length, 0); assert.equal(f.values.size, 0);
  hasText(f.screen, /Восстановлен прерванный выбор/);
  f.screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(f.saves.length, 1); assert.equal(f.saves[0].eventDate, '2020-01-02');
  assert.deepEqual(Array.from(f.saves[0].childIds), ['child-a']);
  assert.deepEqual(Array.from(f.saves[0].assets, (asset) => asset.uri), ['file://old.jpg', 'file://new.jpg']);
});

test('recovery preserves automatic original capture date and never silently uses today for files without it', async () => {
  for (const date of ['2021:05:06 09:08:07', null]) {
    const f = fixture({ snapshot: original({ manualDate: false }), result: { canceled: false, assets: [photo(date)] } });
    f.screen.render(); await f.settle(); f.screen.button('Сохранить воспоминание').onPress(); await flush(); f.screen.render();
    if (date) { assert.equal(f.saves.length, 1); assert.equal(f.saves[0].eventDate, '2021-05-06'); }
    else { assert.equal(f.saves.length, 0); hasText(f.screen, /У файла нет доступной даты/); }
  }
});

test('archived text draft still requires an explicit event date after missing native result', async () => {
  const f = fixture({ snapshot: original({ archived: true, manualDate: false, dateChosen: false }), result: null });
  f.screen.render(); await f.settle();
  hasText(f.screen, /Поля прежней формы восстановлены/);
  f.screen.button('Сохранить воспоминание').onPress(); await flush(); f.screen.render();
  assert.equal(f.saves.length, 0); hasText(f.screen, /Для старой памяти укажите дату/);
  f.screen.find((node) => node.props?.accessibilityLabel === 'Выбрать дату события').props.onValueChange({}, new Date('2019-06-07T12:00:00'));
  f.screen.render(); f.screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(f.saves[0].eventDate, '2019-06-07');
});

test('recovered child links are intersected with the latest current-family children, not stale render data', async () => {
  const nativeHold = deferred(), f = fixture({ nativeHold, snapshot: original({ childIds: ['child-a', 'child-b', 'foreign-child'] }) });
  f.screen.render(); f.auth.family.children = [{ id: 'child-b', name: 'Bob' }]; f.screen.render();
  nativeHold.resolve({ canceled: false, assets: [photo()] }); await f.settle();
  f.screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.deepEqual(Array.from(f.saves[0].childIds), ['child-b']);
});

test('late recovery cannot show old-family fields to another account; original owner can recover persisted result', async () => {
  for (const change of ['account', 'family', 'logout', 'recovery']) {
    const nativeHold = deferred(), f = fixture({ nativeHold }); f.screen.render();
    if (change === 'account') f.auth.session = { user: { id: 'other-user' } };
    if (change === 'family') f.auth.family.family.id = 'other-family';
    if (change === 'logout') f.auth.session = null;
    if (change === 'recovery') f.auth.isPasswordRecovery = true;
    assert.equal(f.screen.render(), null);
    const before = f.screen.stateWrites;
    nativeHold.resolve({ canceled: false, assets: [photo()] }); await flush();
    // Only local loading cleanup is permitted; payload fields are not applied.
    assert.ok(f.screen.stateWrites <= before + 1); assert.equal(f.saves.length, 0); assert.deepEqual(f.paths, []);
    const record = JSON.parse(Array.from(f.values.values())[0]); assert.equal(record.userId, 'user-a'); assert.equal(record.outcome.status, 'selected');
    f.auth.session = { user: { id: 'user-a' } }; f.auth.family.family.id = 'family-a'; f.auth.isPasswordRecovery = false;
    f.screen.render(); await f.settle();
    assert.equal(f.screen.field('Заголовок воспоминания').value, 'Before picker');
    assert.equal(f.calls.pending, 1); assert.equal(f.saves.length, 0); assert.equal(f.values.size, 0);
  }
});

test('blurred or unmounted form does not apply a late recovery; focus return consumes the persisted result once', async () => {
  for (const change of ['blur', 'unmount']) {
    const nativeHold = deferred(), f = fixture({ nativeHold }); f.screen.render();
    if (change === 'blur') { f.setFocused(false); f.screen.render(); } else f.screen.unmount();
    const writes = f.screen.stateWrites;
    nativeHold.resolve({ canceled: false, assets: [photo()] }); await flush();
    assert.ok(f.screen.stateWrites <= writes + (change === 'blur' ? 1 : 0));
    assert.equal(f.saves.length, 0); assert.equal(f.values.size, 1);
    if (change === 'blur') {
      f.setFocused(true); f.screen.render(); await f.settle();
      assert.equal(f.screen.field('Заголовок воспоминания').value, 'Before picker'); assert.equal(f.calls.pending, 1);
    }
  }
});

test('an unresolved RPC journal has priority and is never overwritten by an older picker draft', async () => {
  const memoryPending = { title: 'Already submitted', body: 'RPC payload', eventDate: '2018-09-10', childIds: ['child-b'], uploaded: [] };
  for (const memoryError of [false, true]) {
    const f = fixture({ memoryPending: memoryError ? null : memoryPending, memoryError });
    f.screen.render(); await f.settle();
    assert.equal(f.calls.pending, 0); assert.equal(f.screen.field('Заголовок воспоминания').editable, false);
    if (!memoryError) {
      assert.equal(f.screen.field('Заголовок воспоминания').value, 'Already submitted');
      f.screen.button('Сохранить воспоминание').onPress(); await flush();
      assert.equal(f.saves[0].eventDate, '2018-09-10'); assert.equal(f.calls.clear, 0);
    } else { f.screen.button('Сохранить воспоминание').onPress(); assert.equal(f.saves.length, 0); }
  }
});

test('failed marker removal blocks saving and retry recovers the ready result without a second native read', async () => {
  const f = fixture(); const remove = f.store.removeItem; f.store.removeItem = () => { throw new Error('Temporary failure'); };
  f.screen.render(); await f.settle();
  assert.equal(f.screen.button('Сохранить воспоминание').disabled, true);
  f.screen.button('Сохранить воспоминание').onPress(); assert.equal(f.saves.length, 0);
  hasText(f.screen, /завершить локальный выбор/); assert.equal(f.calls.pending, 1);
  f.store.removeItem = remove;
  f.screen.button('Повторить восстановление выбора').onPress(); await f.settle();
  assert.equal(f.screen.button('Сохранить воспоминание').disabled, false); assert.equal(f.calls.pending, 1);
  f.screen.button('Сохранить воспоминание').onPress(); await flush(); assert.equal(f.saves.length, 1);
});

test('recovery latch prevents a held save or picker callback before React rerenders an async error', async () => {
  const f = fixture({ seed: false }); f.screen.render();
  f.screen.field('Заголовок воспоминания').onChangeText('Text'); f.screen.render();
  const pick = f.screen.button('Выбрать фото или видео'), save = f.screen.button('Сохранить воспоминание');
  f.store.removeItem = () => { throw new Error('Temporary failure'); };
  pick.onPress(); await flush(); // Deliberately do not rerender the error state.
  save.onPress(); pick.onPress(); await flush();
  assert.equal(f.saves.length, 0); assert.equal(f.calls.launch, 1);
  assert.equal(f.calls.clear, 0); assert.equal(f.values.size, 1);
});

test('normal picker result retained after blur is recovered on return without relaunching native', async () => {
  const hold = deferred(), f = fixture({ seed: false, launch: () => hold.promise });
  f.screen.render(); f.screen.field('Заголовок воспоминания').onChangeText('Typed before leaving'); f.screen.render();
  f.screen.button('Выбрать фото или видео').onPress(); f.screen.render();
  f.setFocused(false); f.screen.render();
  hold.resolve({ canceled: false, assets: [photo()] }); await flush();
  assert.equal(f.saves.length, 0); assert.equal(f.values.size, 1);
  f.setFocused(true); f.screen.render(); await f.settle();
  assert.equal(f.screen.field('Заголовок воспоминания').value, 'Typed before leaving');
  assert.equal(f.calls.launch, 1); assert.equal(f.calls.pending, 0); assert.equal(f.values.size, 0);
  f.screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(f.saves[0].assets[0].uri, 'file://new.jpg'); assert.equal(f.saves[0].eventDate, '2021-05-06');
});

test('pre-save local clearing failure prevents uploads/RPC instead of reporting a failure after commit', async () => {
  const f = fixture({ seed: false }); f.screen.render();
  f.screen.field('Заголовок воспоминания').onChangeText('Text'); f.screen.render();
  f.seedPending(); f.store.removeItem = () => { throw new Error('Temporary failure'); };
  f.screen.button('Сохранить воспоминание').onPress(); await f.settle();
  assert.equal(f.saves.length, 0); assert.equal(f.calls.clear, 1); hasText(f.screen, /завершить локальный выбор/);
});

test('held pick/save/recovery handlers do not issue native or save calls after unmount', async () => {
  const f = fixture({ seed: false }); f.screen.render();
  f.screen.field('Заголовок воспоминания').onChangeText('Text'); f.screen.render();
  const pick = f.screen.button('Выбрать фото или видео'), save = f.screen.button('Сохранить воспоминание');
  f.screen.unmount(); const writes = f.screen.stateWrites;
  pick.onPress(); save.onPress(); await flush();
  assert.equal(f.calls.launch, 0); assert.equal(f.saves.length, 0); assert.equal(f.screen.stateWrites, writes);
  const g = fixture(); const remove = g.store.removeItem;
  g.store.removeItem = () => { throw new Error('Temporary failure'); }; g.screen.render(); await g.settle();
  const retry = g.screen.button('Повторить восстановление выбора'); g.store.removeItem = remove; g.screen.unmount();
  const retryWrites = g.screen.stateWrites; retry.onPress(); await flush();
  assert.equal(g.screen.stateWrites, retryWrites); assert.equal(g.calls.pending, 1); assert.equal(g.values.size, 1);
});
