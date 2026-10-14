const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const { loadTypescript } = require('./load-typescript.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function homeHarness() {
  const paths = [];
  const auth = { session: { user: { id: 'user', email: 'fixture@example.invalid' } },
    family: { status: 'ready', family: { id: 'family', name: 'Семья', role: 'owner' },
      children: [{ id: 'child', name: 'Ася', birth_date: '2024-01-01' }] }, signOut: async () => null };
  const screen = screenHarness('src/app/home.tsx', {
    'expo-router': { useRouter: () => ({ push: path => paths.push(path) }) },
    '../lib/auth-context': { useAuth: () => auth },
    '../components/family-memory-feed': { FamilyMemoryFeed: 'FamilyMemoryFeed' },
  }, 'FamilyHome');
  screen.render();
  return { screen, paths, auth, feed: () => screen.find(node => node.type === 'FamilyMemoryFeed').props };
}

test('five bottom actions have one canonical add; photos, videos and records reuse the protected feed', () => {
  const h = homeHarness();
  for (const label of ['Семейная галерея', 'Семейные видео', 'Все записи', 'Добавить воспоминание', 'Семья']) h.screen.button(label);
  assert.equal(h.feed().initialView, 'gallery');
  assert.equal(h.feed().showViewSwitch, false);
  assert.equal(h.feed().showAddButton, false);
  assert.equal(h.feed().showDateFilter, false);
  assert.equal(h.feed().mediaOrder, 'added');
  h.screen.button('Семейные видео').onPress(); h.screen.render();
  assert.equal(h.feed().initialView, 'video');
  assert.equal(h.screen.button('Семейные видео').accessibilityState.selected, true);
  const oldKey = h.screen.find(node => node.type === 'FamilyMemoryFeed').key;
  h.screen.button('Все записи').onPress(); h.screen.render();
  assert.equal(h.feed().initialView, 'list');
  assert.notEqual(h.screen.find(node => node.type === 'FamilyMemoryFeed').key, oldKey);
  assert.equal(h.screen.button('Все записи').accessibilityState.selected, true);
  h.screen.button('Добавить воспоминание').onPress(); assert.equal(h.paths[0].pathname, '/memory/new'); assert.equal(h.paths[0].params.diary, '1');
  h.screen.button('Семейная галерея').onPress(); h.screen.render(); assert.equal(h.feed().initialView, 'gallery');
  h.screen.unmount();
});

test('child selection is retained in videos and records, add targets that child, all resets the selection', () => {
  const h = homeHarness();
  h.feed().header.props.children[1][0].props.onPress(); h.screen.render();
  h.screen.button('Семейные видео').onPress(); h.screen.render(); assert.equal(h.feed().childId, 'child');
  h.screen.button('Все записи').onPress(); h.screen.render(); assert.equal(h.feed().childId, 'child');
  h.screen.button('Добавить воспоминание').onPress(); assert.equal(h.paths[0].params.childId, 'child');
  h.feed().header.props.children[0].props.onPress(); h.screen.render(); assert.equal(h.feed().childId, undefined);
  h.screen.unmount();
});

test('family actions point to working members, join and trash routes rather than placeholder panels', () => {
  const h = homeHarness(); h.screen.button('Семья').onPress(); h.screen.render();
  for (const [title, path] of [['Участники и приглашения', '/family/members'], ['Принять приглашение', '/family/join'], ['Корзина воспоминаний', '/family/trash']]) {
    h.screen.find(node => node.type?.name === 'FamilyAction' && node.props.title === title).props.onPress();
    assert.equal(h.paths.at(-1), path);
  }
  h.screen.unmount();
});

test('held new navigation callbacks cannot operate after changing account or unmounting', () => {
  const h = homeHarness(); const records = h.screen.button('Все записи').onPress;
  const add = h.screen.button('Добавить воспоминание').onPress;
  h.auth.session = { user: { id: 'other' } }; h.screen.render();
  const before = h.screen.stateWrites; records(); add(); assert.equal(h.screen.stateWrites, before); assert.equal(h.paths.length, 0);
  h.screen.unmount(); records(); add(); assert.equal(h.screen.stateWrites, before);
});

test('dates are collapsed by default; opening and closing the calendar does not reload data', async () => {
  let screen; let calls = 0;
  screen = screenHarness('src/components/family-memory-feed.tsx', {
    'expo-router': { useRouter: () => ({}), useFocusEffect: f => screen.react.useEffect(f, [f]) },
    '../lib/memory-service': { getFamilyMemories: async () => { calls++; return { items: [], hasMore: false, nextCursor: null }; }, MemoryWriteError: class extends Error {}, MEMORY_PAGE_SIZE: 10 },
    './memory-gallery': { MemoryGallery: 'MemoryGallery' }, './memory-list': { MemoryList: 'MemoryList' },
    './memory-video-list': { MemoryVideoList: 'MemoryVideoList' },
  }, 'FamilyMemoryFeed', { setInterval: () => 0, clearInterval() {} });
  screen.render({ familyId: 'family', children: [], initialView: 'gallery', showAddButton: false, showViewSwitch: false });
  await flush(); screen.render();
  assert.equal(screen.button('Выбрать даты').accessibilityState.expanded, false);
  assert.throws(() => screen.button('Предыдущий год')); assert.throws(() => screen.button('Все записи'));
  screen.button('Выбрать даты').onPress(); screen.render(); screen.button('Предыдущий год');
  screen.button('Выбрать даты').onPress(); screen.render(); await flush(); assert.equal(calls, 1);
  assert.throws(() => screen.button('Предыдущий год')); screen.unmount();
});

test('album empty-state opens the canonical records tab, keeping bottom selection in sync', () => {
  const h = homeHarness(); h.feed().onOpenRecords(); h.screen.render();
  assert.equal(h.feed().initialView, 'list'); assert.equal(h.screen.button('Все записи').accessibilityState.selected, true);
  h.screen.unmount();
});

test('soft violet tokens match variant four and primary/danger buttons stay visually distinct', () => {
  const { colors } = loadTypescript('src/lib/theme.ts');
  assert.equal(colors.background, '#F6F2FF'); assert.equal(colors.primary, '#6750AA'); assert.equal(colors.ink, '#372E57');
  const screen = screenHarness('src/components/family-form-ui.tsx', {}, 'FormButton');
  screen.render({ label: 'Сохранить', primary: true, onPress() {} });
  assert.ok(screen.button('Сохранить').style({ pressed: false }).some(s => s?.backgroundColor === colors.primary));
  screen.render({ label: 'Удалить', danger: true, onPress() {} });
  assert.ok(screen.button('Удалить').style({ pressed: false }).some(s => s?.backgroundColor === colors.errorSoft));
});
