const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');

function nativeMocks(state) {
  const native = Object.fromEntries(['ActivityIndicator', 'Image', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name]));
  native.StyleSheet = { create: (styles) => styles };
  native.AppState = { currentState: state.appState ?? 'active', addEventListener: (_event, handler) => {
    const entry = { handler, removed: false }; state.appSubscriptions.push(entry);
    return { remove: () => { entry.removed = true; } };
  } };
  return native;
}

function viewer({ status = 'readyToPlay', focused = true, appState = 'active', signedUrl = 'https://private.invalid/clip' } = {}) {
  const state = { status, focused, appState, plays: 0, pauses: 0, closes: 0,
    playError: false, pauseError: false, playing: false, currentTime: 0, duration: 14,
    timers: [], appSubscriptions: [], playbackSubscriptions: [], sources: [] };
  const player = {
    get status() { return state.status; },
    get playing() { return state.playing; }, get currentTime() { return state.currentTime; },
    set currentTime(value) { state.currentTime = value; }, get duration() { return state.duration; },
    play() { state.plays++; if (state.playError) throw new Error('Playback unavailable'); state.playing = true; },
    pause() { state.pauses++; if (state.pauseError) throw new Error('Already released'); state.playing = false; },
    addListener(event, handler) {
      assert.equal(event, 'playingChange');
      const entry = { handler, removed: false }; state.playbackSubscriptions.push(entry);
      return { remove: () => { entry.removed = true; } };
    },
  };
  let initialized = false;
  const screen = screenHarness('src/components/video-viewer.tsx', {
    'react-native': nativeMocks(state), 'expo-router': { useIsFocused: () => state.focused },
    'expo': { useEvent: (_player, event) => event === 'statusChange' ? { status: state.status }
      : event === 'playingChange' ? { isPlaying: state.playing }
        : event === 'timeUpdate' ? { currentTime: state.currentTime } : { duration: state.duration } },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: (source, setup) => {
      state.sources.push(source);
      if (!initialized) { initialized = true; setup?.(player); }
      return player;
    } },
  }, 'VideoViewer', { setTimeout: (callback) => { const timer = { callback, removed: false }; state.timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.removed = true; } });
  const props = { media: { id: 'video', signed_url: signedUrl, media_type: 'video' },
    title: 'Fixture', caption: '15 марта 2024', onClose: () => { state.closes++; } };
  const appChange = (next) => { for (const entry of state.appSubscriptions) if (!entry.removed) entry.handler(next); };
  return { state, player, screen, props, appChange };
}

test('video tap viewer plays once when ready and uses only the private signed URI without persistent cache', () => {
  const h = viewer(); h.screen.render(h.props);
  assert.equal(h.state.plays, 1);
  assert.equal(h.state.sources[0].uri, h.props.media.signed_url); assert.equal(h.state.sources[0].useCaching, false);
  assert.equal(h.player.staysActiveInBackground, false); assert.equal(h.player.showNowPlayingNotification, false);
  const video = h.screen.find((node) => node.type === 'VideoView').props;
  assert.equal(video.nativeControls, false); assert.equal(video.contentFit, 'contain');
  assert.equal(video.allowsPictureInPicture, false); assert.equal(video.startsPictureInPictureAutomatically, false);
  assert.equal(video.fullscreenOptions.enable, false);
});

test('loading waits for ready; buffering/status changes never override a later manual pause', () => {
  const h = viewer({ status: 'loading' }); h.screen.render(h.props);
  assert.equal(h.state.plays, 0);
  h.screen.find((node) => node.type === 'ActivityIndicator');
  h.state.status = 'readyToPlay'; h.screen.render(); assert.equal(h.state.plays, 1);
  h.player.pause();
  h.state.status = 'loading'; h.screen.render();
  h.state.status = 'readyToPlay'; h.screen.render();
  assert.equal(h.state.plays, 1);
});

test('close and Android Back pause synchronously and are idempotent even before rerender', () => {
  const h = viewer(); h.screen.render(h.props);
  h.screen.find((node) => node.type === 'Modal').props.onRequestClose();
  assert.equal(h.state.closes, 1); assert.equal(h.state.pauses, 1);
  h.screen.button('Закрыть видео').onPress(); assert.equal(h.state.closes, 1);
  h.state.playbackSubscriptions[0].handler({ isPlaying: true }); assert.equal(h.state.pauses, 2);
  h.state.status = 'loading'; h.screen.render(); h.state.status = 'readyToPlay'; h.screen.render();
  assert.equal(h.state.plays, 1);
});

test('background/inactive closes video and late ready/native events cannot restart it', () => {
  for (const next of ['inactive', 'background']) {
    const h = viewer({ status: 'loading' }); h.screen.render(h.props);
    h.appChange(next); assert.equal(h.state.closes, 1); assert.equal(h.state.pauses, 1);
    h.appChange('active'); h.state.status = 'readyToPlay'; h.screen.render();
    h.state.playbackSubscriptions[0].handler({ isPlaying: true });
    assert.equal(h.state.plays, 0); assert.equal(h.state.pauses, 2);
  }
});

test('an initially blurred/background viewer never starts; blur closes an already started viewer', () => {
  for (const options of [{ focused: false }, { appState: 'background' }]) {
    const h = viewer(options); h.screen.render(h.props);
    assert.equal(h.state.plays, 0); assert.equal(h.state.closes, 1);
  }
  const h = viewer(); h.screen.render(h.props); h.state.focused = false; h.screen.render();
  assert.equal(h.state.plays, 1); assert.equal(h.state.closes, 1); assert.equal(h.state.pauses, 1);
});

test('unmount removes listeners and safely pauses an already released native player', () => {
  const h = viewer(); h.screen.render(h.props); h.state.pauseError = true;
  assert.doesNotThrow(() => h.screen.unmount());
  assert.equal(h.state.appSubscriptions[0].removed, true); assert.equal(h.state.playbackSubscriptions[0].removed, true);
  assert.doesNotThrow(() => h.state.playbackSubscriptions[0].handler({ isPlaying: true }));
  h.screen.button('Закрыть видео').onPress(); assert.equal(h.state.closes, 0);
});

test('missing link, player error and synchronous play failure show an error, never false playback success', () => {
  for (const options of [{ signedUrl: null }, { status: 'error' }, {}]) {
    const h = viewer(options); if (Object.keys(options).length === 0) h.state.playError = true;
    h.screen.render(h.props); h.screen.render();
    h.screen.find((node) => node.type === 'Text' && node.props.children === 'Не удалось открыть видео');
    assert.throws(() => h.screen.find((node) => node.type === 'VideoView'));
    assert.equal(h.state.plays, h.state.playError ? 1 : 0);
  }
});

test('a new close callback does not recreate playback and the viewer uses the latest callback', () => {
  const h = viewer(); h.screen.render(h.props);
  let latestCloses = 0;
  h.screen.render({ ...h.props, onClose: () => { latestCloses++; } });
  assert.equal(h.state.plays, 1); assert.equal(h.state.pauses, 0);
  h.screen.button('Закрыть видео').onPress(); assert.equal(latestCloses, 1); assert.equal(h.state.closes, 0);
});

test('minimal video controls pause, resume, seek with clamping and never operate after close', () => {
  const h = viewer(); h.screen.render(h.props); h.screen.render();
  h.screen.button('Приостановить видео').onPress(); h.screen.render(); assert.equal(h.state.playing, false);
  h.screen.button('Продолжить видео').onPress(); h.screen.render(); assert.equal(h.state.playing, true);
  const track = h.screen.find(node => node.props?.accessibilityLabel === 'Позиция видео').props;
  track.onLayout({ nativeEvent: { layout: { width: 100 } } });
  track.onResponderGrant({ nativeEvent: { locationX: 50 } }); assert.equal(h.state.currentTime, 7);
  track.onResponderMove({ nativeEvent: { locationX: 200 } }); assert.equal(h.state.currentTime, 14);
  track.onResponderMove({ nativeEvent: { locationX: -10 } }); assert.equal(h.state.currentTime, 0);
  h.screen.button('Закрыть видео').onPress(); const writes = h.screen.stateWrites;
  track.onResponderMove({ nativeEvent: { locationX: 50 } }); assert.equal(h.state.currentTime, 0); assert.equal(h.screen.stateWrites, writes);
  h.screen.unmount();
});

test('controls hide during playback, a tap reveals them, and paused controls stay visible', () => {
  const h = viewer(); h.screen.render(h.props); h.screen.render();
  const timer = h.state.timers.find(timer => !timer.removed); timer.callback(); h.screen.render();
  h.screen.find(node => node.props?.pointerEvents === 'none' && node.props?.importantForAccessibility === 'no-hide-descendants');
  h.screen.button('Показать или скрыть управление видео').onPress(); h.screen.render();
  h.screen.button('Приостановить видео').onPress(); h.screen.render();
  assert.equal(h.state.playing, false);
  h.screen.find(node => node.props?.pointerEvents === 'auto' && node.props?.importantForAccessibility === 'auto');
  h.screen.unmount();
});

test('editing remains available even when the media link is unavailable and held edits are rejected after unmount', () => {
  const h = viewer({ signedUrl: null }); let edits = 0;
  h.screen.render({ ...h.props, onEdit: () => edits++ });
  const edit = h.screen.button('Изменить воспоминание').onPress;
  edit(); assert.equal(edits, 1); h.screen.unmount(); edit(); assert.equal(edits, 1);
});

function card() {
  const state = { focused: true, appSubscriptions: [] };
  const screen = screenHarness('src/components/memory-card.tsx', {
    'react-native': nativeMocks(state), 'expo-router': { useIsFocused: () => state.focused },
    './photo-viewer': { PhotoViewer: 'PhotoViewer' }, './video-viewer': { VideoViewer: 'VideoViewer' },
    'expo-video': { useVideoPlayer: () => { throw new Error('No card should preload a private video'); } },
  }, 'MemoryCard');
  screen.render({ memory: { title: 'Mixed', event_date: '2024-03-15', media: [
    { id: 'photo', media_type: 'image', signed_url: 'https://private.invalid/photo' },
    { id: 'video', media_type: 'video', signed_url: 'https://private.invalid/video' },
  ] } });
  const photo = () => screen.find((node) => node.type?.name === 'Photo').props;
  const video = () => screen.find((node) => node.type?.name === 'VideoPreview').props;
  const hasViewer = (name) => JSON.stringify(screen.render()).includes(`"type":"${name}"`);
  return { state, screen, photo, video, hasViewer };
}

test('card opens the exact video in its own modal, never an inline preloaded player; photo/video do not overlap', () => {
  const h = card(); assert.equal(h.hasViewer('VideoViewer'), false);
  h.video().onPress(); h.screen.render();
  assert.equal(h.screen.find((node) => node.type === 'VideoViewer').props.media.id, 'video');
  assert.equal(h.hasViewer('PhotoViewer'), false);
  h.photo().onPress(); assert.equal(h.hasViewer('PhotoViewer'), true); assert.equal(h.hasViewer('VideoViewer'), false);
  h.video().onPress(); assert.equal(h.hasViewer('PhotoViewer'), false); assert.equal(h.hasViewer('VideoViewer'), true);
  h.screen.find((node) => node.type === 'VideoViewer').props.onClose(); assert.equal(h.hasViewer('VideoViewer'), false);
});

test('card blur/background clears both private viewers and stale taps cannot reopen them', () => {
  for (const kind of ['blur', 'background']) {
    const h = card(), oldPhoto = h.photo(), oldVideo = h.video();
    oldVideo.onPress(); assert.equal(h.hasViewer('VideoViewer'), true);
    if (kind === 'blur') h.state.focused = false;
    else h.state.appSubscriptions[0].handler('background');
    h.screen.render(); h.screen.render(); oldPhoto.onPress(); oldVideo.onPress();
    assert.equal(h.hasViewer('PhotoViewer'), false); assert.equal(h.hasViewer('VideoViewer'), false);
    if (kind === 'blur') h.state.focused = true;
    else h.state.appSubscriptions[0].handler('active');
    assert.equal(h.hasViewer('VideoViewer'), false);
    h.video().onPress(); assert.equal(h.hasViewer('VideoViewer'), true);
  }
});

test('unmounted private card rejects held photo/video handlers', () => {
  const h = card(), oldPhoto = h.photo(), oldVideo = h.video(); h.screen.unmount();
  const writes = h.screen.stateWrites; oldPhoto.onPress(); oldVideo.onPress();
  assert.equal(h.screen.stateWrites, writes); assert.equal(h.state.appSubscriptions[0].removed, true);
});
