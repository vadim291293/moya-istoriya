const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const state = { players: [], downloads: [], deleted: [], cancelled: 0, remoteError: true, delayed: null, oversized: false };
  const frame = { nativeImage: 'real fixture image' };
  const fs = { cacheDirectory: 'file:///private/cache/', deleteAsync: async uri => state.deleted.push(uri),
    getInfoAsync: async () => ({ exists: true, size: 200 }),
    createDownloadResumable: (uri, target, options, progress) => {
      state.downloads.push({ uri, target });
      return { downloadAsync: async () => {
        if (state.oversized) progress({ totalBytesWritten: 1, totalBytesExpectedToWrite: 52428801 });
        if (state.delayed) await state.delayed();
        return { uri: target, status: 200 };
      }, cancelAsync: async () => { state.cancelled++; } };
    } };
  const native = { createVideoPlayer: source => {
    const p = { source, status: 'readyToPlay', duration: 14, released: 0, calls: [],
      release() { p.released++; }, addListener: () => ({ remove() {} }), replaceAsync: async value => { p.source = value; },
      generateThumbnailsAsync: async (times, options) => {
        assert.ok(Array.isArray(times), 'native receives a list, never scalar'); p.calls.push({ times, options });
        if (p.source?.uri.startsWith('https:') && state.remoteError) throw new Error('Streaming metadata failed');
        return [frame];
      } }; state.players.push(p); return p;
  } };
  const create = loadTypescript('src/lib/video-poster-player.ts', { 'expo-video': native, 'expo-file-system/legacy': fs,
    'expo-crypto': { randomUUID: () => 'synthetic-id' } }).nativePosterPlayer;
  return { state, create, frame };
}
const url = 'https://private.example.invalid/video.mov?token=fixture';
const dimensions = { maxWidth: 480, maxHeight: 480 };
test('failed streaming poster retries a real local frame, downloads once and removes its own temporary file', async () => {
  const h = harness(); const player = h.create(url);
  const images = await player.generateThumbnailsAsync([0.5], dimensions); assert.equal(images[0], h.frame);
  await player.generateThumbnailsAsync([0], dimensions); assert.equal(h.state.downloads.length, 1);
  assert.equal(h.state.downloads[0].target, 'file:///private/cache/moya-poster-synthetic-id.mov');
  assert.equal(h.state.players[0].released, 1); assert.equal(h.state.players[1].source.useCaching, false);
  assert.equal(h.state.players[1].staysActiveInBackground, false);
  player.release(); player.release(); await flush();
  assert.deepEqual(h.state.players.map(p => p.released), [1, 1]); assert.ok(h.state.deleted.includes(h.state.downloads[0].target));
});
test('a successful remote frame creates no local file/download or disk cache', async () => {
  const h = harness(); h.state.remoteError = false; const player = h.create(url);
  assert.equal((await player.generateThumbnailsAsync([0.5], dimensions))[0], h.frame);
  assert.equal(h.state.downloads.length, 0); player.release(); assert.equal(h.state.players[0].released, 1);
});
test('cancel/background disposes a pending download, ignores its late result and removes only the owned temp URI', async () => {
  const h = harness(); let resolve; h.state.delayed = () => new Promise(done => { resolve = done; });
  const player = h.create(url); const pending = player.generateThumbnailsAsync([0], dimensions); await flush();
  player.release(); resolve(); await assert.rejects(pending); await flush();
  assert.equal(h.state.players.length, 1); assert.ok(h.state.cancelled > 0);
  assert.ok(h.state.deleted.length > 0 && h.state.deleted.every(uri => uri === h.state.downloads[0].target));
});
test('oversized or non-HTTPS fallback never creates a local decoder', async () => {
  const h = harness(); h.state.oversized = true; const player = h.create(url);
  await assert.rejects(player.generateThumbnailsAsync([0], dimensions)); assert.equal(h.state.players.length, 1); player.release();
  const other = harness(); const invalid = other.create('http://private.example.invalid/clip');
  other.state.players[0].generateThumbnailsAsync = async () => { throw new Error('No frame'); };
  await assert.rejects(invalid.generateThumbnailsAsync([0], dimensions)); assert.equal(other.state.downloads.length, 0); invalid.release();
});
