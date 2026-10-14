const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');

const pickerModule = () => loadTypescript('src/lib/media-picker.ts', {
  'expo-crypto': { randomUUID: () => 'unused-default-id' },
  'expo-image-picker': {}, 'react-native': { Platform: { OS: 'android' } },
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const scope = { userId: 'user-a', familyId: 'family-a' };
const photo = (uri = 'file://photo.jpg') => ({ uri, type: 'image', width: 800, height: 600,
  fileSize: 1024, mimeType: 'image/jpeg', exif: { DateTimeOriginal: '2021:05:06 09:08:07', GPSLatitude: 55, GPSLongitude: 37 } });
const snapshot = (extra = {}) => ({ title: 'Original title', body: 'Original body', eventDate: '2020-01-02',
  dateChosen: true, manualDate: true, archived: false, childIds: ['child-a'], assets: [], ...extra });
function storage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}
function controller({ store = storage(), platform = 'android', launch, getPending, module = pickerModule() } = {}) {
  const calls = { launch: [], pending: 0 };
  let id = 0;
  const picker = module.createMediaPickerController({ platform: () => platform, storage: () => store,
    randomId: () => `request-${++id}`,
    launch: (options) => { calls.launch.push(clone(options)); return launch?.(options) ?? Promise.resolve({ canceled: false, assets: [photo()] }); },
    getPending: () => { calls.pending++; return getPending?.() ?? Promise.resolve(null); } });
  return { picker, calls, store, module };
}
const rawRecord = (store) => Array.from(store.values.values())[0];
const record = (store) => JSON.parse(rawRecord(store));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test('real picker writes scoped fields before launch and requests capture metadata with max five assets', async () => {
  const store = storage();
  const { picker, calls } = controller({ store, launch: async () => {
    const pending = record(store);
    assert.equal(pending.outcome, null); assert.equal(pending.userId, scope.userId);
    assert.equal(pending.familyId, scope.familyId); assert.deepEqual(pending.snapshot, snapshot());
    return { canceled: false, assets: [photo()] };
  } });
  const attempt = await picker.choose(scope, snapshot());
  assert.deepEqual(calls.launch[0], { mediaTypes: ['images', 'videos'], allowsMultipleSelection: true,
    selectionLimit: 5, allowsEditing: false, quality: 1, exif: true });
  assert.equal(attempt.id, 'request-1'); assert.equal(record(store).outcome.status, 'selected');
  assert.equal(record(store).outcome.assets[0].exif.DateTimeOriginal, '2021:05:06 09:08:07');
  assert.equal(rawRecord(store).includes('GPS'), false);
  assert.equal(rawRecord(store).includes('access_token'), false);
  picker.finish(attempt.id); assert.equal(store.values.size, 0);
});

test('a recreated JS controller restores old fields and existing files with the native pending result', async () => {
  const hold = deferred(), store = storage();
  void controller({ store, launch: () => hold.promise }).picker.choose(scope, snapshot({ assets: [photo('content://old')] }));
  const restored = controller({ store, getPending: async () => ({ canceled: false, assets: [photo('file://new.jpg')] }) });
  const result = await restored.picker.recover(scope);
  assert.deepEqual(clone(result.snapshot), snapshot({ assets: [{ ...photo('content://old'), exif: { DateTimeOriginal: '2021:05:06 09:08:07' } }] }));
  assert.equal(result.outcome.assets[0].uri, 'file://new.jpg'); assert.equal(restored.calls.pending, 1);
  assert.equal(record(store).outcome.assets[0].uri, 'file://new.jpg');
});

test('completed results are persisted before React receives them and are not consumed from native twice', async () => {
  const first = controller(); await first.picker.choose(scope, snapshot());
  const next = controller({ store: first.store, getPending: async () => { throw new Error('Must not read again'); } });
  const one = await next.picker.recover(scope), two = await next.picker.recover(scope);
  assert.deepEqual(clone(one), clone(two)); assert.equal(next.calls.pending, 0);
});

test('Android picker recovery preserves a scoped voice draft without private extra fields', async () => {
  const voice = { uri: 'file://private-cache/voice.m4a', type: 'audio', width: 0, height: 0,
    fileName: 'voice.m4a', mimeType: 'audio/mp4', fileSize: 128, duration: 2,
    file: { privatePayload: 'not-in-journal' }, access_token: 'not-in-journal' };
  const initial = controller({ launch: async () => ({ canceled: true, assets: null }) });
  await initial.picker.choose(scope, snapshot({ diaryCategory: 'words', assets: [voice] }));
  const restored = await controller({ store: initial.store }).picker.recover(scope);
  assert.equal(restored.snapshot.diaryCategory, 'words');
  assert.deepEqual(clone(restored.snapshot.assets[0]), {
    uri: voice.uri, type: 'audio', width: 0, height: 0, fileName: voice.fileName,
    mimeType: voice.mimeType, fileSize: 128,
  });
  assert.equal(rawRecord(initial.store).includes('not-in-journal'), false);
  assert.equal(rawRecord(initial.store).includes('access_token'), false);
});

test('another user or family cannot consume, reveal or clear the original pending selection', async () => {
  const hold = deferred(), original = controller({ launch: () => hold.promise });
  void original.picker.choose(scope, snapshot());
  const next = controller({ store: original.store }); const before = rawRecord(next.store);
  for (const foreign of [{ ...scope, userId: 'user-b' }, { ...scope, familyId: 'family-b' }]) {
    assert.equal(next.picker.hasPending(foreign), false);
    assert.equal(await next.picker.recover(foreign), null);
    next.picker.clearBeforeSave(foreign);
    assert.equal(rawRecord(next.store), before);
  }
  assert.equal(next.calls.pending, 0);
});

test('an in-flight launch is serialized against a second launch, recovery and pre-save clearing', async () => {
  const hold = deferred(), { picker, calls } = controller({ launch: () => hold.promise });
  const choosing = picker.choose(scope, snapshot());
  await assert.rejects(picker.choose(scope, snapshot()), /уже открыта/);
  await assert.rejects(picker.recover(scope), /ещё выполняется/);
  assert.throws(() => picker.clearBeforeSave(scope), /Дождитесь/);
  assert.throws(() => picker.finish('request-1'), /Дождитесь/);
  assert.equal(calls.launch.length, 1); assert.equal(calls.pending, 0);
  hold.resolve({ canceled: true, assets: null }); await choosing;
  picker.clearBeforeSave(scope); assert.equal(picker.hasPending(scope), false);
});

test('an in-flight recovery does not destructively consume native a second time', async () => {
  const hold = deferred(), launch = deferred(), store = storage();
  void controller({ store, launch: () => launch.promise }).picker.choose(scope, snapshot());
  const next = controller({ store, getPending: () => hold.promise });
  const recovering = next.picker.recover(scope);
  await assert.rejects(next.picker.recover(scope), /ещё выполняется/);
  await assert.rejects(next.picker.choose(scope, snapshot()), /уже открыта/);
  hold.resolve({ canceled: false, assets: [photo()] }); await recovering;
  assert.equal(next.calls.pending, 1); assert.equal(next.calls.launch.length, 0);
});

test('a late old result and old finish cannot overwrite or remove a newer request marker', async () => {
  const hold = deferred(), first = controller({ launch: () => hold.promise });
  const choosing = first.picker.choose(scope, snapshot());
  const key = Array.from(first.store.values.keys())[0], newer = record(first.store);
  newer.id = 'newer-request'; newer.snapshot.title = 'Newer draft';
  first.store.setItem(key, JSON.stringify(newer));
  first.picker.finish('request-1'); assert.equal(record(first.store).id, 'newer-request');
  hold.resolve({ canceled: false, assets: [photo()] });
  await assert.rejects(choosing, /Выбор файлов изменился/);
  assert.equal(record(first.store).snapshot.title, 'Newer draft'); assert.equal(record(first.store).outcome, null);
});

test('journal write failure or silent non-persistence prevents native launch', async () => {
  for (const behavior of ['throw', 'silent']) {
    const store = storage(); store.setItem = () => { if (behavior === 'throw') throw new Error('Quota'); };
    const { picker, calls } = controller({ store });
    await assert.rejects(picker.choose(scope, snapshot()), /сохранить локальный/);
    assert.equal(calls.launch.length, 0); assert.equal(calls.pending, 0);
  }
});

test('a consumed native result survives a journal write failure for retry in the same JS process', async () => {
  for (const behavior of ['throw', 'silent']) {
    const store = storage(), hold = deferred();
    void controller({ store, launch: () => hold.promise }).picker.choose(scope, snapshot());
    const next = controller({ store, getPending: async () => ({ canceled: false, assets: [photo('file://recovered.jpg')] }) });
    const write = store.setItem;
    store.setItem = () => { if (behavior === 'throw') throw new Error('Quota'); };
    await assert.rejects(next.picker.recover(scope), /сохранить локальный/);
    assert.equal(record(store).outcome, null); assert.equal(next.calls.pending, 1);
    store.setItem = write;
    const result = await next.picker.recover(scope);
    assert.equal(result.outcome.assets[0].uri, 'file://recovered.jpg'); assert.equal(next.calls.pending, 1);
    assert.equal(record(store).outcome.assets[0].uri, 'file://recovered.jpg');
  }
});

test('a corrupt recovery journal is not erased or overwritten and blocks unsafe native consumption', async () => {
  const first = controller(); await first.picker.choose(scope, snapshot());
  const key = Array.from(first.store.values.keys())[0]; first.store.setItem(key, '{broken-json');
  const next = controller({ store: first.store });
  assert.throws(() => next.picker.hasPending(scope), /прочитать/);
  await assert.rejects(next.picker.recover(scope), /прочитать/);
  await assert.rejects(next.picker.choose(scope, snapshot()), /прочитать/);
  assert.equal(rawRecord(first.store), '{broken-json'); assert.equal(next.calls.pending, 0); assert.equal(next.calls.launch.length, 0);
});

test('missing, cancelled and native error results preserve the snapshot without inventing media', async () => {
  for (const [result, status] of [[null, 'missing'], [{ canceled: true, assets: null }, 'cancelled'],
    [{ code: 'NATIVE_ERROR', message: 'Private diagnostic' }, 'error']]) {
    const store = storage(), hold = deferred();
    void controller({ store, launch: () => hold.promise }).picker.choose(scope, snapshot());
    const next = controller({ store, getPending: async () => result });
    const restored = await next.picker.recover(scope);
    assert.equal(restored.outcome.status, status); assert.equal(restored.outcome.assets.length, 0);
    assert.equal(restored.snapshot.body, 'Original body'); assert.equal(rawRecord(store).includes('Private diagnostic'), false);
  }
});

test('native promise rejection becomes a recoverable error outcome rather than an invented success', async () => {
  const first = controller({ launch: async () => { throw new Error('Native detail'); } });
  const result = await first.picker.choose(scope, snapshot());
  assert.equal(result.outcome.status, 'error'); assert.equal(result.outcome.assets.length, 0);
  const restored = controller({ store: first.store });
  assert.equal((await restored.picker.recover(scope)).outcome.status, 'error'); assert.equal(restored.calls.pending, 0);
});

test('silent or throwing journal removal blocks pre-save clearing and preserves recovery data', async () => {
  for (const behavior of ['throw', 'silent']) {
    const { picker, store } = controller(); await picker.choose(scope, snapshot());
    const before = rawRecord(store);
    store.removeItem = () => { if (behavior === 'throw') throw new Error('Read only'); };
    assert.throws(() => picker.clearBeforeSave(scope), /локальный выбор|Локальный выбор/);
    assert.equal(rawRecord(store), before); assert.equal(picker.hasPending(scope), true);
  }
});

test('only original capture date and essential local metadata are journalled, not full EXIF or web File objects', async () => {
  const asset = { ...photo(), exif: { DateTimeOriginal: 'invalid', '{Exif}': { DateTimeOriginal: '2022:03:04 11:12:13' }, GPSLatitude: 55 },
    file: { privatePayload: true }, base64: 'large-private-image', ignored: 'extra' };
  const { picker, store } = controller({ launch: async () => ({ canceled: false, assets: [asset] }) });
  const result = await picker.choose(scope, snapshot({ assets: [asset] }));
  for (const compact of [result.snapshot.assets[0], result.outcome.assets[0]]) {
    assert.deepEqual(clone(compact.exif), { DateTimeOriginal: '2022:03:04 11:12:13' });
    assert.equal('file' in compact, false); assert.equal('base64' in compact, false);
  }
  for (const forbidden of ['GPS', 'privatePayload', 'large-private-image', 'ignored']) assert.equal(rawRecord(store).includes(forbidden), false);
});

test('remote media URIs cannot enter the Android local recovery snapshot', async () => {
  const { picker, calls } = controller();
  await assert.rejects(picker.choose(scope, snapshot({ assets: [photo('https://private.invalid/photo')] })), /Invalid local media URI/);
  assert.equal(calls.launch.length, 0);
});

test('more than five selected results retain an explicit limit warning through recovery', async () => {
  const { picker, store } = controller({ launch: async () => ({ canceled: false,
    assets: Array.from({ length: 6 }, (_, index) => photo(`file://photo-${index}.jpg`)) }) });
  const attempt = await picker.choose(scope, snapshot());
  assert.equal(attempt.outcome.assets.length, 5); assert.equal(attempt.outcome.limited, true);
  const next = controller({ store }); const recovered = await next.picker.recover(scope);
  assert.equal(recovered.outcome.limited, true); assert.equal(next.calls.pending, 0);
});

test('iOS and web do not read/write the Android journal or consume Android pending results', async () => {
  for (const platform of ['ios', 'web']) {
    const file = { name: 'web-file.png' }, asset = { uri: 'blob:web', file, width: 10, height: 10 };
    let launched = false;
    const store = { getItem() { throw new Error('Must not touch journal'); }, setItem() { throw new Error('Must not write'); }, removeItem() { throw new Error('Must not remove'); } };
    const { picker, calls } = controller({ platform, store, launch: async () => { launched = true; return { canceled: false, assets: [asset] }; } });
    const selecting = picker.choose(scope, snapshot());
    assert.equal(launched, true, 'web native launch is reached synchronously from the user gesture');
    const result = await selecting; assert.equal(result.id, null); assert.equal(result.outcome.assets[0].file, file);
    assert.equal(picker.hasPending(scope), false); assert.equal(await picker.recover(scope), null);
    picker.finish('any'); picker.clearBeforeSave(scope); assert.equal(calls.pending, 0);
  }
});
