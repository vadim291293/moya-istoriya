const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const { loadTypescript } = require('./load-typescript.cjs');
const fixture = (n, month = '03', count = 4) => ({
  id: `memory-${n}`, title: `Moment ${n}`, body: 'Synthetic text', event_date: `2024-${month}-01`,
  child_ids: [], media: Array.from({ length: count }, (_, i) => ({ id: `media-${n}-${i}`,
    media_type: i === 0 ? 'video' : 'image', signed_url: `https://private.example.invalid/${n}/${i}` })),
});
const viewerMocks = {
  'expo-router': { useIsFocused: () => true },
  './photo-viewer': { PhotoViewer: 'PhotoViewer' }, './video-viewer': { VideoViewer: 'VideoViewer' },
};
const { galleryRows } = loadTypescript('src/lib/memory-gallery.ts');
const rowItems = (row) => row.items;

test('thousands of files become bounded continuous rows with every file exactly once', () => {
  const memories = Array.from({ length: 1000 }, (_, i) => fixture(i));
  const rows = galleryRows(memories);
  assert.equal(rows.length, 2000); // 4000 files / two; no date headings
  assert.ok(rows.every(row => row.kind === 'tiles'));
  assert.equal(rows[0].items[0].media.id, 'media-0-0');
  const keys = Array.from(rows.flatMap(rowItems), (item) => item.key);
  assert.equal(keys.length, 4000); assert.equal(new Set(keys).size, 4000);
  const expected = memories.flatMap((memory) => memory.media.map((media) => `${memory.id}:${media.id}`));
  assert.deepEqual([...keys].sort(), expected.sort());
  for (const row of rows) assert.ok(rowItems(row).length >= 1 && rowItems(row).length <= 2);
});

test('row keys survive appending pages across months; partial rows, video and notes are represented correctly', () => {
  const first = fixture(1, '03', 3), second = fixture(2, '03', 3), video = fixture(3, '02', 1), note = fixture(4, '01', 0);
  const initial = galleryRows([first]);
  const rows = galleryRows([first, second, video, note]);
  assert.deepEqual(Array.from(rows.slice(0, initial.length), (row) => row.key), Array.from(initial, (row) => row.key));
  assert.deepEqual(Array.from(rows, (row) => rowItems(row).length), [2, 2, 2, 1]);
  assert.equal(rows.at(-1).kind, 'tiles'); assert.equal(rows.at(-1).items[0].media.media_type, 'video');
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.equal(galleryRows([note]).length, 0);
});

test('gallery uses a virtualized list of bounded rows, not one cell containing a whole month', () => {
  const screen = screenHarness('src/components/memory-gallery.tsx', viewerMocks, 'MemoryGallery');
  screen.render({ memories: [fixture(1), fixture(2)], captionFor: () => undefined });
  const list = screen.find((node) => node.type === 'FlatList').props;
  assert.ok(list.data.length > 1);
  for (const row of list.data) assert.ok(row.kind === 'tiles' && row.items.length <= 2);
  assert.ok(list.windowSize < 21); assert.equal(list.removeClippedSubviews, false);
  assert.equal(list.initialNumToRender, 4); assert.equal(list.maxToRenderPerBatch, 6);
  assert.equal(list.getItemLayout, undefined); // grid width depends on native layout
  screen.unmount();
});

test('list virtualizes memories, forwards header/footer/refresh, and keeps the viewer outside cells', () => {
  const memories = [fixture(1), fixture(2)];
  const chrome = { ListHeaderComponent: 'header', ListFooterComponent: 'footer', ListEmptyComponent: 'empty',
    refreshControl: 'refresh', onEndReached() {}, onEndReachedThreshold: 0.5 };
  const screen = screenHarness('src/components/memory-list.tsx', viewerMocks, 'MemoryList');
  const props = { memories, ageFor: () => 'Нам 1 месяц', chrome };
  screen.render(props);
  const list = screen.find((node) => node.type === 'FlatList').props;
  assert.equal(list.data, memories); assert.equal(list.keyExtractor(memories[1]), memories[1].id);
  for (const key of Object.keys(chrome)) assert.equal(list[key], chrome[key]);
  assert.equal(list.initialNumToRender, 3); assert.equal(list.maxToRenderPerBatch, 3);
  assert.equal(list.windowSize, 7); assert.equal(list.getItemLayout, undefined);
  const cell = screen.find((node) => node.type?.name === 'MemoryCard').props;
  cell.onOpenMedia(memories[0], memories[0].media[2]);
  const tree = screen.render();
  const photo = screen.find((node) => node.type === 'PhotoViewer');
  assert.equal(tree.props.children[1], photo);
  assert.equal(photo.props.initialId, memories[0].media[2].id);
  assert.equal(photo.props.photos.length, 3); // only this memory in the text feed
  assert.ok(photo.props.photos.every((media) => media.id.startsWith('media-1-')));
  assert.ok(photo.props.caption.includes('Нам 1 месяц'));
  assert.equal(list.renderItem({ item: memories[0] }).props.children.props.onOpenMedia, cell.onOpenMedia);
  screen.unmount();
});

test('unmounting a list card leaves its selected photo/video open at collection level', () => {
  const memory = fixture(1), other = fixture(2);
  const collection = screenHarness('src/components/memory-list.tsx', viewerMocks, 'MemoryList');
  collection.render({ memories: [memory, other] });
  const cardProps = collection.find((node) => node.type?.name === 'MemoryCard').props;
  const cell = screenHarness('src/components/memory-card.tsx', viewerMocks, 'MemoryCard');
  cell.render(cardProps);
  const tap = cell.find((node) => node.type?.name === 'Photo').props.onPress;
  tap(); collection.render(); collection.find((node) => node.type === 'PhotoViewer');
  cell.unmount(); const writes = collection.stateWrites; tap();
  assert.equal(collection.stateWrites, writes);
  collection.render(); collection.find((node) => node.type === 'PhotoViewer');
  const nextCell = screenHarness('src/components/memory-card.tsx', viewerMocks, 'MemoryCard');
  nextCell.render(cardProps);
  nextCell.find((node) => node.type?.name === 'VideoPreview').props.onPress(); collection.render();
  nextCell.unmount(); collection.render(); collection.find((node) => node.type === 'VideoViewer');
  assert.throws(() => collection.find((node) => node.type === 'PhotoViewer'));
  collection.unmount();
});

test('selected gallery item survives page append and URL renewal, but not removal; held old taps are rejected', () => {
  const first = fixture(1), second = fixture(2);
  const screen = screenHarness('src/components/memory-gallery.tsx', viewerMocks, 'MemoryGallery');
  const render = (memories) => screen.render({ memories, captionFor: (memory) => memory.title });
  const tile = (id) => screen.find((node) => node.type?.name === 'GalleryTile' && node.props.item.media.id === id).props;
  render([first]); const oldTap = tile(first.media[2].id).onPress; oldTap(); render([first, second]);
  assert.equal(screen.find((node) => node.type === 'PhotoViewer').props.photos.length, 6);
  const renewed = { ...first, title: 'New title', media: first.media.map((media) => ({ ...media, signed_url: `${media.signed_url}?new` })) };
  render([renewed, second]);
  const photo = screen.find((node) => node.type === 'PhotoViewer').props;
  assert.equal(photo.title, 'New title'); assert.ok(photo.photos[1].signed_url.endsWith('?new'));
  const writes = screen.stateWrites; oldTap(); assert.equal(screen.stateWrites, writes);
  render([second]); assert.throws(() => screen.find((node) => node.type === 'PhotoViewer'));
  render([renewed, second]); assert.throws(() => screen.find((node) => node.type === 'PhotoViewer'));
  screen.unmount();
});

test('renewed video uses its latest source; old photo close cannot close the video', () => {
  const memory = fixture(1);
  const screen = screenHarness('src/components/memory-list.tsx', viewerMocks, 'MemoryList');
  screen.render({ memories: [memory] });
  const open = screen.find((node) => node.type?.name === 'MemoryCard').props.onOpenMedia;
  open(memory, memory.media[1]); screen.render();
  const oldClose = screen.find((node) => node.type === 'PhotoViewer').props.onClose;
  open(memory, memory.media[0]); screen.render();
  const renewed = { ...memory, media: memory.media.map((media) => ({ ...media, signed_url: `${media.signed_url}?fresh` })) };
  screen.render({ memories: [renewed] });
  const writes = screen.stateWrites; oldClose(); assert.equal(screen.stateWrites, writes);
  assert.equal(screen.find((node) => node.type === 'VideoViewer').props.media.signed_url, renewed.media[0].signed_url);
  screen.unmount(); const after = screen.stateWrites; open(renewed, renewed.media[0]);
  assert.equal(screen.stateWrites, after);
});

test('photo rejects events from a replaced source and from an unmounted cell', () => {
  const screen = screenHarness('src/components/memory-card.tsx', viewerMocks, 'Photo');
  let opens = 0;
  const media = fixture(1).media[1], props = { media, width: 200, onPress: () => { opens++; } };
  screen.render(props);
  const oldTap = screen.button('Открыть фотографию на весь экран').onPress;
  const oldError = screen.find((node) => node.type === 'Image').props.onError;
  screen.render({ ...props, media: { ...media, signed_url: `${media.signed_url}?renewed` } });
  const writes = screen.stateWrites; oldError(); oldTap();
  assert.equal(screen.stateWrites, writes); assert.equal(opens, 0);
  const tap = screen.button('Открыть фотографию на весь экран').onPress;
  const error = screen.find((node) => node.type === 'Image').props.onError;
  tap(); assert.equal(opens, 1); screen.unmount();
  const after = screen.stateWrites; error(); tap(); assert.equal(screen.stateWrites, after); assert.equal(opens, 1);
});

test('held card layout and tap cannot mutate a recycled row or another memory', () => {
  const first = fixture(1), calls = [];
  const screen = screenHarness('src/components/memory-card.tsx', viewerMocks, 'MemoryCard');
  screen.render({ memory: first, onOpenMedia: (...args) => calls.push(args) });
  const tap = screen.find((node) => node.type?.name === 'Photo').props.onPress;
  const layout = screen.find((node) => node.props?.onLayout).props.onLayout;
  screen.render({ memory: fixture(2), onOpenMedia: (...args) => calls.push(args) });
  const writes = screen.stateWrites; tap(); layout({ nativeEvent: { layout: { width: 350 } } });
  assert.equal(calls.length, 0); assert.equal(screen.stateWrites, writes);
  screen.unmount(); layout({ nativeEvent: { layout: { width: 300 } } }); assert.equal(screen.stateWrites, writes);
});

test('collection owns one foreground listener; background, blur and late native events cannot reopen it', () => {
  let focused = true, callback, subscriptions = 0, removals = 0;
  const native = Object.fromEntries(['FlatList', 'Image', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name]));
  native.StyleSheet = { create: (style) => style };
  native.AppState = { currentState: 'active', addEventListener: (_, handler) => {
    subscriptions++; callback = handler; return { remove: () => { removals++; } };
  } };
  const mocks = { ...viewerMocks, 'react-native': native, 'expo-router': { useIsFocused: () => focused } };
  const memory = fixture(1), collection = screenHarness('src/components/memory-list.tsx', mocks, 'MemoryList');
  collection.render({ memories: [memory] });
  const card = collection.find((node) => node.type?.name === 'MemoryCard').props;
  const cell = screenHarness('src/components/memory-card.tsx', mocks, 'MemoryCard'); cell.render(card);
  assert.equal(subscriptions, 1); // cell delegates and subscribes to no AppState events
  const tap = cell.find((node) => node.type?.name === 'VideoPreview').props.onPress;
  tap(); collection.render(); collection.find((node) => node.type === 'VideoViewer');
  callback('background'); collection.render();
  const writes = collection.stateWrites; tap(); assert.equal(collection.stateWrites, writes);
  assert.throws(() => collection.find((node) => node.type === 'VideoViewer'));
  callback('active'); tap(); collection.render(); collection.find((node) => node.type === 'VideoViewer');
  focused = false; collection.render(); cell.render(card);
  assert.throws(() => collection.find((node) => node.type === 'VideoViewer'));
  const afterBlur = collection.stateWrites; tap(); assert.equal(collection.stateWrites, afterBlur);
  cell.unmount(); collection.unmount(); const after = collection.stateWrites;
  callback('active'); tap(); assert.equal(collection.stateWrites, after); assert.equal(removals, 1);
});

test('delegated card does not own a modal, so recycling it cannot close the collection viewer', () => {
  const calls = [], memory = fixture(1);
  const screen = screenHarness('src/components/memory-card.tsx', viewerMocks, 'MemoryCard');
  screen.render({ memory, onOpenMedia: (...args) => calls.push(args) });
  const photo = screen.find((node) => node.type?.name === 'Photo').props;
  photo.onPress(); screen.render();
  assert.equal(calls.length, 1); assert.equal(calls[0][0], memory); assert.equal(calls[0][1], memory.media[1]);
  assert.throws(() => screen.find((node) => node.type === 'PhotoViewer'));
  screen.unmount(); photo.onPress(); assert.equal(calls.length, 1);
});

test('a recycled gallery tile cannot forward a held tap to the collection', () => {
  let opens = 0;
  const memory = fixture(1), item = { key: 'tile', memory, media: memory.media[1] };
  const screen = screenHarness('src/components/memory-gallery.tsx', viewerMocks, 'GalleryTile');
  screen.render({ item, onPress: () => { opens++; } });
  const tap = screen.find((node) => node.type === 'Pressable').props.onPress;
  screen.unmount(); tap(); assert.equal(opens, 0);
});
