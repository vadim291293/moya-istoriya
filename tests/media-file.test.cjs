const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const limit = 52428800;

test('native reader checks real local size before allocating, not just picker hints', async () => {
  let reads = 0;
  const reader = loadTypescript('src/lib/media-file.native.ts', {
    'expo-file-system': { File: class {
      constructor(uri) { this.uri = uri; this.size = limit + 1; }
      async arrayBuffer() { reads++; return new ArrayBuffer(8); }
    } },
  });
  await assert.rejects(reader.readPickedMedia({ uri: 'file:///huge.mov', fileSize: 8 }, limit), /File too large/);
  assert.equal(reads, 0);
});

test('native reader allows exact limit and preserves original bytes/URI', async () => {
  const seen = [], bytes = new ArrayBuffer(8);
  const reader = loadTypescript('src/lib/media-file.native.ts', {
    'expo-file-system': { File: class {
      constructor(uri) { seen.push(uri); this.size = limit; }
      async arrayBuffer() { return bytes; }
    } },
  });
  assert.equal(await reader.readPickedMedia({ uri: 'file:///original.heic' }, limit), bytes);
  assert.deepEqual(seen, ['file:///original.heic']);
});

test('native reader propagates a disappeared or unreadable gallery file without fallback bytes', async () => {
  const reader = loadTypescript('src/lib/media-file.native.ts', {
    'expo-file-system': { File: class { size = 0; async arrayBuffer() { throw new Error('File unavailable'); } } },
  });
  await assert.rejects(reader.readPickedMedia({ uri: 'file:///removed.jpg' }, limit), /File unavailable/);
});

test('web File size is checked before reading and the original selected bytes are reused', async () => {
  const reader = loadTypescript('src/lib/media-file.ts', {}, { fetch: () => { throw new Error('Unexpected fetch'); } });
  let reads = 0; const bytes = new ArrayBuffer(8);
  const file = { size: limit + 1, arrayBuffer: async () => { reads++; return bytes; } };
  await assert.rejects(reader.readPickedMedia({ file }, limit), /File too large/); assert.equal(reads, 0);
  file.size = limit;
  assert.equal(await reader.readPickedMedia({ file }, limit), bytes); assert.equal(reads, 1);
});

test('web URI rejects a failed fetch or advertised oversized body before reading it', async () => {
  for (const [ok, size, message] of [[false, null, /Не удалось прочитать/], [true, String(limit + 1), /File too large/]]) {
    let reads = 0;
    const reader = loadTypescript('src/lib/media-file.ts', {}, { fetch: async () => ({ ok,
      headers: { get: () => size }, arrayBuffer: async () => { reads++; return new ArrayBuffer(8); },
    }) });
    await assert.rejects(reader.readPickedMedia({ uri: 'blob:fixture' }, limit), message); assert.equal(reads, 0);
  }
});

test('web URI without length still reads original bytes for the service final size check', async () => {
  const bytes = new ArrayBuffer(8);
  const reader = loadTypescript('src/lib/media-file.ts', {}, { fetch: async () => ({ ok: true,
    headers: { get: () => null }, arrayBuffer: async () => bytes,
  }) });
  assert.equal(await reader.readPickedMedia({ uri: 'blob:fixture' }, limit), bytes);
});
