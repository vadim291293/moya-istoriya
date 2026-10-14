const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const moduleUnderTest = () => loadTypescript('src/lib/video-poster-queue.ts', {}, { setTimeout, clearTimeout });

test('native SDK receives an array and a failed seek frame retries the initial frame without duplicate extractors', async () => {
  const calls = []; let releases = 0;
  const queue = moduleUnderTest().createVideoPosterQueue(() => ({ status: 'readyToPlay', duration: 14,
    release() { releases++; }, onStatus() { return { remove() {} }; },
    generateThumbnailsAsync: async times => {
      assert.ok(Array.isArray(times)); calls.push(Array.from(times));
      if (times[0] > 0) throw new Error('Seek frame unavailable'); return [{ frame: 'first' }];
    } }));
  assert.equal((await queue.get('private:fixture')).frame, 'first'); assert.deepEqual(calls, [[0.5], [0]]);
  assert.equal(releases, 1); queue.dispose();
});

test('poster extraction is serial and deduplicated; cache is memory-only and release occurs once per extractor', async () => {
  const native = [];
  const queue = moduleUnderTest().createVideoPosterQueue(uri => {
    const state = { uri, released: 0, resolves: null }; native.push(state);
    return { status: 'readyToPlay', duration: 14, release() { state.released++; }, onStatus() { return { remove() {} }; },
      generateThumbnailsAsync: () => new Promise(resolve => { state.resolves = resolve; }) };
  });
  const a = queue.get('private:a'), same = queue.get('private:a'), b = queue.get('private:b');
  assert.equal(a, same); await flush(); assert.equal(native.length, 1);
  const poster = { frame: 'actual image reference' }; native[0].resolves([poster]); assert.equal(await a, poster);
  await flush(); assert.equal(native.length, 2); assert.equal(native[0].released, 1);
  native[1].resolves([{ frame: 'b' }]); await b;
  assert.equal(await queue.get('private:a'), poster); assert.equal(native.length, 2);
  queue.dispose(); assert.equal(await queue.get('private:a'), null);
});

test('disposal cancels active and queued requests, releases player and ignores late native images', async () => {
  let resolve; let created = 0, releases = 0;
  const queue = moduleUnderTest().createVideoPosterQueue(() => {
    created++;
    return { status: 'readyToPlay', duration: 1, release() { releases++; }, onStatus() { return { remove() {} }; },
      generateThumbnailsAsync: () => new Promise(done => { resolve = done; }) };
  });
  const a = queue.get('a'), b = queue.get('b'); await flush(); queue.dispose();
  assert.equal(await a, null); assert.equal(await b, null); assert.equal(created, 1); assert.equal(releases, 1);
  resolve([{ private: true }]); await flush(); assert.equal(releases, 1);
});

test('unsupported/failed/timed-out thumbnail generation degrades to a playable row and releases native resources', async () => {
  let releases = 0;
  for (const status of ['error', 'loading', 'readyToPlay']) {
    const queue = moduleUnderTest().createVideoPosterQueue(() => ({ status, duration: 1,
      release() { releases++; }, onStatus() { return { remove() {} }; },
      generateThumbnailsAsync: async () => { throw new Error('Unsupported codec'); } }), 5);
    assert.equal(await queue.get(status), null); queue.dispose();
  }
  assert.equal(releases, 3);
});
