const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const photo = (date, uri = 'file://photo.jpg') => ({ uri, type: 'image', width: 800, height: 600,
  exif: date ? { DateTimeOriginal: date } : null, fileSize: 1024 });

function memoryForm(assets, { picker, save } = {}) {
  const saves = [];
  const options = [];
  const paths = [];
  const router = { canGoBack: () => false, replace: (path) => paths.push(path) };
  const auth = { family: { status: 'ready', family: { id: 'family', name: 'Family' }, children: [] }, session: { user: { id: 'user' } } };
  const screen = screenHarness('src/app/memory/new.tsx', {
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => ({}), useIsFocused: () => true },
    'expo-router/react-navigation': { usePreventRemove() {} },
    'expo-image-picker': { launchImageLibraryAsync: async (input) => { options.push(input); return picker ? picker(input) : { canceled: false, assets }; } },
    '../../lib/auth-context': { useAuth: () => auth },
    '../../lib/memory-service': { getPendingFamilyMemory: () => null, MAX_MEDIA_FILE_SIZE: 50 * 1024 * 1024,
      MemoryWriteError: class extends Error {}, createFamilyMemory: async (input) => { saves.push(input); return save?.(input); } },
  });
  screen.render();
  return { screen, saves, options, auth, paths };
}

test('gallery has a synchronous latch and save cannot run before picker rerenders', async () => {
  let resolve;
  const result = new Promise((done) => { resolve = done; });
  const { screen, saves, options } = memoryForm([], { picker: () => result });
  screen.field('Заголовок воспоминания').onChangeText('Text only'); screen.render();
  const pick = screen.button('Выбрать фото или видео');
  const save = screen.button('Сохранить воспоминание');
  pick.onPress(); pick.onPress(); save.onPress();
  assert.equal(options.length, 1); assert.equal(saves.length, 0);
  resolve({ canceled: true, assets: null }); await flush(); screen.render();
  screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(saves.length, 1);
});

test('late gallery result is ignored after account or family changes', async () => {
  for (const change of ['account', 'family']) {
    let resolve;
    const result = new Promise((done) => { resolve = done; });
    const { screen, auth, saves } = memoryForm([], { picker: () => result });
    screen.button('Выбрать фото или видео').onPress(); screen.render();
    if (change === 'account') auth.session = { user: { id: 'other-user' } };
    else auth.family.family.id = 'other-family';
    assert.equal(screen.render(), null);
    resolve({ canceled: false, assets: [photo('2021:05:06 09:08:07')] }); await flush();
    if (change === 'account') auth.session = { user: { id: 'user' } };
    else auth.family.family.id = 'family';
    screen.render(); screen.render();
    screen.find((node) => node.type === 'Text' && typeof node.props.children === 'string' && /без фото/.test(node.props.children));
    screen.button('Сохранить воспоминание').onPress(); await flush();
    assert.equal(saves.length, 0);
  }
});

test('gallery cancellation preserves selection and subsequent picks deduplicate/cap files', async () => {
  const files = Array.from({ length: 6 }, (_, index) => photo('2021:05:06 09:08:07', `file://photo-${index}.jpg`));
  const results = [{ canceled: false, assets: [files[0]] }, { canceled: true, assets: null },
    { canceled: false, assets: [...files, { ...files[5], uri: 'file://huge.jpg', fileSize: 52428801 }] }];
  const { screen, saves } = memoryForm([], { picker: () => results.shift() });
  for (let attempt = 0; attempt < 3; attempt++) {
    screen.button('Выбрать фото или видео').onPress(); await flush(); screen.render(); screen.render();
  }
  screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(saves.length, 1); assert.equal(saves[0].assets.length, 5);
  assert.deepEqual(Array.from(saves[0].assets, (asset) => asset.uri), files.slice(0, 5).map((asset) => asset.uri));
});

test('form reports real upload stages and ignores feedback after account changes', async () => {
  let resolve;
  const result = new Promise((done) => { resolve = done; });
  const { screen, saves, auth, paths } = memoryForm([], { save: () => result });
  screen.field('Заголовок воспоминания').onChangeText('Test'); screen.render();
  screen.button('Сохранить воспоминание').onPress(); screen.render();
  const progress = saves[0].onProgress;
  assert.equal(typeof progress, 'function');
  for (const [phase, completedFiles, totalFiles, label] of [
    ['preparing', 0, 2, 'Подготавливаем файл 1 из 2…'],
    ['uploading', 1, 2, 'Загружаем файл 2 из 2…'],
    ['saving', 2, 2, 'Сохраняем запись…'],
    ['checking', 2, 2, 'Проверяем результат…'],
  ]) {
    progress({ phase, completedFiles, totalFiles }); screen.render();
    assert.equal(screen.button(label).disabled, true);
  }
  auth.session = { user: { id: 'other-user' } }; assert.equal(screen.render(), null);
  const writes = screen.stateWrites;
  progress({ phase: 'saving', completedFiles: 2, totalFiles: 2 });
  assert.equal(screen.stateWrites, writes);
  resolve(); await flush(); screen.render(); assert.deepEqual(paths, []);
});

test('photo selection requests EXIF and saves capture day without opening the date picker', async () => {
  const { screen, saves, options } = memoryForm([photo('2021:05:06 09:08:07')]);
  screen.button('Выбрать фото или видео').onPress(); await flush(); screen.render(); screen.render();
  assert.equal(options[0].exif, true);
  screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(saves.length, 1); assert.equal(saves[0].eventDate, '2021-05-06');
});

test('missing and mixed capture dates do not save with a silent today fallback', async () => {
  for (const files of [[photo(null)], [photo('2021:05:06 09:08:07'), photo('2021:05:07 09:08:07', 'file://other.jpg')]]) {
    const { screen, saves } = memoryForm(files);
    screen.button('Выбрать фото или видео').onPress(); await flush(); screen.render(); screen.render();
    screen.button('Сохранить воспоминание').onPress(); await flush(); screen.render();
    assert.equal(saves.length, 0);
    screen.find((node) => node.type === 'Text' && typeof node.props.children === 'string' && /У файла нет|сняты в разные дни/.test(node.props.children));
  }
});

test('picking a photo never overwrites an explicitly chosen event date', async () => {
  const { screen, saves } = memoryForm([photo('2021:05:06 09:08:07')]);
  screen.find((node) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Дата события:')).props.onPress();
  screen.render(); screen.find((node) => node.props?.accessibilityLabel === 'Выбрать дату события').props.onValueChange({}, new Date('2020-01-02T12:00:00'));
  screen.render(); screen.button('Выбрать фото или видео').onPress(); await flush(); screen.render(); screen.render();
  screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(saves[0].eventDate, '2020-01-02');
});

test('viewer displays original privately signed photo, moves between photos and closes with Android back', () => {
  const closed = [];
  const photos = ['one', 'two'].map((id) => ({ id, signed_url: 'https://private.invalid/' + id }));
  const screen = screenHarness('src/components/photo-viewer.tsx', { 'expo-status-bar': { StatusBar: 'StatusBar' } }, 'PhotoViewer');
  screen.render({ photos, initialId: 'one', title: 'Memory', caption: 'Date', onClose: () => closed.push(true) });
  const zoom = () => screen.find((node) => node.type?.name === 'ZoomablePhoto').props;
  assert.equal(zoom().uri, photos[0].signed_url);
  zoom().onMove(1); screen.render();
  assert.equal(zoom().uri, photos[1].signed_url);
  zoom().onMove(1); screen.render(); assert.equal(zoom().uri, photos[1].signed_url);
  screen.button('Открыть фото 1').onPress(); screen.render(); assert.equal(zoom().uri, photos[0].signed_url);
  screen.find((node) => node.type === 'Modal').props.onRequestClose(); assert.equal(closed.length, 1);
});

test('saved photo tap opens viewer and blur removes the private modal', () => {
  let focused = true;
  const screen = screenHarness('src/components/memory-card.tsx', {
    'expo': { useEvent: () => ({ status: 'readyToPlay' }) },
    'expo-router': { useIsFocused: () => focused },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: () => ({}) },
    './photo-viewer': { PhotoViewer: 'PhotoViewer' },
  }, 'MemoryCard');
  screen.render({ memory: { title: 'Photo', event_date: '2021-05-06', media: [{ id: 'photo', media_type: 'image', signed_url: 'https://private.invalid/one' }] } });
  // Invoke the actual handler passed from the card to its Photo child.
  const photoElement = screen.find((node) => typeof node.type === 'function' && node.type.name === 'Photo');
  photoElement.props.onPress(); screen.render();
  assert.equal(screen.find((node) => node.type === 'PhotoViewer').props.initialId, 'photo');
  focused = false;
  const blurred = screen.render();
  assert.equal(JSON.stringify(blurred).includes('PhotoViewer'), false);
});

test('memory save does not block logout/recovery or navigate another account after late success', async () => {
  for (const change of ['logout', 'recovery', 'account']) {
    let resolve;
    const hold = new Promise((done) => { resolve = done; });
    const paths = [], guards = [], saves = [];
    const auth = { family: { status: 'ready', family: { id: 'family', name: 'Family' }, children: [] }, session: { user: { id: 'user' } } };
    const screen = screenHarness('src/app/memory/new.tsx', {
      '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
      'expo-router': { useRouter: () => ({ canGoBack: () => false, replace: (path) => paths.push(path) }), useLocalSearchParams: () => ({}), useIsFocused: () => true },
      'expo-router/react-navigation': { usePreventRemove: (guard) => guards.push(guard) },
      'expo-image-picker': {}, '../../lib/auth-context': { useAuth: () => auth },
      '../../lib/memory-service': { getPendingFamilyMemory: () => null, MAX_MEDIA_FILE_SIZE: 50 * 1024 * 1024,
        MemoryWriteError: class extends Error {}, createFamilyMemory: (input) => { saves.push(input); return hold; } },
    });
    screen.render(); screen.field('Заголовок воспоминания').onChangeText('Test'); screen.render();
    const oldSave = screen.button('Сохранить воспоминание'); oldSave.onPress(); screen.render();
    assert.equal(guards.at(-1), true);
    if (change === 'logout') auth.session = null;
    if (change === 'recovery') auth.isPasswordRecovery = true;
    if (change === 'account') auth.session = { user: { id: 'other-user' } };
    assert.equal(screen.render(), null); assert.equal(guards.at(-1), false);
    resolve(); await flush(); screen.render(); oldSave.onPress(); await flush();
    assert.equal(saves.length, 1); assert.deepEqual(paths, []);
  }
});

test('an auth/preflight failure on retry never unlocks an unresolved memory payload', async () => {
  class MemoryWriteError extends Error { constructor(message, cleanup = false, pending = false) { super(message); this.pending = pending; } }
  const screen = screenHarness('src/app/memory/new.tsx', {
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({}), useIsFocused: () => true },
    'expo-router/react-navigation': { usePreventRemove() {} }, 'expo-image-picker': {},
    '../../lib/auth-context': { useAuth: () => ({ family: { status: 'ready', family: { id: 'family', name: 'Family' }, children: [] }, session: { user: { id: 'user' } } }) },
    '../../lib/memory-service': { getPendingFamilyMemory: () => ({ title: 'Original', body: '', eventDate: '2020-01-02', childIds: [], uploaded: [] }),
      MAX_MEDIA_FILE_SIZE: 50 * 1024 * 1024, MemoryWriteError, createFamilyMemory: async () => { throw new MemoryWriteError('Session unavailable'); } },
  });
  screen.render(); screen.button('Сохранить воспоминание').onPress(); await flush(); screen.render();
  assert.equal(screen.field('Заголовок воспоминания').editable, false);
  assert.equal(screen.field('Заголовок воспоминания').value, 'Original');
  assert.equal(screen.button('Выбрать фото или видео').disabled, true);
});
