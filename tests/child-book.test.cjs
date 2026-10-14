const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { screenHarness } = require('./ui-harness.cjs');
const { childBookChapter, childBookChapters } = loadTypescript('src/lib/child-book.ts');
const { childTimelinePeriod, dateDaysAfter, dateMonthsAfter } = loadTypescript('src/lib/date-utils.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const contains = (range, date) => (!range.fromInclusive || date >= range.fromInclusive) && (!range.toExclusive || date < range.toExclusive);

test('book anniversaries retain original calendar day across short months and leap years', () => {
  assert.equal(dateMonthsAfter('2023-01-31', 1), '2023-02-28');
  assert.equal(dateMonthsAfter('2023-01-31', 2), '2023-03-31');
  assert.equal(dateMonthsAfter('2024-01-31', 1), '2024-02-29');
  assert.equal(dateMonthsAfter('2020-02-29', 12), '2021-02-28');
  assert.equal(dateMonthsAfter('2020-02-29', 48), '2024-02-29');
  assert.equal(dateDaysAfter('2024-03-01', -1), '2024-02-29');
  assert.equal(dateDaysAfter('2024-03-31', 1), '2024-04-01');
  assert.equal(dateMonthsAfter('2024-02-30', 1), null);
  assert.equal(dateMonthsAfter('2024-01-01', 1.5), null);
  assert.equal(dateDaysAfter('9999-12-31', 1), null);
});

test('every computed leaf period agrees with age headings and has exclusive upper boundaries', () => {
  for (const birth of ['2024-01-01', '2023-01-31', '2020-02-29', '2023-12-31']) {
    for (let day = -1; day <= 800; day++) {
      const date = dateDaysAfter(birth, day);
      const period = childTimelinePeriod(birth, date);
      const chapter = childBookChapter(birth, period.key);
      assert.ok(chapter, `${birth} ${date}: missing ${period.key}`);
      assert.equal(contains(chapter.range, date), true, `${birth} ${date}: outside ${period.key}`);
      assert.equal(contains(chapter.range, chapter.range.toExclusive), false);
      if (chapter.range.fromInclusive) assert.equal(contains(chapter.range, dateDaysAfter(chapter.range.fromInclusive, -1)), false);
    }
  }
});

test('book exposes only started chapters and first birthday is year-1, not overlapping month-12', () => {
  const newborn = childBookChapters('2024-01-01', '2024-01-01');
  assert.equal(newborn.days.length, 1); assert.equal(newborn.months.length, 0); assert.equal(newborn.years.length, 0);
  const atBirthday = childBookChapters('2024-01-01', '2025-01-01');
  assert.equal(atBirthday.days.length, 4); assert.equal(atBirthday.months.length, 11); assert.equal(atBirthday.years.length, 1);
  assert.equal(atBirthday.years[0].title, '1 год');
  assert.equal(atBirthday.years[0].range.fromInclusive, '2025-01-01');
  assert.equal(atBirthday.months[10].range.toExclusive, atBirthday.years[0].range.fromInclusive);
  assert.equal(childBookChapter('2024-01-01', 'month-12'), null);
  assert.equal(childBookChapter('2024-01-01', 'year--1'), null);
  assert.equal(childBookChapters('2024-01-01', '2023-12-31'), null);
  assert.equal(childBookChapters('bad-date', '2024-01-01'), null);
  assert.equal(contains(atBirthday.beforeBirth.range, '2023-12-31'), true);
  assert.equal(contains(atBirthday.beforeBirth.range, '2024-01-01'), false);
});

test('birth cover opens first days, leaf controls select their real ranges, and all-book clears selection', () => {
  let selectedKey = null;
  const screen = screenHarness('src/components/child-book-chapters.tsx', {}, 'ChildBookChapters');
  const render = () => screen.render({ birthDate: '2024-01-01', today: '2026-10-07', selectedKey, onSelect: (key) => { selectedKey = key; } });
  render(); screen.button('Открыть главу: Моё рождение').onPress(); render();
  assert.equal(selectedKey, 'birth-chapter'); assert.equal(screen.button('Скрыть первые дни').accessibilityState.expanded, true);
  const day = screen.find((node) => node.props?.chapter?.key === 'second-day');
  day.type(day.props).props.onPress(); render();
  assert.equal(selectedKey, 'second-day');
  assert.equal(screen.find((node) => node.props?.chapter?.key === 'second-day').props.selected, true);
  screen.button('Открыть всю книгу').onPress(); render();
  assert.equal(selectedKey, null); assert.equal(screen.button('Открыть всю книгу').accessibilityState.selected, true);
});

test('child route opens all linked media without age chapters, and family toggle stays scoped to account/family/child', () => {
  let routeId = 'child-a';
  let userId = 'user-a';
  const children = ['a', 'b'].map((label) => ({ id: `child-${label}`, name: label, birth_date: '2024-01-31' }));
  const family = { status: 'ready', family: { id: 'family-a' }, children };
  const screen = screenHarness('src/app/child/[id].tsx', {
    'expo-router': { useRouter: () => ({ replace() {} }), useLocalSearchParams: () => ({ id: routeId }), useFocusEffect() {} },
    '../../lib/auth-context': { useAuth: () => ({ family, session: { user: { id: userId } } }) },
    '../../components/family-memory-feed': { FamilyMemoryFeed: 'FamilyMemoryFeed' },
    '../../components/child-book-chapters': { ChildBookChapters: 'ChildBookChapters' },
  });
  screen.render();
  const feed = screen.find((node) => node.type === 'FamilyMemoryFeed');
  assert.equal(feed.props.initialView, 'gallery'); assert.equal(feed.props.childId, 'child-a');
  assert.equal(feed.props.dateRange, undefined); assert.equal(feed.props.chapterTitle, undefined);
  assert.throws(() => screen.find((node) => node.type === 'ChildBookChapters'));
  const oldToggle = feed.props.header.props.children[0].props.children[1].props.onPress;
  oldToggle(); screen.render();
  assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.childId, undefined);
  routeId = 'child-b'; screen.render();
  assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.childId, 'child-b');
  assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.dateRange, undefined);
  const writes = screen.stateWrites; oldToggle(); assert.equal(screen.stateWrites, writes);
  routeId = 'child-a'; userId = 'user-b'; screen.render();
  assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.childId, 'child-a');
  family.family.id = 'family-b'; screen.render();
  assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.dateRange, undefined);
  routeId = 'foreign-child'; screen.render();
  screen.find((node) => node.type === 'Text' && node.props.children === 'История не найдена');
});

function feedHarness(getFamilyMemories) {
  let screen;
  screen = screenHarness('src/components/family-memory-feed.tsx', {
    'expo-router': { useRouter: () => ({ push() {} }), useFocusEffect: (callback) => screen.react.useEffect(callback, [callback]) },
    '../lib/memory-service': { getFamilyMemories, MemoryWriteError: class extends Error {}, MEMORY_PAGE_SIZE: 10 },
    './memory-list': { MemoryList: 'MemoryList' },
    './memory-gallery': { MemoryGallery: 'MemoryGallery' },
    './memory-video-list': { MemoryVideoList: 'MemoryVideoList' },
  }, 'FamilyMemoryFeed', { setInterval: () => 1, clearInterval() {} });
  const props = { familyId: 'family-a', childId: 'child-a', children: [{ id: 'child-a', name: 'A', birth_date: '2024-01-01' }], chronological: true,
    dateRange: { fromInclusive: '2024-02-01', toExclusive: '2024-03-01' }, chapterTitle: '1 месяц' };
  return { screen, props };
}
const memory = { id: 'memory-a', event_date: '2024-02-05', child_ids: ['child-a'], media: [] };

test('chapter pagination and refresh retain server date bounds and chronological order', async () => {
  const requests = [];
  const cursor = { id: 'page-one' };
  const h = feedHarness(async (input) => { requests.push(input); return { items: [memory], nextCursor: cursor, hasMore: true }; });
  h.screen.render(h.props); await flush(); h.screen.render();
  h.screen.button('Загрузить следующие воспоминания').onPress(); await flush(); h.screen.render();
  h.screen.find((node) => node.type === 'MemoryDiaryList').props.chrome.refreshControl.props.onRefresh(); await flush(); h.screen.render();
  assert.equal(requests.length, 3); assert.equal(requests[1].after, cursor);
  assert.equal(requests[2].after, undefined);
  for (const request of requests) {
    assert.equal(request.childId, 'child-a'); assert.equal(request.familyId, 'family-a'); assert.equal(request.ascending, true);
    assert.equal(request.dateRange.fromInclusive, '2024-02-01'); assert.equal(request.dateRange.toExclusive, '2024-03-01');
  }
  h.screen.unmount();
});

test('failed new chapter never shows memories retained from an old chapter', async () => {
  let fail = false;
  const h = feedHarness(async () => { if (fail) throw new Error('offline'); return { items: [memory], hasMore: false, nextCursor: null }; });
  h.screen.render(h.props); await flush(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'MemoryDiaryList').props.memories.length, 1);
  fail = true;
  h.screen.render({ ...h.props, dateRange: { fromInclusive: '2024-03-01', toExclusive: '2024-04-01' }, chapterTitle: '2 месяца' });
  await flush(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'MemoryDiaryList').props.memories.length, 0);
  h.screen.find((node) => node.type === 'Text' && node.props.children === 'Лента пока недоступна');
  h.screen.unmount();
});

test('late old-chapter response cannot overwrite a newer chapter', async () => {
  let release;
  let count = 0;
  const h = feedHarness(async () => { count++; if (count === 1) return new Promise((resolve) => { release = resolve; });
    return { items: [{ ...memory, id: 'memory-b', event_date: '2024-03-05' }], hasMore: false, nextCursor: null }; });
  h.screen.render(h.props); await flush();
  h.screen.render({ ...h.props, dateRange: { fromInclusive: '2024-03-01', toExclusive: '2024-04-01' }, chapterTitle: '2 месяца' });
  await flush(); h.screen.render();
  release({ items: [memory], hasMore: false, nextCursor: null }); await flush(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'MemoryDiaryList').props.memories[0].id, 'memory-b');
  h.screen.unmount();
});
