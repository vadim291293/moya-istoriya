const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const RN = () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
  StyleSheet: { create: value => value }, Platform: { OS: 'android' } });
function recorderHarness() {
  const state = { focused: true, granted: true, voices: [], busy: [], modes: [], recorded: [], stopped: 0, event: null, listeners: [], nativeRecording: false, delay: null };
  const recorder = { uri: 'file:///private/cache/Audio/recording-fixture.m4a',
    prepareToRecordAsync: async () => {}, record: options => { state.recorded.push(options); state.nativeRecording = true; },
    stop: async () => { state.stopped++; state.nativeRecording = false; }, getStatus: () => ({ isRecording: state.nativeRecording }) };
  const screen = screenHarness('src/components/voice-recorder.tsx', {
    'react-native': { ...RN(), AppState: { currentState: 'active', addEventListener: (_name, callback) => { state.listeners.push(callback); return { remove() {} }; } } },
    'expo-router': { useIsFocused: () => state.focused },
    'expo-audio': { RecordingPresets: { HIGH_QUALITY: {} }, useAudioRecorder: (_options, callback) => { state.event = callback; return recorder; },
      useAudioRecorderState: () => ({ durationMillis: 1000 }),
      AudioModule: { requestRecordingPermissionsAsync: async () => state.delay ? state.delay() : ({ granted: state.granted }) },
      setAudioModeAsync: async mode => state.modes.push(mode) },
  }, 'VoiceRecorder');
  const props = { disabled: false, canAdd: true, onChange: voice => state.voices.push(voice), onBusyChange: busy => state.busy.push(busy) };
  screen.render(props); screen.render(); return { state, screen, props };
}
test('voice UI asks microphone only after a tap, records at most 180 seconds and stops/attaches once', async () => {
  const h = recorderHarness(); assert.equal(h.state.recorded.length, 0);
  const start = h.screen.button('Записать голос').onPress; start(); start(); await flush(); h.screen.render();
  assert.equal(h.state.recorded.length, 1); assert.equal(h.state.recorded[0].forDuration, 180);
  h.screen.button('Остановить запись голоса').onPress(); await flush(); h.screen.render();
  assert.equal(h.state.stopped, 1); assert.equal(h.state.voices[0].mimeType, 'audio/mp4'); assert.equal(h.state.voices[0].type, 'audio');
  assert.ok(h.state.modes.every(mode => mode.shouldPlayInBackground === false && mode.allowsBackgroundRecording === false));
  h.screen.unmount();
});
test('background stops mic, while permission resolving after unmount cannot start it or set UI state', async () => {
  const h = recorderHarness(); h.screen.button('Записать голос').onPress(); await flush(); h.screen.render();
  h.state.listeners[0]('background'); await flush(); assert.equal(h.state.stopped, 1); h.screen.unmount();
  const late = recorderHarness(); let resolve; late.state.delay = () => new Promise(done => { resolve = done; });
  late.screen.button('Записать голос').onPress(); await flush(); late.screen.unmount(); const writes = late.screen.stateWrites;
  resolve({ granted: true }); await flush(); assert.equal(late.state.recorded.length, 0); assert.equal(late.screen.stateWrites, writes);
});
test('a late finished event cannot replace the actively recording voice with a previous file', async () => {
  const h = recorderHarness(); h.screen.button('Записать голос').onPress(); await flush(); h.screen.render();
  h.state.event({ isFinished: true, hasError: false, url: 'file:///old.m4a' }); await flush();
  assert.equal(h.state.voices.length, 0);
  h.state.nativeRecording = false; h.state.event({ isFinished: true, hasError: false, url: 'file:///new.m4a' }); await flush();
  assert.equal(h.state.voices[0].uri, 'file:///new.m4a'); h.screen.unmount();
});
test('closing selected audio immediately disables and pauses its player; retained close/edit events are ignored', () => {
  let closes = 0, edits = 0, pauses = 0;
  const screen = screenHarness('src/components/audio-viewer.tsx', { 'expo-router': { useIsFocused: () => true } }, 'AudioViewer');
  const effects = [], useEffect = screen.react.useEffect;
  screen.react.useEffect = (setup, deps) => useEffect(() => {
    const cleanup = setup(); effects.push({ setup, cleanup }); return cleanup;
  }, deps);
  screen.render({ media: { id: 'voice', signed_url: 'private:fixture' }, title: 'Мама', onClose: () => closes++, onEdit: () => edits++ });
  const lifetime = screen.find(node => node.type?.name === 'AudioPlayback').props.lifetime;
  effects[0].cleanup(); assert.equal(lifetime.enabled, false);
  const replayCleanup = effects[0].setup(); assert.equal(lifetime.enabled, true, 'effect replay must keep an open viewer usable');
  lifetime.pause = () => pauses++;
  const close = screen.button('Закрыть голосовую запись').onPress, edit = screen.button('Изменить воспоминание с голосом').onPress;
  close(); assert.equal(lifetime.enabled, false); assert.equal(pauses, 1); assert.equal(closes, 1); edit(); assert.equal(edits, 0);
  replayCleanup(); effects[0].setup(); assert.equal(lifetime.enabled, false, 'a closed viewer cannot be revived');
  screen.unmount(); close(); assert.equal(closes, 1);
});
test('late play promise and native playback cannot restart a closed or background voice', async () => {
  let resolve, plays = 0, pauses = 0, event, appEvent;
  const player = { duration: 14, currentTime: 0, playing: false, pause: () => pauses++, play: () => plays++, seekTo: async () => {},
    addListener: (_name, callback) => { event = callback; return { remove() {} }; } };
  const screen = screenHarness('src/components/audio-playback.tsx', {
    'react-native': { ...RN(), AppState: { currentState: 'active', addEventListener: (_name, callback) => { appEvent = callback; return { remove() {} }; } } },
    'expo-router': { useIsFocused: () => true },
    'expo-audio': { useAudioPlayer: () => player, useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 14 }),
      setAudioModeAsync: () => new Promise(done => { resolve = done; }) },
  }, 'AudioPlayback');
  const lifetime = { enabled: true }; screen.render({ uri: 'private:voice', lifetime });
  const tap = screen.button('Прослушать голос').onPress; tap(); lifetime.enabled = false; resolve(); await flush(); assert.equal(plays, 0);
  event({ playing: true }); assert.ok(pauses > 0);
  lifetime.enabled = true; tap(); appEvent('background'); resolve(); await flush(); assert.equal(plays, 0);
  screen.unmount(); tap(); assert.equal(plays, 0);
});
