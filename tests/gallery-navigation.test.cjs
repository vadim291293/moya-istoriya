const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const { loadTypescript } = require('./load-typescript.cjs');
const { gallerySections, galleryDateRange } = loadTypescript('src/lib/memory-gallery.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const json = (value) => JSON.parse(JSON.stringify(value));
const media = (id, type = 'image') => ({ id, media_type: type, signed_url: `https://private.example.invalid/${id}` });
const memories = [
  { id: 'newer', title: 'Прогулка', event_date: '2024-03-03', child_ids: ['child'], media: [media('video', 'video'), media('one'), media('two')] },
  { id: 'text', title: 'Слова', event_date: '2024-03-02', child_ids: ['child'], media: [] },
  { id: 'older', title: 'Рождение', event_date: '2024-02-29', child_ids: ['child'], media: [media('three')] },
];

test('calendar groups every media file, not only the first; text-only memories stay out of photo grid', () => {
  const sections = gallerySections(memories);
  assert.deepEqual(Array.from(sections, (s) => s.title), ['Март 2024', 'Февраль 2024']);
  assert.deepEqual(Array.from(sections.flatMap((s) => s.items), (i) => i.media.id), ['video', 'one', 'two', 'three']);
  assert.equal(new Set(sections.flatMap((s) => s.items).map((i) => i.key)).size, 4);
});

test('calendar ranges cover real months/leap day/December and reject invalid input', () => {
  assert.deepEqual(json(galleryDateRange(2024, 2)), { fromInclusive: '2024-02-01', toExclusive: '2024-03-01' });
  assert.deepEqual(json(galleryDateRange(2024, 12)), { fromInclusive: '2024-12-01', toExclusive: '2025-01-01' });
  assert.deepEqual(json(galleryDateRange(2024, null)), { fromInclusive: '2024-01-01', toExclusive: '2025-01-01' });
  assert.equal(galleryDateRange(1, 1).fromInclusive, '0001-01-01');
  for (const args of [[0, 1], [10000, 1], [2024.5, 1], [2024, 0], [2024, 13], [2024, 2.5]]) assert.throws(() => galleryDateRange(...args));
});

function feedHarness(getFamilyMemories) {
  let screen;
  screen = screenHarness('src/components/family-memory-feed.tsx', {
    'expo-router': { useRouter: () => ({ push() {} }), useFocusEffect: (callback) => screen.react.useEffect(callback, [callback]) },
    '../lib/memory-service': { getFamilyMemories, MemoryWriteError: class extends Error {}, MEMORY_PAGE_SIZE: 10 },
    './memory-list': { MemoryList: 'MemoryList' }, './memory-gallery': { MemoryGallery: 'MemoryGallery' },
    './memory-video-list': { MemoryVideoList: 'MemoryVideoList' },
  }, 'FamilyMemoryFeed', { setInterval: () => 1, clearInterval() {} });
  const props = { familyId: 'family', childId: 'child', children: [{ id: 'child', name: 'Ася', birth_date: '2024-02-29' }], initialView: 'gallery', showAddButton: false };
  return { screen, props };
}

test('calendar filters the server before pagination; pull-to-refresh retains bounds and all-dates clears them', async () => {
  const requests = [];
  const cursor = { id: 'page-one' };
  const h = feedHarness(async (input) => { requests.push(input); return { items: memories, hasMore: true, nextCursor: cursor }; });
  h.screen.render(h.props); await flush(); h.screen.render();
  assert.equal(requests[0].orderBy, 'event'); assert.equal(requests[0].dateRange.fromInclusive, undefined);
  h.screen.button('Выбрать даты').onPress(); h.screen.render();
  h.screen.button('Фев 2024').onPress(); h.screen.render(); await flush(); h.screen.render();
  h.screen.button('Загрузить следующие воспоминания').onPress(); await flush(); h.screen.render();
  h.screen.find((node) => node.props?.chrome).props.chrome.refreshControl.props.onRefresh();
  await flush(); h.screen.render();
  assert.equal(requests[2].after, cursor); assert.equal(requests[3].after, undefined);
  for (const request of requests.slice(1)) {
    assert.deepEqual(json(request.dateRange), { fromInclusive: '2024-02-01', toExclusive: '2024-03-01' });
    assert.equal(request.familyId, 'family'); assert.equal(request.childId, 'child'); assert.equal(request.orderBy, 'event');
  }
  h.screen.button('Все даты').onPress(); h.screen.render(); await flush(); h.screen.render();
  assert.equal(requests.at(-1).dateRange.fromInclusive, undefined);
  assert.throws(() => h.screen.button('Обновить воспоминания'));
  h.screen.unmount();
});

test('year navigation queries a full year; no-data period is clearly explained and can be reset', async () => {
  const requests = [];
  const h = feedHarness(async (input) => { requests.push(input); return { items: requests.length === 1 ? memories : [], hasMore: false, nextCursor: null }; });
  h.screen.render(h.props); await flush(); h.screen.render();
  h.screen.button('Выбрать даты').onPress(); h.screen.render();
  h.screen.button('Предыдущий год').onPress(); h.screen.render(); await flush(); h.screen.render();
  assert.deepEqual(json(requests[1].dateRange), { fromInclusive: '2023-01-01', toExclusive: '2024-01-01' });
  h.screen.find((node) => node.type === 'Text' && node.props.children === 'В этом периоде пока нет записей');
  h.screen.button('Сбросить фильтр даты').onPress(); h.screen.render(); await flush();
  assert.equal(requests.at(-1).dateRange.fromInclusive, undefined); h.screen.unmount();
});

test('a late old-period response and held handlers cannot populate another family or filter', async () => {
  let release;
  const requests = [];
  const h = feedHarness(async (input) => { requests.push(input); if (requests.length === 2) return new Promise((done) => { release = done; });
    return { items: memories, hasMore: false, nextCursor: null }; });
  h.screen.render(h.props); await flush(); h.screen.render();
  const oldRefresh = h.screen.find((node) => node.props?.chrome).props.chrome.refreshControl.props.onRefresh;
  h.screen.button('Выбрать даты').onPress(); h.screen.render();
  h.screen.button('Фев 2024').onPress(); h.screen.render(); await flush(); h.screen.render();
  h.screen.button('Мар 2024').onPress(); h.screen.render(); await flush(); h.screen.render();
  oldRefresh(); await flush(); assert.equal(requests.length, 3);
  release({ items: [{ ...memories[0], id: 'stale' }], hasMore: false, nextCursor: null }); await flush(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'MemoryGallery').props.memories[0].id, 'newer');
  h.screen.render({ ...h.props, familyId: 'another-family', childId: undefined }); await flush(); h.screen.render();
  assert.equal(requests.at(-1).dateRange.fromInclusive, undefined); assert.equal(requests.at(-1).childId, undefined);
  h.screen.unmount(); const count = requests.length; oldRefresh(); await flush(); assert.equal(requests.length, count);
});

test('held end-reached handler uses the latest cursor even before rerender, and stops at the last page', async () => {
  const requests = [], cursors = [{ id: 'first' }, { id: 'second' }];
  const h = feedHarness(async (input) => {
    requests.push(input);
    return { items: [memories[0]], hasMore: requests.length < 3, nextCursor: cursors[requests.length - 1] ?? null };
  });
  h.screen.render(h.props); await flush(); h.screen.render();
  const endReached = h.screen.find((node) => node.props?.chrome).props.chrome.onEndReached;
  endReached(); endReached(); await flush();
  endReached(); await flush(); endReached(); await flush();
  assert.equal(requests.length, 3);
  assert.equal(requests[1].after, cursors[0]); assert.equal(requests[2].after, cursors[1]);
  h.screen.unmount();
});

test('failed load-more retries the same cursor, preserves visible memories and never advances blindly', async () => {
  const requests = [], cursor = { id: 'first' }; let offline = true;
  const h = feedHarness(async (input) => {
    requests.push(input);
    if (requests.length === 1) return { items: [memories[0]], hasMore: true, nextCursor: cursor };
    if (offline) throw new Error('offline');
    return { items: [memories[2]], hasMore: false, nextCursor: null };
  });
  h.screen.render(h.props); await flush(); h.screen.render();
  h.screen.button('Загрузить следующие воспоминания').onPress(); await flush(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'MemoryGallery').props.memories.length, 1);
  offline = false; h.screen.button('Загрузить следующие воспоминания').onPress(); await flush(); h.screen.render();
  assert.equal(requests[1].after, cursor); assert.equal(requests[2].after, cursor);
  assert.deepEqual(Array.from(h.screen.find((node) => node.type === 'MemoryGallery').props.memories, (row) => row.id), ['newer', 'older']);
  h.screen.unmount();
});

test('refresh discards a late old continuation and starts again without a cursor', async () => {
  const requests = []; let release;
  const h = feedHarness(async (input) => {
    requests.push(input);
    if (requests.length === 2) return new Promise((resolve) => { release = resolve; });
    return { items: [memories[0]], hasMore: true, nextCursor: { id: requests.length === 1 ? 'old' : 'fresh' } };
  });
  h.screen.render(h.props); await flush(); h.screen.render();
  h.screen.button('Загрузить следующие воспоминания').onPress(); await flush();
  h.screen.find((node) => node.props?.chrome).props.chrome.refreshControl.props.onRefresh();
  await flush(); h.screen.render();
  release({ items: [{ ...memories[2], id: 'stale' }], hasMore: false, nextCursor: null }); await flush(); h.screen.render();
  assert.equal(requests[2].after, undefined);
  assert.equal(h.screen.find((node) => node.type === 'MemoryGallery').props.memories.length, 1);
  h.screen.button('Загрузить следующие воспоминания').onPress(); await flush();
  assert.equal(requests[3].after.id, 'fresh'); h.screen.unmount();
});

test('switching family, month or view starts without the old cursor', async () => {
  const requests = [];
  const h = feedHarness(async (input) => { requests.push(input); return { items: memories, hasMore: true, nextCursor: { id: 'boundary' } }; });
  h.screen.render(h.props); await flush(); h.screen.render();
  const oldMore = h.screen.button('Загрузить следующие воспоминания').onPress;
  h.screen.button('Все записи').onPress(); h.screen.render(); await flush(); h.screen.render();
  oldMore(); await flush(); assert.equal(requests.length, 2); assert.equal(requests[1].after, undefined);
  h.screen.button('Выбрать даты').onPress(); h.screen.render();
  h.screen.button('Фев 2024').onPress(); h.screen.render(); await flush(); h.screen.render();
  assert.equal(requests[2].after, undefined);
  h.screen.render({ ...h.props, familyId: 'another-family' }); await flush(); h.screen.render();
  assert.equal(requests[3].after, undefined); assert.equal(requests[3].familyId, 'another-family');
  h.screen.unmount();
});

test('feed has one vertical collection in both modes, with only a horizontal calendar strip', async () => {
  const h = feedHarness(async () => ({ items: memories, hasMore: false, nextCursor: null }));
  const tree = h.screen.render(h.props); await flush(); h.screen.render();
  assert.equal(tree.type, 'MemoryGallery');
  assert.throws(() => h.screen.find((node) => node.type === 'ScrollView' && !node.props.horizontal));
  assert.throws(() => h.screen.find((node) => node.type === 'ScrollView' && node.props.horizontal));
  h.screen.button('Выбрать даты').onPress(); h.screen.render();
  h.screen.find((node) => node.type === 'ScrollView' && node.props.horizontal);
  const oldKey = tree.key;
  h.screen.button('Все записи').onPress(); const next = h.screen.render(); await flush(); h.screen.render();
  assert.equal(next.type, 'MemoryDiaryList'); assert.notEqual(next.key, oldKey);
  assert.throws(() => h.screen.find((node) => node.type === 'ScrollView' && !node.props.horizontal));
  assert.equal(next.props.chrome.onEndReachedThreshold, 0.5);
  h.screen.unmount();
});

test('a notes-only gallery still offers continuation and the switch to text entries', async () => {
  const h = feedHarness(async () => ({ items: [memories[1]], hasMore: true, nextCursor: { id: 'notes' } }));
  h.screen.render(h.props); await flush(); h.screen.render();
  h.screen.find((node) => node.type === 'Text' && node.props.children === 'В загруженной части пока нет фото');
  h.screen.button('Загрузить следующие воспоминания');
  h.screen.button('Посмотреть текстовые записи').onPress(); h.screen.render(); await flush(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'MemoryDiaryList').props.memories[0].id, 'text');
  h.screen.unmount();
});

function galleryHarness() {
  let focused = true, stateCallback;
  const screen = screenHarness('src/components/memory-gallery.tsx', {
    'expo-router': { useIsFocused: () => focused },
    './photo-viewer': { PhotoViewer: 'PhotoViewer' }, './video-viewer': { VideoViewer: 'VideoViewer' },
    'react-native': { AppState: { currentState: 'active', addEventListener: (_, callback) => { stateCallback = callback; return { remove() {} }; } },
      FlatList: 'FlatList', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (s) => s } },
  }, 'MemoryGallery');
  const render = () => screen.render({ memories, captionFor: (memory) => memory.id });
  const tile = (id) => screen.find((node) => node.type?.name === 'GalleryTile' && node.props.item.media.id === id).props;
  render();
  return { screen, render, tile, blur: () => { focused = false; }, background: () => stateCallback('background') };
}

test('gallery has no date headings or cropped cover; one tap opens exact media and viewers do not overlap', () => {
  const h = galleryHarness();
  assert.throws(() => h.screen.find(node => node.type === 'Text' && ['Март 2024', 'Февраль 2024'].includes(node.props.children)));
  assert.equal(h.tile('one').cover, undefined); assert.equal(h.tile('two').cover, undefined);
  h.tile('two').onPress(); h.render();
  const photo = h.screen.find((node) => node.type === 'PhotoViewer').props;
  assert.equal(photo.initialId, 'two'); assert.equal(photo.photos.length, 3);
  assert.equal(photo.photos[2].viewerTitle, 'Рождение'); assert.equal(photo.photos[2].viewerCaption.includes('29 февраля 2024'), true);
  h.tile('video').onPress(); h.render();
  assert.equal(h.screen.find((node) => node.type === 'VideoViewer').props.media.signed_url, media('video').signed_url);
  assert.throws(() => h.screen.find((node) => node.type === 'PhotoViewer'));
  photo.onClose(); h.render(); h.screen.find((node) => node.type === 'VideoViewer');
  h.screen.unmount();
});

test('gallery closes in background/blur and refuses stale taps after background/unmount', () => {
  const h = galleryHarness(), oldTap = h.tile('two').onPress;
  oldTap(); h.render(); h.screen.find((node) => node.type === 'PhotoViewer');
  h.background(); h.render(); const writes = h.screen.stateWrites; oldTap(); assert.equal(h.screen.stateWrites, writes);
  assert.throws(() => h.screen.find((node) => node.type === 'PhotoViewer'));
  h.blur(); h.render(); h.screen.unmount(); const after = h.screen.stateWrites; oldTap(); assert.equal(h.screen.stateWrites, after);
});

test('old thumbnail errors cannot hide a renewed signed image, including after unmount', () => {
  const screen = screenHarness('src/components/memory-gallery.tsx', {
    'expo-router': { useIsFocused: () => true },
    './photo-viewer': { PhotoViewer: 'PhotoViewer' }, './video-viewer': { VideoViewer: 'VideoViewer' },
  }, 'GalleryTile');
  const item = { key: 'key', memory: memories[0], media: media('one') };
  screen.render({ item, onPress() {} });
  const oldError = screen.find((node) => node.type === 'Image').props.onError;
  item.media = { ...item.media, signed_url: 'https://private.example.invalid/renewed' };
  screen.render({ item, onPress() {} }); oldError(); screen.render();
  assert.equal(screen.find((node) => node.type === 'Image').props.source.uri, item.media.signed_url);
  const currentError = screen.find((node) => node.type === 'Image').props.onError;
  screen.unmount(); const writes = screen.stateWrites; currentError(); assert.equal(screen.stateWrites, writes);
});

test('photo paging changes title/date to the actual selected memory rather than keeping cover metadata', () => {
  const photos = [ { ...media('one'), viewerTitle: 'Первая', viewerCaption: 'День один' }, { ...media('two'), viewerTitle: 'Вторая', viewerCaption: 'День два' } ];
  const screen = screenHarness('src/components/photo-viewer.tsx', {}, 'PhotoViewer');
  screen.render({ photos, initialId: 'one', title: 'Fallback', caption: 'Fallback', onClose() {} });
  screen.find((node) => node.type?.name === 'ZoomablePhoto').props.onMove(1); screen.render();
  screen.find((node) => node.type === 'Text' && node.props.children === 'Вторая');
  screen.find((node) => node.type === 'Text' && node.props.children === 'День два');
  screen.unmount();
});

test('home child chip filters in place, keeps the bottom bar and presets the same child on add', () => {
  const paths = [];
  const auth = { session: { user: { id: 'user' } }, family: { status: 'ready', family: { id: 'family', name: 'Family' }, children: [{ id: 'child', name: 'Ася', birth_date: '2024-01-01' }] }, signOut() {} };
  const screen = screenHarness('src/app/home.tsx', { 'expo-router': { useRouter: () => ({ push: (path) => paths.push(path) }) },
    '../lib/auth-context': { useAuth: () => auth }, '../components/family-memory-feed': { FamilyMemoryFeed: 'FamilyMemoryFeed' } }, 'FamilyHome');
  screen.render(); const feed = () => screen.find((node) => node.type === 'FamilyMemoryFeed').props;
  const chip = feed().header.props.children[1][0]; chip.props.onPress(); screen.render();
  assert.equal(feed().childId, 'child'); assert.equal(paths.length, 0);
  screen.button('Добавить воспоминание').onPress(); assert.equal(paths[0].params.childId, 'child');
  feed().header.props.children[0].props.onPress(); screen.render(); assert.equal(feed().childId, undefined);
  screen.button('Семья'); screen.button('Семейная галерея');
  screen.unmount(); const writes = screen.stateWrites; chip.props.onPress(); assert.equal(screen.stateWrites, writes);
});

function formHarness(children, pending = null, params = {}) {
  const screen = screenHarness('src/app/memory/new.tsx', {
    'expo-router': { useRouter: () => ({}), useIsFocused: () => true, useLocalSearchParams: () => params },
    'expo-router/react-navigation': { usePreventRemove() {} }, 'expo-image-picker': {},
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    '../../lib/auth-context': { useAuth: () => ({ session: { user: { id: 'user' } }, family: { status: 'ready', family: { id: 'family', name: 'Family' }, children } }) },
    '../../lib/memory-service': { getPendingFamilyMemory: () => pending, MAX_MEDIA_FILE_SIZE: 52428800, MemoryWriteError: class extends Error {} },
  }); screen.render(); return screen;
}

test('new single-child memory is tagged by default; whole-family remains an explicit choice, multiple children are not guessed', () => {
  const child = { id: 'child', name: 'Ася', birth_date: '2024-01-01' };
  const screen = formHarness([child]);
  assert.equal(screen.button('Связать воспоминание с ребёнком Ася').accessibilityState.checked, true);
  screen.button('Для всей семьи без отметки ребёнка').onPress(); screen.render();
  assert.equal(screen.button('Связать воспоминание с ребёнком Ася').accessibilityState.checked, false);
  assert.equal(screen.button('Для всей семьи без отметки ребёнка').accessibilityState.checked, true);
  const multiple = formHarness([child, { ...child, id: 'other', name: 'Иван' }]);
  assert.equal(multiple.button('Для всей семьи без отметки ребёнка').accessibilityState.checked, true);
});

test('pending memory child links remain immutable and are not changed by the new single-child default', () => {
  const screen = formHarness([{ id: 'child', name: 'Ася', birth_date: '2024-01-01' }], { title: 'Pending', body: '', eventDate: '2024-01-01', childIds: [], uploaded: [] });
  assert.equal(screen.button('Для всей семьи без отметки ребёнка').accessibilityState.checked, true);
  assert.equal(screen.button('Связать воспоминание с ребёнком Ася').disabled, true);
});

test('held child and whole-family choices cannot change an unmounted form', () => {
  const screen = formHarness([{ id: 'child', name: 'Ася', birth_date: '2024-01-01' }]);
  const child = screen.button('Связать воспоминание с ребёнком Ася').onPress;
  const family = screen.button('Для всей семьи без отметки ребёнка').onPress;
  screen.unmount(); const writes = screen.stateWrites; child(); family(); assert.equal(screen.stateWrites, writes);
});
