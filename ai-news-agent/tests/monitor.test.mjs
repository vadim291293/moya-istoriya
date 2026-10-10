import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, initialState, makeMessages, byteLength, validateDecisions, digest } from '../function/core.mjs';
import { createHandler, runMonitor } from '../function/worker.mjs';

const source = { id: 'openai', allowed_host: 'openai.com', initialized: false };
const item = { id: 'one', source_id: 'openai', url: 'https://openai.com/news/new-model',
  title: 'Introducing a new model', excerpt: 'Introducing a new model with better tools.', attempts: 0 };
const decision = { id: 'one', important: true, score: 9, duplicate_of: null,
  event_key: 'openai-new-model', title: 'Вышла новая модель', what: 'Обновились инструменты.',
  why: 'Можно попробовать новые возможности.', action: 'Открой объявление.', evidence: 'Introducing a new model' };

test('RSS and Atom accept only source-owned HTTPS links and remove tracking', () => {
  const rss = `<rss><channel><item><title>Release &amp; tools</title><link>https://openai.com/news/new?utm_source=test</link><description><![CDATA[<p>New tools</p>]]></description><pubDate>Fri, 09 Oct 2026 17:00:00 GMT</pubDate></item><item><title>Bad</title><link>https://openai.com.evil.example/news</link></item></channel></rss>`;
  const entries = parseFeed(rss, source);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://openai.com/news/new');
  assert.equal(entries[0].title, 'Release & tools');
  assert.equal(entries[0].excerpt, 'New tools');
  const atom = `<feed><entry><title>Model</title><link rel="self" href="https://openai.com/feed/1"/><link rel="alternate" href="https://openai.com/news/model"/><summary>New model</summary></entry></feed>`;
  assert.equal(parseFeed(atom, source)[0].url, 'https://openai.com/news/model');
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY a "bad">]><rss/>', source));
});
test('first scan skips existing history, but accepts a release published after activation', () => {
  const now = Date.parse('2026-10-09T18:00:00Z');
  const started = '2026-10-09T17:00:00Z';
  assert.equal(initialState({ published_at: '2026-10-08T12:00:00Z' }, source, started, now), 'baseline');
  assert.equal(initialState({ published_at: '2026-10-09T17:30:00Z' }, source, started, now), 'pending');
  assert.equal(initialState({ published_at: null }, source, started, now), 'baseline');
  assert.equal(initialState({ published_at: '2026-10-01T12:00:00Z' }, { ...source, initialized: true }, started, now), 'skipped');
});
test('two large candidates stay inside the per-minute reservation allowance', () => {
  const items = [item, { ...item, id: 'two', title: 'Ж'.repeat(500), excerpt: 'Ж'.repeat(5000) }];
  const recent = Array.from({ length: 8 }, (_, i) => ({ id: String(i), title: 'Ж'.repeat(500), event_key: 'past-event-' + i }));
  const messages = makeMessages(items, recent);
  const reserve = messages.reduce((sum, message) => sum + byteLength(message.content), 0) + 1600 + 256;
  assert.ok(reserve <= 7000);
});
test('unsupported assertions and invented evidence cannot produce alerts', () => {
  const valid = validateDecisions(JSON.stringify({ results: [decision] }), [item], []);
  assert.equal(valid[0].important, true);
  const invented = validateDecisions(JSON.stringify({ results: [{ ...decision, evidence: 'The model is free for everyone' }] }), [item], []);
  assert.equal(invented[0].important, false);
  assert.throws(() => validateDecisions(JSON.stringify({ results: [{ ...decision, id: 'invented' }] }), [item], []));
  const duplicate = validateDecisions(JSON.stringify({ results: [{ ...decision, duplicate_of: 'past' }] }), [item], [{ id: 'past' }]);
  assert.equal(duplicate[0].duplicate_of, 'past');
});
test('requests without the private scheduler token do not access the database or providers', async () => {
  let calls = 0;
  const handler = createHandler(() => ({}), async () => { calls++; throw new Error(); });
  const response = await handler(new Request('https://example.test', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});
test('status with modern secret keys uses apikey only and reports missing credentials', async () => {
  const token = 'a'.repeat(64);
  const hash = await digest(token);
  const handler = createHandler(() => ({ SUPABASE_URL: 'https://example.test',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test' }) }), async (url, options) => {
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json([{ scheduler_token_hash: hash, enabled: false, model: 'test', telegram_chat_id: null }]);
  });
  const response = await handler(new Request('https://example.test', { method: 'POST',
    headers: { 'x-news-token': token }, body: JSON.stringify({ action: 'status' }) }));
  const data = await response.json();
  assert.equal(data.enabled, false);
  assert.deepEqual(data.missing, ['GROQ_API_KEY', 'TELEGRAM_BOT_TOKEN']);
});

function fakeDb({ pending = [], ready = [], budget = true } = {}) {
  const updates = [];
  return { updates,
    async rpc(name) { return name === 'news_begin_run' ? true : budget ? 'reservation' : null; },
    async read(path) {
      if (path.startsWith('news_sources')) return [];
      if (path.startsWith('news_items?state=eq.pending')) return pending;
      if (path.startsWith('news_items?state=eq.ready')) return ready.filter(item => item.state === 'ready');
      return [];
    },
    async update(path, data) {
      updates.push({ path, data });
      for (const item of [...pending, ...ready]) if (path === 'news_items?id=eq.' + item.id) Object.assign(item, data);
      if (path === 'news_items?state=eq.sending') for (const item of ready) if (item.state === 'sending') Object.assign(item, data);
    }, async insert() {}
  };
}
test('empty scan consumes zero model calls and sends zero Telegram messages', async () => {
  let calls = 0;
  const result = await runMonitor(fakeDb(), {}, {}, async () => { calls++; throw new Error(); });
  assert.equal(result.status, 'ok');
  assert.equal(result.evaluated, 0);
  assert.equal(result.sent, 0);
  assert.equal(calls, 0);
});
test('daily quota exhaustion keeps unprocessed news pending and makes no provider call', async () => {
  const pending = [{ ...item }];
  let calls = 0;
  const result = await runMonitor(fakeDb({ pending, budget: false }), {}, {}, async () => { calls++; throw new Error(); });
  assert.equal(result.budget_exhausted, true);
  assert.equal(pending[0].attempts, 0);
  assert.equal(calls, 0);
});
test('provider 429 preserves pending news without spending its failure retries', async () => {
  const pending = [{ ...item }];
  const db = fakeDb({ pending });
  const result = await runMonitor(db, { model: 'test' }, { GROQ_API_KEY: 'test' }, async () =>
    new Response('{}', { status: 429, headers: { 'retry-after': '120' } }));
  assert.equal(result.status, 'model_rate_limit');
  assert.equal(pending[0].attempts, 0);
  assert.ok(db.updates.some(update => update.data.used_tokens === 0));
});
test('unknown Telegram delivery is not resent on the next scan', async () => {
  const ready = [{ ...item, state: 'ready', decision }];
  const db = fakeDb({ ready });
  let attempts = 0;
  const failDelivery = async () => { attempts++; throw new Error('timeout'); };
  await runMonitor(db, { telegram_chat_id: '1' }, { TELEGRAM_BOT_TOKEN: 'test' }, failDelivery);
  assert.equal(ready[0].state, 'uncertain');
  await runMonitor(db, { telegram_chat_id: '1' }, { TELEGRAM_BOT_TOKEN: 'test' }, failDelivery);
  assert.equal(attempts, 1);
});
