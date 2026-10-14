const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function harness(journal = storage()) {
  const state = { uploads: [], removed: [], calls: [], committed: new Set(),
    userId: 'user-a', uploadError: null, rpcError: null, readError: null,
    commitOnError: false, rows: [], signedError: false, mediaReads: 0,
    readMedia: null, afterUpload: null, removeError: null };
  let sequence = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: state.userId }, access_token: 'fixture-token:' + state.userId } }, error: null }) },
    from: () => {
      const filters = {};
      const builder = {
        select: () => builder, order: () => builder,
        eq: (key, value) => { filters[key] = value; return builder; },
        setHeader: () => builder,
        maybeSingle: async () => ({ data: state.committed.has(filters.id) ? { id: filters.id } : null,
          error: state.readError }),
        limit: () => Promise.resolve({ data: state.rows, error: state.readError }),
      };
      return builder;
    },
    rpc: (_name, payload) => {
      const builder = { setHeader: () => builder, then: (resolve, reject) => Promise.resolve().then(() => {
        state.calls.push(payload);
        if (!state.rpcError || state.commitOnError) state.committed.add(payload.p_memory_id);
        return { data: state.rpcError ? null : payload.p_memory_id, error: state.rpcError };
      }).then(resolve, reject) };
      return builder;
    },
    storage: { from: () => ({
      upload: async (path, buffer, options) => {
        state.uploads.push({ path, size: buffer.byteLength, options });
        state.afterUpload?.();
        return { error: state.uploadError };
      },
      remove: async (paths) => { state.removed.push(...paths); return { error: state.removeError }; },
      createSignedUrl: async (path) => ({ data: { signedUrl: `private:${path}` },
        error: state.signedError ? new Error('file unavailable') : null }),
    }) },
  };
  const service = () => loadTypescript('src/lib/memory-service.ts', {
    './supabase': { supabase: client },
    'expo-crypto': { randomUUID: () => `test-uuid-${++sequence}` },
    './media-file': { readPickedMedia: async () => { state.mediaReads++; return state.readMedia ? state.readMedia() : new ArrayBuffer(8); } },
  }, { localStorage: journal });
  return { state, journal, service };
}

const input = () => ({ userId: 'user-a', familyId: 'family-a', childIds: ['child-a', 'child-a'],
  title: 'Первая прогулка', body: 'История', eventDate: '2024-03-15',
  assets: [{ uri: 'file:///photo.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 99 }] });

test('achievement category survives an unknown RPC and restart without a second media upload', async () => {
  const h = harness(); h.state.rpcError = new Error('Offline');
  await assert.rejects(h.service().createFamilyMemory({ ...input(), diaryCategory: 'skills' }), error => error.pending);
  assert.equal(JSON.parse(Array.from(h.journal.values.values())[0]).diaryCategory, 'skills');
  h.state.rpcError = null;
  const id = await h.service().createFamilyMemory({ ...input(), diaryCategory: 'words', assets: [] });
  assert.equal(id, h.state.calls[0].p_memory_id);
  assert.equal(h.state.calls[1].p_diary_category, 'skills'); assert.equal(h.state.uploads.length, 1);
});

test('ordinary media has no diary category, and text-only diary categories reject files before upload', async () => {
  for (const category of ['words', 'quotes', 'moments', 'invalid']) {
    const h = harness();
    await assert.rejects(h.service().createFamilyMemory({ ...input(), diaryCategory: category }));
    assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0);
  }
  const h = harness(); await h.service().createFamilyMemory(input());
  assert.equal('p_diary_category' in h.state.calls[0], false);
});

test('all text diary categories save without Storage uploads; an empty achievement is rejected', async () => {
  for (const category of ['words', 'quotes', 'moments']) {
    const h = harness(); await h.service().createFamilyMemory({ ...input(), assets: [], diaryCategory: category });
    assert.equal(h.state.calls[0].p_diary_category, category); assert.equal(h.state.calls[0].p_memory_type, 'note');
    assert.equal(h.state.uploads.length, 0);
  }
  const h = harness(); await assert.rejects(h.service().createFamilyMemory({ ...input(), title: '', body: '', diaryCategory: 'skills' }));
  assert.equal(h.state.uploads.length, 0);
});

const voiceAsset = () => ({ uri: 'file:///private/voice.m4a', type: 'audio', width: 0, height: 0,
  fileName: 'voice.m4a', mimeType: 'audio/mp4', fileSize: 128 });
test('each diary category stores one private voice as a note, not a photo/video', async () => {
  for (const diaryCategory of ['words', 'skills', 'quotes', 'moments']) {
    const h = harness(); await h.service().createFamilyMemory({ ...input(), diaryCategory, assets: [voiceAsset()] });
    assert.equal(h.state.calls[0].p_diary_category, diaryCategory); assert.equal(h.state.calls[0].p_memory_type, 'note');
    assert.equal(h.state.calls[0].p_media_files[0].media_type, 'audio'); assert.equal(h.state.calls[0].p_media_files[0].mime_type, 'audio/mp4');
    assert.equal(h.state.uploads[0].options.upsert, false); assert.equal(h.state.uploads[0].options.contentType, 'audio/mp4');
    assert.ok(h.state.uploads[0].path.endsWith('.m4a')); assert.equal(h.state.journal?.size ?? h.journal.values.size, 0);
  }
});
test('unknown voice commit restores its exact journal and never reuploads or discards the file', async () => {
  const h = harness(); h.state.rpcError = new Error('Response lost');
  await assert.rejects(h.service().createFamilyMemory({ ...input(), diaryCategory: 'words', assets: [voiceAsset()] }), error => error.pending);
  h.state.rpcError = null; await h.service().createFamilyMemory({ ...input(), diaryCategory: 'skills', assets: [] });
  assert.equal(h.state.uploads.length, 1); assert.equal(h.state.removed.length, 0);
  assert.equal(h.state.calls[1].p_diary_category, 'words'); assert.equal(h.state.calls[1].p_media_files[0].media_type, 'audio');
  assert.equal(h.state.calls[1].p_memory_id, h.state.calls[0].p_memory_id);
});
test('voice is rejected outside diary, when oversized, duplicated, or disguised with incompatible MIME', async () => {
  for (const overrides of [
    { diaryCategory: null }, { assets: [{ ...voiceAsset(), fileSize: 5242881 }] },
    { assets: [voiceAsset(), voiceAsset()] }, { assets: [{ ...voiceAsset(), mimeType: 'video/mp4' }] },
  ]) {
    const h = harness(); await assert.rejects(h.service().createFamilyMemory({ ...input(), diaryCategory: 'words', assets: [voiceAsset()], ...overrides }));
    assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0);
  }
  const h = harness(); h.state.readMedia = () => new ArrayBuffer(5242881);
  await assert.rejects(h.service().createFamilyMemory({ ...input(), diaryCategory: 'words', assets: [voiceAsset()] }));
  assert.equal(h.state.uploads.length, 0);
});

test('successful save uses actual byte size and clears journal', async () => {
  const h = harness();
  const id = await h.service().createFamilyMemory(input());
  assert.equal(h.state.calls[0].p_memory_id, id);
  assert.equal(h.state.calls[0].p_media_files[0].file_size, 8);
  assert.equal(h.state.calls[0].p_child_ids.length, 1);
  assert.equal(h.journal.values.size, 0);
  assert.equal(h.state.removed.length, 0);
});

test('RPC commits but response is lost: reconcile without deleting photo', async () => {
  const h = harness();
  h.state.rpcError = new Error('network response lost');
  h.state.commitOnError = true;
  const id = await h.service().createFamilyMemory(input());
  assert.ok(h.state.committed.has(id));
  assert.equal(h.state.removed.length, 0);
  assert.equal(h.journal.values.size, 0);
});

test('unknown result survives restart, retries same UUID and uploads once', async () => {
  const h = harness();
  h.state.rpcError = new Error('offline');
  await assert.rejects(h.service().createFamilyMemory(input()), (error) => error.pending === true);
  assert.equal(h.journal.values.size, 1);
  const originalId = h.state.calls[0].p_memory_id;
  h.state.rpcError = null;
  const changedForm = { ...input(), title: 'Must not replace original submission' };
  const id = await h.service().createFamilyMemory(changedForm);
  assert.equal(id, originalId);
  assert.equal(h.state.calls[1].p_title, input().title);
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.removed.length, 0);
});

test('committed row found on restart is not submitted twice', async () => {
  const h = harness();
  h.state.rpcError = new Error('offline');
  await assert.rejects(h.service().createFamilyMemory(input()));
  const originalId = h.state.calls[0].p_memory_id;
  h.state.committed.add(originalId);
  assert.equal(await h.service().createFamilyMemory(input()), originalId);
  assert.equal(h.state.calls.length, 1);
});

test('failed reconciliation prevents new submission and keeps uploaded objects', async () => {
  const h = harness();
  h.state.readError = new Error('offline');
  await assert.rejects(h.service().createFamilyMemory(input()), (error) => error.pending === true);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.removed.length, 0);
  assert.equal(h.journal.values.size, 1);
});

test('upload failure rolls back even the upload with an unknown response', async () => {
  const h = harness();
  h.state.uploadError = new Error('lost upload response');
  await assert.rejects(h.service().createFamilyMemory(input()));
  assert.equal(h.state.removed[0], h.state.uploads[0].path);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.journal.values.size, 0);
});

test('journal quota failure stops before RPC and cleans unlinked upload', async () => {
  const journal = storage();
  journal.setItem = () => { throw new Error('quota exceeded'); };
  const h = harness(journal);
  await assert.rejects(h.service().createFamilyMemory(input()));
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.removed.length, 1);
});

test('account changed: no upload, RPC or cleanup of another account', async () => {
  const h = harness();
  h.state.userId = 'user-b';
  await assert.rejects(h.service().createFamilyMemory(input()));
  assert.equal(h.state.uploads.length, 0);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.removed.length, 0);
});

test('pending journal is scoped by user and family', async () => {
  const h = harness();
  h.state.rpcError = new Error('offline');
  const service = h.service();
  await assert.rejects(service.createFamilyMemory(input()));
  assert.ok(service.getPendingFamilyMemory('user-a', 'family-a'));
  assert.equal(service.getPendingFamilyMemory('user-b', 'family-a'), null);
  assert.equal(service.getPendingFamilyMemory('user-a', 'family-b'), null);
});

test('malformed journal is not overwritten by a new save', async () => {
  const h = harness();
  h.journal.setItem('moya-istoriya:pending-memory:v1:user-a:family-a', '{broken');
  await assert.rejects(h.service().createFamilyMemory(input()), (error) => error.pending === true);
  assert.equal(h.state.uploads.length, 0);
  assert.equal(h.journal.values.size, 1);
});

test('unavailable signed URL preserves the parent memory and its text', async () => {
  const h = harness();
  h.state.signedError = true;
  h.state.rows = [{ id: 'memory-a', title: 'Title', body: 'Keep this text', event_date: '2024-03-15',
    memory_type: 'mixed', created_at: '2024-03-15', author_id: 'user-a',
    memory_children: [{ child_id: 'child-a' }],
    media_files: [{ id: 'media-a', storage_path: 'family-a/memory-a/photo.jpg',
      media_type: 'image', mime_type: 'image/jpeg', file_size: 8 }] }];
  const page = await h.service().getFamilyMemories({ familyId: 'family-a' });
  assert.equal(page.items[0].body, 'Keep this text');
  assert.equal(page.items[0].media[0].signed_url, null);
});

test('read failure is described as loading, not saving, and never as an empty successful page', async () => {
  const h = harness(); h.state.readError = new Error('private network diagnostics');
  await assert.rejects(h.service().getFamilyMemories({ familyId: 'family-a' }), (error) => {
    assert.match(error.message, /Не удалось загрузить/);
    assert.ok(!error.message.includes('private network diagnostics')); return true;
  });
});

test('signed URL failure does not lose the cursor or the parent text', async () => {
  const h = harness(); h.state.signedError = true;
  h.state.rows = [1, 2].map((n) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: 'Keep title', body: 'Keep body',
    event_date: '2024-03-15', memory_type: 'mixed', created_at: '2026-10-08T10:00:00.000123+00:00',
    author_id: 'user-a', memory_children: [], media_files: [{ id: 'media-a', storage_path: 'family-a/photo.jpg',
      media_type: 'image', mime_type: 'image/jpeg', file_size: 8 }],
  }));
  const page = await h.service().getFamilyMemories({ familyId: 'family-a', limit: 1 });
  assert.equal(page.items[0].body, 'Keep body'); assert.equal(page.items[0].media[0].signed_url, null);
  assert.equal(page.hasMore, true); assert.equal(page.nextCursor.id, h.state.rows[0].id);
});

test('same-family concurrent save is rejected before duplicate upload', async () => {
  const h = harness();
  const service = h.service();
  const first = service.createFamilyMemory(input());
  const second = service.createFamilyMemory(input());
  await assert.rejects(second);
  await first;
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.calls.length, 1);
});

test('invalid normalized calendar date is rejected before upload', async () => {
  const h = harness();
  await assert.rejects(h.service().createFamilyMemory({ ...input(), eventDate: '2024-02-30' }));
  assert.equal(h.state.uploads.length, 0);
  assert.equal(h.state.calls.length, 0);
});

test('account switch while reading bytes stops before upload', async () => {
  const h = harness();
  h.state.readMedia = () => { h.state.userId = 'user-b'; return new ArrayBuffer(8); };
  await assert.rejects(h.service().createFamilyMemory(input()));
  assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.removed.length, 0); assert.equal(h.journal.values.size, 0);
});

test('account switch after upload never journals/RPCs or cleans files with the next account', async () => {
  for (const count of [1, 2]) {
    const h = harness();
    h.state.afterUpload = () => { h.state.userId = 'user-b'; };
    const attempt = input();
    if (count === 2) attempt.assets.push({ ...attempt.assets[0], uri: 'file:///second.jpg' });
    await assert.rejects(h.service().createFamilyMemory(attempt), (error) => error.cleanupFailed === true);
    assert.equal(h.state.uploads.length, 1); assert.equal(h.state.calls.length, 0);
    assert.equal(h.state.removed.length, 0); assert.equal(h.journal.values.size, 0);
  }
});

test('unsupported second file rejects the selection before any reading/uploading', async () => {
  const h = harness();
  const attempt = input(); attempt.assets.push({ uri: 'file:///file.gif', type: 'image', mimeType: 'image/gif' });
  await assert.rejects(h.service().createFamilyMemory(attempt));
  assert.equal(h.state.mediaReads, 0); assert.equal(h.state.uploads.length, 0); assert.equal(h.state.removed.length, 0);
});

test('known unsupported MIME never masquerades as JPEG based on a misleading name', async () => {
  const h = harness();
  const attempt = input(); attempt.assets[0].mimeType = 'image/avif';
  await assert.rejects(h.service().createFamilyMemory(attempt));
  assert.equal(h.state.uploads.length, 0); assert.equal(h.state.calls.length, 0);
});

test('known oversized metadata stops before loading the full buffer', async () => {
  const h = harness(); const attempt = input(); attempt.assets[0].fileSize = 52428801;
  await assert.rejects(h.service().createFamilyMemory(attempt));
  assert.equal(h.state.mediaReads, 0); assert.equal(h.state.uploads.length, 0);
});

test('actual empty/oversized bytes are rejected even when picker metadata is small', async () => {
  for (const size of [0, 52428801]) {
    const h = harness(); h.state.readMedia = () => ({ byteLength: size });
    await assert.rejects(h.service().createFamilyMemory(input()));
    assert.equal(h.state.mediaReads, 1); assert.equal(h.state.uploads.length, 0);
    assert.equal(h.state.calls.length, 0); assert.equal(h.journal.values.size, 0);
  }
});

test('generic MIME uses a supported extension and explicit MIME is case/parameter normalized', async () => {
  const h = harness(); const attempt = input();
  attempt.assets[0].mimeType = 'application/octet-stream';
  attempt.assets.push({ uri: 'file:///clip.mov', type: 'video', mimeType: 'Video/QuickTime; charset=binary' });
  await h.service().createFamilyMemory(attempt);
  assert.equal(h.state.uploads[0].options.contentType, 'image/jpeg');
  assert.equal(h.state.uploads[1].options.contentType, 'video/quicktime');
  assert.equal(h.state.calls[0].p_memory_type, 'mixed');
  assert.deepEqual(Array.from(h.state.calls[0].p_media_files, (file) => file.media_type), ['image', 'video']);
});

test('image/video kind mismatch fails before reading/uploading any file', async () => {
  for (const [type, mimeType] of [['image', 'video/mp4'], ['video', 'image/jpeg']]) {
    const h = harness(); const attempt = input(); Object.assign(attempt.assets[0], { type, mimeType });
    await assert.rejects(h.service().createFamilyMemory(attempt));
    assert.equal(h.state.mediaReads, 0); assert.equal(h.state.uploads.length, 0);
  }
});

test('progress follows real sequential file stages, then reconcile and save', async () => {
  const h = harness(); const attempt = input(), events = [];
  attempt.assets.push({ ...attempt.assets[0], uri: 'file:///second.jpg' });
  attempt.onProgress = (progress) => events.push({ ...progress });
  await h.service().createFamilyMemory(attempt);
  assert.deepEqual(events, [
    { phase: 'preparing', completedFiles: 0, totalFiles: 2 },
    { phase: 'uploading', completedFiles: 0, totalFiles: 2 },
    { phase: 'preparing', completedFiles: 1, totalFiles: 2 },
    { phase: 'uploading', completedFiles: 1, totalFiles: 2 },
    { phase: 'checking', completedFiles: 2, totalFiles: 2 },
    { phase: 'saving', completedFiles: 2, totalFiles: 2 },
  ]);
});

test('a throwing progress callback never rolls back a valid write', async () => {
  const h = harness(); const attempt = input();
  attempt.onProgress = () => { throw new Error('UI feedback failed'); };
  await h.service().createFamilyMemory(attempt);
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.removed.length, 0);
  assert.equal(h.journal.values.size, 0);
});

test('pending retry reports checking/saving and never reports another file upload', async () => {
  const h = harness(); h.state.rpcError = new Error('offline');
  await assert.rejects(h.service().createFamilyMemory(input()));
  const events = []; h.state.rpcError = null;
  await h.service().createFamilyMemory({ ...input(), onProgress: (progress) => events.push(progress.phase) });
  assert.deepEqual(events, ['checking', 'saving']); assert.equal(h.state.uploads.length, 1);
});

test('failed pre-RPC cleanup reports private leftover files instead of claiming removal', async () => {
  const h = harness(); h.state.uploadError = new Error('upload interrupted'); h.state.removeError = new Error('offline');
  await assert.rejects(h.service().createFamilyMemory(input()), (error) => error.cleanupFailed === true && error.pending === false);
  assert.equal(h.state.calls.length, 0); assert.equal(h.journal.values.size, 0);
});
