const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const file = (id, type = 'image') => ({ id, media_type: type, signed_url: `https://private.example.invalid/${id}` });
const memory = (id, files, date = '2025-09-10') => ({ id, title: `Момент ${id}`, body: '', event_date: date,
  author_id: 'user', child_ids: ['child'], media: files });
const viewerMocks = { 'expo-router': { useIsFocused: () => true },
  './photo-viewer': { PhotoViewer: 'PhotoViewer' }, './video-viewer': { VideoViewer: 'VideoViewer' } };

test('video row uses a real native poster reference without cropping and no generic title or navigation arrow', async () => {
  const m = { ...memory('poster', [file('clip', 'video')]), title: null }; const frame = { nativeImage: 'fixture' };
  const queue = { get: async () => frame };
  const screen = screenHarness('src/components/memory-video-list.tsx', viewerMocks, 'VideoListItem');
  screen.render({ item: { memory: m, media: m.media[0] }, posterQueue: queue, onPress() {} }); await flush(); screen.render();
  const image = screen.find(node => node.type === 'ExpoImage').props;
  assert.equal(image.source, frame); assert.equal(image.contentFit, 'contain'); assert.equal(image.cachePolicy, 'none');
  assert.throws(() => screen.find(node => node.type === 'Text' && node.props.children === 'Семейное видео'));
  assert.throws(() => screen.find(node => node.type?.name === 'StoryIcon' && node.props.name === 'chevron'));
  screen.unmount();
});

test('a late poster cannot update an unmounted row or a row with a replaced signed URL', async () => {
  let resolve; const queue = { get: () => new Promise(done => { resolve = done; }) };
  const m = memory('old', [file('clip', 'video')]);
  const screen = screenHarness('src/components/memory-video-list.tsx', viewerMocks, 'VideoListItem');
  const props = { item: { memory: m, media: m.media[0] }, posterQueue: queue, onPress() {} };
  screen.render(props); const old = resolve;
  screen.render({ ...props, item: { memory: m, media: { ...m.media[0], signed_url: 'renewed' } } });
  old({ nativeImage: 'old' }); await flush(); screen.render(); assert.throws(() => screen.find(node => node.type === 'ExpoImage'));
  screen.unmount(); const writes = screen.stateWrites;
  resolve({ nativeImage: 'late' }); await flush(); assert.equal(screen.stateWrites, writes);
});

test('photo layout excludes videos and notes and preserves original images across months without date sections', () => {
  const { galleryRows } = loadTypescript('src/lib/memory-gallery.ts');
  const mixed = memory('mixed', [file('clip', 'video'), file('portrait'), file('landscape')]);
  const older = memory('old', [file('old-clip', 'video'), file('old-photo')], '2024-02-19');
  const rows = galleryRows([mixed, memory('note', []), older], 'image');
  assert.deepEqual(Array.from(rows, row => row.kind), ['tiles', 'tiles']);
  assert.ok(rows.every(row => !row.title));
  assert.deepEqual(Array.from(rows.flatMap(row => row.items), item => item.media.id), ['portrait', 'landscape', 'old-photo']);
  assert.equal(rows[0].items[0].memory, mixed); assert.equal(rows[0].items[0].media, mixed.media[1]);
  assert.equal(older.event_date, '2024-02-19');
});

test('voice is never a photo tile or a video row; it opens the audio viewer only from the diary', () => {
  const { galleryRows } = loadTypescript('src/lib/memory-gallery.ts');
  const m = memory('voice', [file('voice', 'audio')]);
  assert.equal(galleryRows([m]).length, 0); assert.equal(galleryRows([m], 'image').length, 0);
  const videoList = screenHarness('src/components/memory-video-list.tsx', viewerMocks, 'MemoryVideoList');
  videoList.render({ memories: [m], captionFor: () => undefined });
  assert.equal(videoList.find(node => node.type === 'FlatList').props.data.length, 0); videoList.unmount();
  const diary = screenHarness('src/components/memory-diary-list.tsx', { ...viewerMocks,
    './audio-viewer': { AudioViewer: 'AudioViewer' }, './memory-card': { MemoryCard: 'MemoryCard' },
  }, 'MemoryDiaryList');
  const note = { ...m, memory_type: 'note', diary_category: 'words' };
  diary.render({ memories: [note], captionFor: () => 'Alice' }); diary.button('Открыть запись: Момент voice').onPress(); diary.render();
  diary.find(node => node.type === 'MemoryCard').props.onOpenMedia(note, note.media[0]); diary.render();
  assert.equal(diary.find(node => node.type === 'AudioViewer').props.media, note.media[0]);
  assert.throws(() => diary.find(node => node.type === 'VideoViewer')); diary.unmount();
});

test('photo thumbnail and record image contain the whole frame rather than cropping faces', () => {
  const m = memory('photo', [file('portrait')]);
  const tile = screenHarness('src/components/memory-gallery.tsx', viewerMocks, 'GalleryTile');
  tile.render({ item: { key: 'photo:portrait', memory: m, media: m.media[0] }, onPress() {} });
  assert.equal(tile.find(node => node.type === 'Image').props.resizeMode, 'contain');
  tile.unmount();
  const record = screenHarness('src/components/memory-card.tsx', viewerMocks, 'Photo');
  record.render({ media: m.media[0], width: 200, onPress() {} });
  assert.equal(record.find(node => node.type === 'Image').props.resizeMode, 'contain'); record.unmount();
});

test('video collection lists every video once, forwards pagination, and opens only the tapped video', () => {
  const mixed = memory('mixed', [file('photo'), file('clip-a', 'video'), file('clip-b', 'video')]);
  const screen = screenHarness('src/components/memory-video-list.tsx', viewerMocks, 'MemoryVideoList');
  const chrome = { ListHeaderComponent: 'header', ListFooterComponent: 'footer', onEndReached() {}, onEndReachedThreshold: 0.5 };
  const props = { memories: [mixed, memory('note', [])], captionFor: () => 'Ася', chrome };
  screen.render(props);
  const list = screen.find(node => node.type === 'FlatList').props;
  assert.deepEqual(Array.from(list.data, item => item.media.id), ['clip-a', 'clip-b']);
  for (const key of Object.keys(chrome)) assert.equal(list[key], chrome[key]);
  assert.throws(() => screen.find(node => node.type === 'VideoViewer'));
  const tap = screen.find(node => node.type?.name === 'VideoListItem' && node.props.item.media.id === 'clip-b').props.onPress;
  tap(); const tree = screen.render();
  const viewer = screen.find(node => node.type === 'VideoViewer');
  assert.equal(viewer.props.media.id, 'clip-b'); assert.equal(tree.props.children[1], viewer);
  assert.ok(viewer.props.caption.includes('10 сентября 2025'));
  screen.unmount(); const writes = screen.stateWrites; tap(); assert.equal(screen.stateWrites, writes);
});

test('video collection resolves renewed URLs and rejects taps held from the old data', () => {
  const first = memory('mixed', [file('clip', 'video')]);
  const screen = screenHarness('src/components/memory-video-list.tsx', viewerMocks, 'MemoryVideoList');
  const render = memories => screen.render({ memories, captionFor: () => undefined });
  render([first]); const tap = screen.find(node => node.type?.name === 'VideoListItem').props.onPress;
  tap(); render([first]);
  const renewed = { ...first, media: [{ ...first.media[0], signed_url: 'https://private.example.invalid/renewed' }] };
  render([renewed]); assert.equal(screen.find(node => node.type === 'VideoViewer').props.media.signed_url, renewed.media[0].signed_url);
  const writes = screen.stateWrites; tap(); assert.equal(screen.stateWrites, writes);
  render([]); assert.throws(() => screen.find(node => node.type === 'VideoViewer')); screen.unmount();
});

test('video row is a compact playable item without a fake poster or hidden player; recycled events are ignored', () => {
  let opens = 0;
  const first = memory('first', [file('one', 'video')]);
  const screen = screenHarness('src/components/memory-video-list.tsx', viewerMocks, 'VideoListItem');
  const props = { item: { memory: first, media: first.media[0] }, onPress() { opens++; } };
  screen.render(props); const tap = screen.button('Открыть видео: Момент first').onPress;
  assert.throws(() => screen.find(node => ['Image', 'VideoView', 'VideoViewer'].includes(node.type)));
  screen.find(node => node.type === 'Text' && node.props.children === 'Нажмите, чтобы смотреть');
  assert.equal(screen.button('Открыть видео: Момент first').style({ pressed: false })[0].minHeight, 98);
  const second = memory('second', [file('two', 'video')]);
  screen.render({ ...props, item: { memory: second, media: second.media[0] } }); tap(); assert.equal(opens, 0);
  const currentTap = screen.button('Открыть видео: Момент second').onPress;
  currentTap(); assert.equal(opens, 1); screen.unmount(); currentTap(); assert.equal(opens, 1);
});

function feedHarness(getFamilyMemories, initialView = 'video') {
  let screen;
  screen = screenHarness('src/components/family-memory-feed.tsx', {
    'expo-router': { useRouter: () => ({}), useFocusEffect: f => screen.react.useEffect(f, [f]) },
    '../lib/memory-service': { getFamilyMemories, MemoryWriteError: class extends Error {}, MEMORY_PAGE_SIZE: 10 },
    './memory-gallery': { MemoryGallery: 'MemoryGallery' }, './memory-list': { MemoryList: 'MemoryList' },
    './memory-video-list': { MemoryVideoList: 'MemoryVideoList' },
  }, 'FamilyMemoryFeed', { setInterval: () => 0, clearInterval() {} });
  const props = { familyId: 'family', childId: 'child', children: [], initialView, showAddButton: false };
  screen.render(props); return { screen, props };
}

test('video tab can continue through photo-only pages to reach an older video without claiming archive is empty', async () => {
  const calls = [], cursor = { id: 'boundary' };
  const h = feedHarness(async input => { calls.push(input); return calls.length === 1
    ? { items: [memory('photo', [file('image')])], hasMore: true, nextCursor: cursor }
    : { items: [memory('old-video', [file('clip', 'video')], '2024-02-19')], hasMore: false, nextCursor: null }; });
  await flush(); h.screen.render();
  assert.equal(calls[0].orderBy, 'event'); assert.equal(calls[0].childId, 'child');
  h.screen.find(node => node.type === 'Text' && node.props.children === 'В загруженной части пока нет видео');
  h.screen.button('Загрузить следующие воспоминания').onPress(); await flush(); h.screen.render();
  assert.equal(calls[1].after, cursor);
  assert.equal(h.screen.find(node => node.type === 'MemoryVideoList').props.memories[1].id, 'old-video');
  assert.throws(() => h.screen.button('Загрузить следующие воспоминания')); h.screen.unmount();
});

test('photo tab excludes video files while preserving continuation through a video-only page', async () => {
  const h = feedHarness(async () => ({ items: [memory('clip', [file('video', 'video')])], hasMore: true, nextCursor: { id: 'next' } }), 'gallery');
  await flush(); h.screen.render(); assert.equal(h.screen.find(node => node.type === 'MemoryGallery').props.mediaKind, 'image');
  h.screen.find(node => node.type === 'Text' && node.props.children === 'В загруженной части пока нет фото');
  h.screen.button('Загрузить следующие воспоминания'); h.screen.unmount();
});

test('switching from videos to photos drops the old cursor and ignores a late video page', async () => {
  let resolve; const calls = [];
  const h = feedHarness(input => { calls.push(input); return calls.length === 1 ? new Promise(done => { resolve = done; })
    : Promise.resolve({ items: [memory('photo', [file('image')])], hasMore: false, nextCursor: null }); });
  h.screen.button('Фото').onPress(); h.screen.render(); await flush(); h.screen.render();
  resolve({ items: [memory('old', [file('clip', 'video')])], hasMore: true, nextCursor: { id: 'stale' } });
  await flush(); h.screen.render();
  assert.equal(calls.length, 2); assert.equal(calls[1].after, undefined);
  assert.equal(h.screen.find(node => node.type === 'MemoryGallery').props.memories[0].id, 'photo');
  h.screen.unmount();
});
