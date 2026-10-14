const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const state = { active: true, current: true, phases: [], errors: [], voices: [], modes: [], prepared: 0, recorded: 0, stopped: 0, allowed: true };
  const voice = { uri: 'file:///cache/Audio/voice.m4a', type: 'audio', width: 0, height: 0, mimeType: 'audio/mp4', fileName: 'voice.m4a', fileSize: 128 };
  const deps = { active: () => state.active, canPublish: () => state.current,
    permission: async () => state.allowed, mode: async recording => state.modes.push(recording),
    prepare: async () => { state.prepared++; }, record: () => { state.recorded++; }, stop: async () => { state.stopped++; },
    uri: () => voice.uri, asset: async () => voice, phase: phase => state.phases.push(phase),
    error: message => state.errors.push(message), accept: asset => state.voices.push(asset) };
  const factory = loadTypescript('src/lib/voice-capture.ts').createVoiceCapture;
  return { state, deps, voice, capture: factory(deps), factory };
}
test('voice starts only on demand, blocks double taps, stops once and attaches the actual file', async () => {
  const h = fixture(); assert.equal(h.state.recorded, 0);
  await Promise.all([h.capture.start(), h.capture.start()]); assert.equal(h.state.recorded, 1);
  assert.equal(h.capture.phase, 'recording');
  await Promise.all([h.capture.stop(), h.capture.stop()]);
  assert.equal(h.state.stopped, 1); assert.equal(h.state.voices[0], h.voice);
  assert.deepEqual(h.state.modes, [true, false]); assert.equal(h.capture.phase, 'idle');
});
test('denied permission never prepares or opens microphone; no voice is attached', async () => {
  const h = fixture(); h.state.allowed = false; await h.capture.start();
  assert.equal(h.state.prepared, 0); assert.equal(h.state.recorded, 0); assert.equal(h.state.voices.length, 0);
  assert.match(h.state.errors[0], /микрофон/); assert.equal(h.capture.phase, 'idle');
});
test('leaving during permission or preparation cannot start a microphone or publish a late asset', async () => {
  for (const boundary of ['permission', 'prepare']) {
    const h = fixture(); let resolve;
    h.deps[boundary] = () => new Promise(done => { resolve = done; });
    const starting = h.capture.start(); await flush();
    h.state.active = false; h.state.current = false; h.capture.cancel(); resolve(true); await starting;
    assert.equal(h.state.recorded, 0); assert.equal(h.state.voices.length, 0); assert.equal(h.capture.phase, 'idle');
  }
});
test('cancel during stop discards a late file and a new recorder cannot overtake old preparation', async () => {
  const h = fixture(); let resolve;
  h.deps.prepare = () => new Promise(done => { resolve = done; });
  const starting = h.capture.start(); await flush();
  const next = h.factory(h.deps); await next.start(); assert.equal(h.state.recorded, 0);
  h.capture.cancel(); resolve(); await starting;
  h.deps.prepare = async () => {};
  await next.start(); assert.equal(h.state.recorded, 1);
  let stop; h.deps.stop = () => new Promise(done => { stop = done; });
  const stopping = next.stop(); next.cancel(); stop(); await stopping;
  assert.equal(h.state.voices.length, 0); assert.equal(next.phase, 'idle');
});
