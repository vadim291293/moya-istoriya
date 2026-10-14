const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const { loadTypescript } = require('./load-typescript.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('continuous grid preserves query order even when months repeat or change between files', () => {
  const { galleryRows } = loadTypescript('src/lib/memory-gallery.ts');
  const memories = ['2026-10-01', '2024-02-19', '2026-10-02'].map((event_date, index) => ({
    id: String(index), event_date, media: [{ id: `photo-${index}`, media_type: 'image' }],
  }));
  const rows = galleryRows(memories, 'image');
  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows.flatMap(row => row.items), item => item.media.id), ['photo-0', 'photo-1', 'photo-2']);
  assert.equal(rows[0].items[1].memory, memories[1]);
  assert.ok(rows.every(row => row.kind === 'tiles' && row.title === undefined));
});

test('home shows a current age below each child name while keeping upload and video actions', () => {
  const auth = { session: { user: { id: 'user' } }, family: { status: 'ready', family: { id: 'family', name: 'Семья' },
    children: [{ id: 'child', name: 'Ася', birth_date: '2024-02-19' }] }, signOut() {} };
  const screen = screenHarness('src/app/home.tsx', {
    'expo-router': { useRouter: () => ({}) }, '../lib/auth-context': { useAuth: () => auth },
    '../components/family-memory-feed': { FamilyMemoryFeed: 'FamilyMemoryFeed' },
  }, 'FamilyHome');
  screen.render(); const feed = screen.find(node => node.type === 'FamilyMemoryFeed').props;
  assert.equal(feed.showDateFilter, false); assert.equal(feed.mediaOrder, 'added');
  const chip = feed.header.props.children[1][0]; const childTree = chip.type(chip.props);
  const ageText = childTree.props.children[1].props.children[1].props.children;
  const dates = loadTypescript('src/lib/date-utils.ts');
  assert.equal(ageText, dates.formatAgeAtDate('2024-02-19', dates.currentLocalDateIso()));
  screen.button('Добавить воспоминание'); screen.button('Семейные видео'); screen.unmount();
});

function feedHarness(getFamilyMemories) {
  let screen;
  screen = screenHarness('src/components/family-memory-feed.tsx', {
    'expo-router': { useRouter: () => ({}), useFocusEffect: f => screen.react.useEffect(f, [f]) },
    '../lib/memory-service': { getFamilyMemories, MemoryWriteError: class extends Error {}, MEMORY_PAGE_SIZE: 10 },
    './memory-gallery': { MemoryGallery: 'MemoryGallery' }, './memory-list': { MemoryList: 'MemoryList' },
    './memory-video-list': { MemoryVideoList: 'MemoryVideoList' },
  }, 'FamilyMemoryFeed', { setInterval: () => 0, clearInterval() {} });
  return screen;
}

test('plain gallery hides the calendar and requests newest additions for both first and subsequent pages', async () => {
  const calls = [], cursor = { id: 'next' };
  const screen = feedHarness(async input => { calls.push(input); return { items: [{ id: 'memory', event_date: '2024-02-19',
    child_ids: ['child'], media: [{ id: 'photo', media_type: 'image' }] }], hasMore: true, nextCursor: cursor }; });
  screen.render({ familyId: 'family', childId: 'child', children: [], initialView: 'gallery', showDateFilter: false, mediaOrder: 'added' });
  await flush(); screen.render();
  assert.throws(() => screen.button('Выбрать даты')); assert.throws(() => screen.button('Предыдущий год'));
  assert.equal(calls[0].orderBy, 'added'); assert.equal(calls[0].ascending, false);
  assert.equal(calls[0].dateRange.fromInclusive, undefined);
  screen.button('Загрузить следующие воспоминания').onPress(); await flush(); screen.render();
  assert.equal(calls[1].orderBy, 'added'); assert.equal(calls[1].after, cursor);
  screen.button('Видео').onPress(); screen.render(); await flush(); screen.render();
  assert.equal(calls[2].orderBy, 'added'); assert.equal(calls[2].after, undefined); screen.unmount();
});

test('changing gallery order invalidates its cursor and ignores the old request result', async () => {
  let resolve; const calls = [];
  const screen = feedHarness(input => { calls.push(input); return calls.length === 1 ? new Promise(done => { resolve = done; })
    : Promise.resolve({ items: [], hasMore: false, nextCursor: null }); });
  const props = { familyId: 'family', children: [], initialView: 'gallery', showDateFilter: false, mediaOrder: 'event' };
  screen.render(props); screen.render({ ...props, mediaOrder: 'added' }); await flush(); screen.render();
  resolve({ items: [{ id: 'old', event_date: '2024-02-19', child_ids: [], media: [] }], hasMore: true, nextCursor: { id: 'stale' } });
  await flush(); screen.render();
  assert.equal(calls[1].orderBy, 'added'); assert.equal(calls[1].after, undefined);
  assert.equal(screen.find(node => node.type === 'MemoryGallery').props.memories.length, 0);
  assert.throws(() => screen.button('Загрузить следующие воспоминания')); screen.unmount();
});
