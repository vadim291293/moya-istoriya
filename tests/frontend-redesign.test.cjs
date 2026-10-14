const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const { loadTypescript } = require('./load-typescript.cjs');
const { clampPhotoScale, photoPanBounds, photoSwipeDirection } = loadTypescript('src/lib/photo-gestures.ts');

test('photo zoom clamps 1–5x and pan bounds follow the real contained image, not black margins', () => {
  assert.equal(clampPhotoScale(0.2), 1); assert.equal(clampPhotoScale(20), 5);
  assert.deepEqual(JSON.parse(JSON.stringify(photoPanBounds(300, 600, 1200, 600, 2))), { x: 150, y: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(photoPanBounds(300, 600, 600, 1200, 2))), { x: 150, y: 300 });
  assert.equal(photoPanBounds(0, 600, 600, 1200, 2).x, 0);
});

test('photo swipe needs a horizontal single-finger gesture at original size', () => {
  assert.equal(photoSwipeDirection(-80, 10, -200, 1, false), 1);
  assert.equal(photoSwipeDirection(80, 10, 200, 1, false), -1);
  for (const args of [[-80, 10, -200, 2, false], [-80, 10, -200, 1, true], [-30, 90, -900, 1, false], [-10, 0, -900, 1, false]]) assert.equal(photoSwipeDirection(...args), 0);
});

function photoSurface() {
  const moves = [], zooms = [];
  const props = { uri: 'https://private.invalid/photo', label: 'Фото', resetVersion: 0,
    onMove: (direction) => moves.push(direction), onZoom: (value) => zooms.push(value), onLoadStart() {}, onLoad() {}, onError() {} };
  const screen = screenHarness('src/components/zoomable-photo.tsx', {}, 'ZoomablePhoto');
  const render = () => screen.render(props);
  render();
  screen.find((node) => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 300, height: 600 } } });
  screen.find((node) => node.type === 'Image').props.onLoad({ nativeEvent: { source: { width: 600, height: 1200 } } });
  render();
  const gesture = (kind) => screen.find((node) => node.type === 'GestureDetector').props.gesture.gestures.find((item) => item.kind === kind).callbacks;
  const transforms = () => screen.find((node) => node.type === 'Image').props.style[1].transform;
  return { screen, props, render, gesture, transforms, moves, zooms };
}

test('double-tap zooms, pan stays inside the photo, reset and layout changes restore full frame', () => {
  const p = photoSurface();
  assert.equal(p.screen.find((node) => node.type === 'Image').props.resizeMode, 'contain');
  p.gesture('tap').onEnd({ x: 150, y: 300 }, true); p.render();
  assert.equal(p.transforms()[2].scale, 2.5);
  p.gesture('pan').onStart({ numberOfPointers: 1 });
  p.gesture('pan').onUpdate({ numberOfPointers: 1, translationX: 10000, translationY: 10000 });
  p.gesture('pan').onEnd({ translationX: 10000, translationY: 0, velocityX: 900 }); p.render();
  assert.equal(p.transforms()[0].translateX, 225); assert.equal(p.transforms()[1].translateY, 450); assert.equal(p.moves.length, 0);
  p.props.resetVersion++; p.render(); p.render(); assert.equal(p.transforms()[2].scale, 1);
  p.gesture('tap').onEnd({ x: 150, y: 300 }, true); p.render();
  p.screen.find((node) => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 600, height: 300 } } }); p.render();
  assert.equal(p.transforms()[2].scale, 1); assert.equal(p.transforms()[0].translateX, 0);
});

test('pinch tracks its focal point and never turns a two-finger gesture into photo paging', () => {
  const p = photoSurface();
  p.gesture('pan').onStart({ numberOfPointers: 1 });
  p.gesture('pinch').onStart({ focalX: 100, focalY: 200 });
  p.gesture('pinch').onUpdate({ scale: 2, focalX: 100, focalY: 200 }); p.render();
  assert.equal(p.transforms()[2].scale, 2); assert.equal(p.transforms()[0].translateX, 50); assert.equal(p.transforms()[1].translateY, 100);
  p.gesture('pinch').onUpdate({ scale: 0.1, focalX: 100, focalY: 200 });
  p.gesture('pinch').onFinalize();
  p.gesture('pan').onEnd({ translationX: -100, translationY: 0, velocityX: -900 });
  assert.equal(p.moves.length, 0);
  p.gesture('pan').onStart({ numberOfPointers: 1 });
  p.gesture('pan').onEnd({ translationX: -100, translationY: 0, velocityX: -900 }); assert.deepEqual(p.moves, [1]);
});

test('home opens a gallery with one add action, children are separate, and account sheet keeps existing logout', async () => {
  const paths = [], exits = [];
  const auth = { session: { user: { id: 'u', email: 'test@example.invalid' } }, family: { status: 'ready', family: { id: 'f', name: 'Family' }, children: [] }, signOut: async () => { exits.push(true); return null; } };
  const screen = screenHarness('src/app/home.tsx', { 'expo-router': { useRouter: () => ({ push: (path) => paths.push(path) }) },
    '../components/family-memory-feed': { FamilyMemoryFeed: 'FamilyMemoryFeed' }, '../lib/auth-context': { useAuth: () => auth } }, 'FamilyHome');
  screen.render(); assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.showAddButton, false);
  assert.equal(screen.find((node) => node.type === 'FamilyMemoryFeed').props.initialView, 'gallery');
  screen.button('Добавить воспоминание').onPress(); assert.deepEqual(paths, ['/memory/new']);
  screen.button('Семья').onPress(); screen.render(); screen.button('Добавить ребёнка').onPress(); assert.equal(paths[1], '/child/new');
  screen.button('Открыть аккаунт').onPress(); screen.render(); assert.equal(screen.find((node) => node.type === 'Modal').props.visible, true);
  await screen.button('Выйти из аккаунта').onPress(); assert.equal(exits.length, 1);
});

test('welcome uses real responsive controls, not text baked into a screen-sized image', () => {
  const paths = [];
  const screen = screenHarness('src/app/index.tsx', { 'expo-router': { useRouter: () => ({ push: (path) => paths.push(path) }) } });
  screen.render(); screen.button('Создать аккаунт').onPress(); screen.button('У меня уже есть аккаунт').onPress();
  assert.deepEqual(paths, ['/register', '/login']);
});

test('accessible zoom requests are scoped to a photo; late old-photo zoom cannot change the new photo UI', () => {
  const photos = ['one', 'two'].map((id) => ({ id, signed_url: 'https://private.invalid/' + id }));
  const screen = screenHarness('src/components/photo-viewer.tsx', { 'expo-status-bar': { StatusBar: 'StatusBar' } }, 'PhotoViewer');
  const render = () => screen.render({ photos, initialId: 'one', title: 'Memory', caption: '', onClose() {} });
  const surface = () => screen.find((node) => node.type?.name === 'ZoomablePhoto').props;
  render(); screen.button('Увеличить фото').onPress(); render(); const oldZoom = surface().onZoom;
  assert.equal(surface().zoomVersion, 1);
  surface().onZoom(true); render(); screen.button('Сбросить увеличение').onPress(); render(); assert.equal(surface().resetVersion, 1);
  screen.button('Открыть фото 2').onPress(); render(); render(); assert.equal(surface().zoomVersion, 0);
  oldZoom(true); render(); screen.button('Увеличить фото');
});

function photoViewer() {
  const props = { photos: ['one', 'two', 'three'].map((id) => ({ id, signed_url: 'https://private.invalid/' + id })),
    initialId: 'one', title: 'Fixture', caption: '', onClose() {} };
  const screen = screenHarness('src/components/photo-viewer.tsx', {}, 'PhotoViewer');
  const render = () => screen.render(props);
  const surface = () => screen.find((node) => node.type?.name === 'ZoomablePhoto').props;
  render(); render();
  return { screen, props, render, surface };
}

test('late load/error of a previous photo cannot hide or relabel the current photo', () => {
  const h = photoViewer(), old = h.surface();
  h.screen.button('Открыть фото 2').onPress(); h.render(); h.render();
  h.surface().onLoad(); h.render();
  old.onLoadStart(); old.onError(); h.render();
  assert.equal(h.surface().uri, 'https://private.invalid/two');
  assert.throws(() => h.screen.find((node) => node.type === 'ActivityIndicator'));
  h.surface().onError(); h.render();
  h.screen.find((node) => node.type === 'Text' && node.props.children === 'Не удалось открыть фото');
  h.screen.button('Открыть фото 3').onPress(); h.render(); h.render();
  assert.equal(h.surface().uri, 'https://private.invalid/three');
});

test('queued swipe of a removed photo never advances the newly selected photo', () => {
  const h = photoViewer(), oldMove = h.surface().onMove;
  h.screen.button('Открыть фото 2').onPress(); h.render(); h.render();
  oldMove(1); h.render(); assert.equal(h.surface().uri, 'https://private.invalid/two');
  h.surface().onMove(1); h.render(); assert.equal(h.surface().uri, 'https://private.invalid/three');
});

test('closed/unmounted photo viewer rejects late callbacks and uses the latest close callback once', () => {
  const h = photoViewer(), old = h.surface();
  let closes = 0; h.props.onClose = () => { closes++; }; h.render();
  h.screen.button('Закрыть фотографию').onPress();
  h.screen.find((node) => node.type === 'Modal').props.onRequestClose(); assert.equal(closes, 1);
  const writes = h.screen.stateWrites;
  old.onLoadStart(); old.onLoad(); old.onError(); old.onZoom(true); old.onMove(1);
  assert.equal(h.screen.stateWrites, writes);
  h.screen.unmount(); old.onLoadStart(); old.onError(); old.onZoom(true); old.onMove(1);
  assert.equal(h.screen.stateWrites, writes);
});
