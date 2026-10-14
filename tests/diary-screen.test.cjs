const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function form(params = { diary: '1' }, pending = null) {
  const saves = [], routes = [];
  const auth = { session: { user: { id: 'user-a' } }, family: { status: 'ready', family: { id: 'family-a', name: 'Family' },
    children: [{ id: 'child-a', name: 'Alice' }] } };
  const screen = screenHarness('src/app/memory/new.tsx', {
    'expo-router': { useRouter: () => ({ canGoBack: () => false, replace: route => routes.push(route) }),
      useLocalSearchParams: () => params, useIsFocused: () => true },
    'expo-router/react-navigation': { usePreventRemove() {} },
    '../../lib/auth-context': { useAuth: () => auth },
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    'expo-image-picker': { launchImageLibraryAsync: async () => ({ canceled: false, assets: [
      { uri: 'file://photo.jpg', type: 'image', width: 800, height: 600, exif: { DateTimeOriginal: '2024:01:01 10:00:00' } },
    ] }) },
    '../../lib/memory-service': { getPendingFamilyMemory: () => pending, MAX_MEDIA_FILE_SIZE: 52428800,
      MemoryWriteError: class extends Error {}, createFamilyMemory: async input => { saves.push(input); } },
  });
  screen.render(); screen.render();
  const categories = () => screen.find(node => node.type?.name === 'DiaryCategories').props;
  return { screen, saves, routes, auth, categories };
}

test('diary starts with category selection; only achievements expose media, and presets populate editable title', () => {
  const h = form(); assert.equal(h.categories().selected, null);
  assert.throws(() => h.screen.button('Выбрать фото или видео'));
  h.categories().onSelect('words'); h.screen.render(); assert.throws(() => h.screen.button('Выбрать фото или видео'));
  h.categories().onSelect('skills'); h.screen.render(); h.screen.button('Выбрать фото или видео');
  h.screen.button('Первые шаги').onPress(); h.screen.render(); assert.equal(h.screen.field('Заголовок воспоминания').value, 'Первые шаги');
  h.screen.unmount();
});

test('all text categories save the selected child and real category; ordinary media remains uncategorized', async () => {
  for (const category of ['words', 'quotes', 'moments']) {
    const h = form({ diary: '1', category });
    h.screen.field('Текст воспоминания').onChangeText('Первое «мама»'); h.screen.render();
    h.screen.button('Сохранить воспоминание').onPress(); await flush();
    assert.equal(h.saves[0].diaryCategory, category); assert.equal(h.saves[0].assets.length, 0);
    assert.equal(h.saves[0].childIds[0], 'child-a'); h.screen.unmount();
  }
  const h = form({}); h.screen.field('Заголовок воспоминания').onChangeText('Фото'); h.screen.render();
  h.screen.button('Выбрать фото или видео').onPress(); await flush(); h.screen.render(); h.screen.render();
  h.screen.button('Сохранить воспоминание').onPress(); await flush(); assert.equal(h.saves[0].diaryCategory, null); h.screen.unmount();
});

test('achievement keeps its attachment and cannot be switched silently to a text-only category', async () => {
  const h = form({ diary: '1', category: 'skills' }); h.screen.button('Первые шаги').onPress(); h.screen.render();
  h.screen.button('Выбрать фото или видео').onPress(); await flush(); h.screen.render(); h.screen.render();
  h.categories().onSelect('words'); h.screen.render(); assert.equal(h.categories().selected, 'skills');
  h.screen.button('Сохранить воспоминание').onPress(); await flush();
  assert.equal(h.saves[0].diaryCategory, 'skills'); assert.equal(h.saves[0].assets.length, 1);
  assert.equal(h.saves[0].eventDate, '2024-01-01'); h.screen.unmount();
});

test('pending achievement overrides a new route category and restored form is locked, preserving the original submission', () => {
  const h = form({ diary: '1', category: 'words' }, { title: 'Первые шаги', body: 'Original', eventDate: '2024-01-01',
    childIds: ['child-a'], diaryCategory: 'skills', uploaded: [{ id: 'file' }] });
  assert.equal(h.categories().selected, 'skills'); assert.equal(h.categories().disabled, true);
  assert.equal(h.screen.field('Заголовок воспоминания').value, 'Первые шаги'); h.screen.unmount();
});

test('retained category callbacks cannot change a form after account change or unmount', () => {
  const h = form(); const select = h.categories().onSelect;
  h.auth.session.user.id = 'other'; h.screen.render(); const writes = h.screen.stateWrites;
  select('skills'); assert.equal(h.screen.stateWrites, writes); h.screen.unmount(); select('words'); assert.equal(h.screen.stateWrites, writes);
});

test('voice appears in all diary categories, saves without requiring photo EXIF and remains outside normal upload', async () => {
  for (const category of ['words', 'skills', 'quotes', 'moments']) {
    const h = form({ diary: '1', category }); h.screen.field('Текст воспоминания').onChangeText('Мама'); h.screen.render();
    const recorder = h.screen.find(node => node.type?.name === 'VoiceRecorder').props;
    recorder.onChange({ uri: 'file:///private/voice.m4a', type: 'audio', width: 0, height: 0, mimeType: 'audio/mp4', fileName: 'voice.m4a' });
    h.screen.render(); h.screen.render(); h.screen.button('Сохранить воспоминание').onPress(); await flush();
    assert.equal(h.saves.length, 1); assert.equal(h.saves[0].assets[0].type, 'audio'); assert.equal(h.saves[0].diaryCategory, category);
    h.screen.unmount();
  }
  const ordinary = form({}); assert.throws(() => ordinary.screen.find(node => node.type?.name === 'VoiceRecorder')); ordinary.screen.unmount();
});
test('recording locks Save synchronously, voice survives a category switch and stale callbacks cannot attach after logout', async () => {
  const h = form({ diary: '1', category: 'words' }); h.screen.field('Текст воспоминания').onChangeText('Story'); h.screen.render();
  const recorder = h.screen.find(node => node.type?.name === 'VoiceRecorder').props;
  const save = h.screen.button('Сохранить воспоминание').onPress;
  recorder.onBusyChange(true); save(); await flush(); assert.equal(h.saves.length, 0);
  recorder.onChange({ uri: 'file:///private/voice.m4a', type: 'audio', width: 0, height: 0, mimeType: 'audio/mp4', fileName: 'voice.m4a' });
  recorder.onBusyChange(false); h.screen.render(); h.categories().onSelect('moments'); h.screen.render();
  assert.equal(h.categories().selected, 'moments'); assert.equal(h.screen.find(node => node.type?.name === 'VoiceRecorder').props.asset.type, 'audio');
  h.auth.session.user.id = 'other'; h.screen.render(); const writes = h.screen.stateWrites;
  recorder.onChange(null); recorder.onBusyChange(true); assert.equal(h.screen.stateWrites, writes);
  h.screen.unmount(); recorder.onChange(null); assert.equal(h.screen.stateWrites, writes);
});

test('diary list contains legacy notes and categorized achievements, not ordinary media; expansion opens the complete event', () => {
  const rows = [
    { id: 'legacy', memory_type: 'note', diary_category: null, title: 'Тёплый момент', body: 'Full story', event_date: '2024-01-01', child_ids: [], media: [] },
    { id: 'skill', memory_type: 'mixed', diary_category: 'skills', title: 'Первые шаги', body: 'Whole achievement', event_date: '2024-01-02', child_ids: ['child'], media: [
      { id: 'file', media_type: 'video', signed_url: 'https://private.example.invalid/clip' },
    ] },
    { id: 'photo', memory_type: 'mixed', diary_category: null, title: 'Ordinary photo', event_date: '2024-01-01', media: [] },
  ];
  const screen = screenHarness('src/components/memory-diary-list.tsx', {
    'expo-router': { useIsFocused: () => true }, './memory-card': { MemoryCard: 'MemoryCard' },
    './photo-viewer': { PhotoViewer: 'PhotoViewer' }, './video-viewer': { VideoViewer: 'VideoViewer' },
  }, 'MemoryDiaryList');
  screen.render({ memories: rows, captionFor: () => 'Alice', canEditMemory: () => false });
  assert.deepEqual(Array.from(screen.find(node => node.type === 'FlatList').props.data, row => row.id), ['legacy', 'skill']);
  screen.button('Открыть запись: Первые шаги').onPress(); screen.render();
  const event = screen.find(node => node.type === 'MemoryCard').props;
  assert.equal(event.memory, rows[1]); assert.equal(event.onEdit, undefined);
  event.onOpenMedia(rows[1], rows[1].media[0]); screen.render();
  assert.equal(screen.find(node => node.type === 'VideoViewer').props.media, rows[1].media[0]);
  screen.unmount(); const writes = screen.stateWrites;
  event.onOpenMedia(rows[1], rows[1].media[0]); assert.equal(screen.stateWrites, writes);
});

test('changing diary category resets the page, rejects late responses, and creates a category-bound route', async () => {
  const requests = [], routes = []; let release; let screen;
  screen = screenHarness('src/components/family-memory-feed.tsx', {
    './memory-gallery': { MemoryGallery: 'MemoryGallery' }, './memory-video-list': { MemoryVideoList: 'MemoryVideoList' },
    'expo-router': { useRouter: () => ({ push: route => routes.push(route) }), useFocusEffect: fn => screen.react.useEffect(fn, [fn]) },
    '../lib/memory-service': { MEMORY_PAGE_SIZE: 10, MemoryWriteError: class extends Error {}, getFamilyMemories: input => {
      requests.push(input);
      if (requests.length === 1) return new Promise(resolve => { release = resolve; });
      return Promise.resolve({ items: [], hasMore: false, nextCursor: null });
    } },
  }, 'FamilyMemoryFeed', { setInterval: () => 0, clearInterval() {} });
  const props = { familyId: 'family', childId: 'child', children: [], initialView: 'list', showViewSwitch: false, showDateFilter: false };
  screen.render(props);
  screen.find(node => node.type?.name === 'DiaryCategories').props.onSelect('skills'); screen.render(); await flush(); screen.render();
  assert.equal(requests[1].diary, 'skills'); assert.equal(requests[1].after, undefined);
  release({ items: [{ id: 'old', media: [] }], hasMore: false, nextCursor: null }); await flush(); screen.render();
  assert.equal(screen.find(node => node.type === 'MemoryDiaryList').props.memories.length, 0);
  screen.button('Добавить запись в дневник').onPress();
  assert.equal(routes[0].params.category, 'skills'); assert.equal(routes[0].params.childId, 'child');
  screen.unmount();
});
