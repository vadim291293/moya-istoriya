import { byteLength, parseFeed, initialState, makeMessages, validateDecisions, messageFor, digest } from './core.mjs';
import { parseListing, enrichArticle } from './adapters.mjs';
import { Failure, errorCode, safeJson, deadline, telegram } from './common.mjs';
import { enqueueChat, processChat, previewChat } from './chat.mjs';

export class Database {
  constructor(url, key, fetchImpl = fetch) {
    this.url = url; this.key = key; this.fetch = fetchImpl;
  }
  async request(path, method = 'GET', body, prefer = '') {
    const headers = { apikey: this.key, 'Content-Type': 'application/json' };
    // Modern secret keys go on apikey only; legacy JWTs also need Authorization.
    if (!this.key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + this.key;
    if (prefer) headers.Prefer = prefer;
    let response;
    try { response = await this.fetch(this.url + '/rest/v1/' + path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: deadline(10000) }); }
    catch { throw new Failure('database_unavailable'); }
    if (!response.ok) throw new Failure(response.status === 409 ? 'database_conflict' : 'database_error');
    const content = await response.text();
    if (!content) return null;
    try { return JSON.parse(content); } catch { throw new Failure('invalid_database_json'); }
  }
  read(path) { return this.request(path); }
  insert(table, data, prefer = 'return=minimal') { return this.request(table, 'POST', data, prefer); }
  update(path, data) { return this.request(path, 'PATCH', data, 'return=minimal'); }
  rpc(name, args) { return this.request('rpc/' + name, 'POST', args); }
}
async function readFeed(response) {
  if (!response.body) throw new Failure('empty_feed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2000000) { await reader.cancel(); throw new Failure('feed_too_large'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
async function collect(db, cfg, source, fetchImpl, now) {
  const headers = { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html',
    'User-Agent': 'AI-News-Monitor/1.0 (+https://t.me/vadikAI291293bot)' };
  if (source.etag) headers['If-None-Match'] = source.etag;
  if (source.last_modified) headers['If-Modified-Since'] = source.last_modified;
  try {
    const response = await fetchImpl(source.feed_url, { headers, signal: deadline(12000) });
    if (response.status === 304) {
      await db.update('news_sources?id=eq.' + source.id, { last_success_at: new Date(now).toISOString(), last_error: null });
      return 0;
    }
    if (!response.ok) throw new Failure('feed_http_' + response.status);
    const input = await readFeed(response);
    let entries = source.kind === 'html' ? parseListing(input, source, response.url) : parseFeed(input, source);
    if(source.kind === 'html' && source.initialized) {
      const known = new Set((await db.read('news_items?source_id=eq.'+source.id+'&select=url&order=discovered_at.desc&limit=1000')).map(item=>item.url));
      entries = entries.filter(item=>!known.has(item.url)).slice(0,4);
      const enriched = [];
      for(const item of entries) {
        try {
          const article = await fetchImpl(item.url,{signal:deadline(10000)});
          if(!article.ok) continue;
          enriched.push(enrichArticle(await readFeed(article),item));
        } catch { /* Retry unread articles at the next scan. */ }
      }
      entries = enriched;
    }
    const items = entries.map(item => {
      const state = initialState(item, source, cfg.started_at, now);
      return { ...item, state, excerpt: state === 'baseline' || state === 'skipped' ? '' : item.excerpt };
    }).filter(item => !source.initialized || item.state !== 'skipped');
    for (let offset = 0; offset < items.length; offset += 200) {
      await db.insert('news_items?on_conflict=url', items.slice(offset, offset + 200),
        'resolution=ignore-duplicates,return=minimal');
    }
    await db.update('news_sources?id=eq.' + source.id, { initialized: true,
      etag: response.headers.get('etag'), last_modified: response.headers.get('last-modified'),
      last_success_at: new Date(now).toISOString(), last_error: null });
    return items.length;
  } catch (error) {
    await db.update('news_sources?id=eq.' + source.id, { last_error: errorCode(error) });
    return 0;
  }
}
async function deliver(db, cfg, env, fetchImpl) {
  // A terminated invocation may have sent a message before persisting its receipt.
  // Do not automatically resend such messages.
  await db.update('news_items?state=eq.sending', { state: 'uncertain', last_error: 'previous_delivery_unknown' });
  const ready = await db.read('news_items?state=eq.ready&order=discovered_at.asc&limit=3');
  let sent = 0;
  for (const item of ready) {
    if (!item.decision?.important) {
      await db.update('news_items?id=eq.' + item.id, { state: 'failed', last_error: 'missing_decision' }); continue;
    }
    await db.update('news_items?id=eq.' + item.id, { state: 'sending' });
    try {
      const result = await telegram('sendMessage', { chat_id: cfg.telegram_chat_id,
        text: messageFor(item), link_preview_options: { is_disabled: true } }, env, fetchImpl);
      await db.update('news_items?id=eq.' + item.id, { state: 'sent', telegram_message_id: result.message_id,
        sent_at: new Date().toISOString(), last_error: null });
      sent++;
    } catch (error) {
      const code = errorCode(error);
      const state = code === 'telegram_rate_limit' ? 'ready' :
        code === 'telegram_rejected' ? 'failed' : 'uncertain';
      await db.update('news_items?id=eq.' + item.id, { state, last_error: code });
      if (error.retry) await db.update('news_settings?id=eq.true',
        { blocked_until: new Date(Date.now() + error.retry * 1000).toISOString() });
      break;
    }
  }
  return sent;
}
async function evaluate(db, cfg, runId, env, fetchImpl) {
  const items = await db.read('news_items?state=eq.pending&attempts=lt.3&order=discovered_at.asc&limit=2');
  if (!items.length) return { evaluated: 0 };
  const recent = await db.read('news_items?event_key=not.is.null&state=in.(ready,sending,sent,uncertain)&order=discovered_at.desc&limit=8');
  const messages = makeMessages(items, recent);
  const reserve = messages.reduce((sum, message) => sum + byteLength(message.content), 0) + 1600 + 256;
  if (reserve > 7000) throw new Failure('prompt_too_large');
  const reservation = await db.rpc('news_reserve_tokens', { p_run_id: runId, p_tokens: reserve });
  if (!reservation) return { evaluated: 0, budget_exhausted: true };
  const originalAttempts = new Map(items.map(item => [item.id, item.attempts]));
  for (const item of items) await db.update('news_items?id=eq.' + item.id, { attempts: item.attempts + 1 });
  let response;
  try {
    response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.1, reasoning_effort: 'none',
        max_completion_tokens: 1600, response_format: { type: 'json_object' } }), signal: deadline(25000) });
  } catch { throw new Failure('model_unavailable'); }
  if (response.status === 429) {
    await db.update('news_usage?id=eq.' + reservation, { used_tokens: 0 });
    for (const item of items) await db.update('news_items?id=eq.' + item.id, { attempts: originalAttempts.get(item.id) });
    const seconds = Number(response.headers.get('retry-after'));
    await db.update('news_settings?id=eq.true', { blocked_until: new Date(Date.now() +
      (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000).toISOString() });
    throw new Failure('model_rate_limit');
  }
  if (!response.ok) throw new Failure('model_http_' + response.status);
  const data = await safeJson(response);
  if (Number.isInteger(data.usage?.total_tokens) && data.usage.total_tokens >= 0)
    await db.update('news_usage?id=eq.' + reservation, { used_tokens: data.usage.total_tokens });
  let decisions;
  try { decisions = validateDecisions(data.choices?.[0]?.message?.content, items, recent); }
  catch { throw new Failure('invalid_model_decision'); }
  for (const decision of decisions) {
    const state = decision.duplicate_of ? 'duplicate' : decision.important ? 'ready' : 'reviewed';
    try {
      await db.update('news_items?id=eq.' + decision.id, { state, decision,
        event_key: state === 'ready' ? decision.event_key : null, last_error: null });
    } catch (error) {
      if (errorCode(error) !== 'database_conflict') throw error;
      await db.update('news_items?id=eq.' + decision.id, { state: 'duplicate', decision,
        event_key: null, last_error: null });
    }
  }
  return { evaluated: decisions.length };
}
export async function runMonitor(db, cfg, env, fetchImpl = fetch) {
  const runId = crypto.randomUUID();
  if (!await db.rpc('news_begin_run', { p_run_id: runId })) return { status: 'idle' };
  let status = 'ok', details = {};
  try {
    const sources = await db.read('news_sources?enabled=eq.true');
    const collected = await Promise.all(sources.map(source => collect(db, cfg, source, fetchImpl, Date.now())));
    await db.update('news_items?state=eq.pending&published_at=lt.' + new Date(Date.now() - 48 * 3600000).toISOString(),
      { state: 'skipped', last_error: 'expired_news' });
    await db.update('news_items?state=eq.pending&attempts=gte.3', { state: 'failed', last_error: 'model_retry_limit' });
    const previouslyReady = await deliver(db, cfg, env, fetchImpl);
    details = { fetched_entries: collected.reduce((a,b) => a+b,0), sent: previouslyReady };
    Object.assign(details, await evaluate(db, cfg, runId, env, fetchImpl));
    details.sent += await deliver(db, cfg, env, fetchImpl);
    return { status, ...details };
  } catch (error) {
    status = errorCode(error);
    return { status };
  } finally {
    await db.update('news_runs?id=eq.' + runId, { status, details, finished_at: new Date().toISOString() });
    await db.update('news_settings?id=eq.true&lock_owner=eq.' + runId, { lock_owner: null, lock_until: null });
  }
}
export function createHandler(getEnv, fetchImpl = fetch, runInBackground = promise => { void promise.catch(()=>{}); }) {
  return async request => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    try {
      const webhook = request.headers.has('x-telegram-bot-api-secret-token');
      const token = request.headers.get(webhook ? 'x-telegram-bot-api-secret-token' : 'x-news-token');
      if (!token || token.length !== 64) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const env = getEnv();
      const secretKeys = env.SUPABASE_SECRET_KEYS ? JSON.parse(env.SUPABASE_SECRET_KEYS) : {};
      const key = secretKeys.default || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key || !env.SUPABASE_URL) throw new Failure('backend_not_configured');
      const db = new Database(env.SUPABASE_URL, key, fetchImpl);
      const [cfg] = await db.read('news_settings?id=eq.true&limit=1');
      if (!cfg || await digest(token) !== (webhook ? cfg.webhook_token_hash : cfg.scheduler_token_hash))
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      const body = await request.json();
      if(webhook) {
        const accepted=await enqueueChat(db,cfg,body);
        if(accepted) runInBackground(processChat(db,cfg,env,fetchImpl));
        return Response.json({ok:true});
      }
      const missing = ['GROQ_API_KEY', 'TELEGRAM_BOT_TOKEN'].filter(name => !env[name]);
      if (body.action === 'status') return Response.json({ status: 'configured', enabled: cfg.enabled,
        missing, telegram_bound: Boolean(cfg.telegram_chat_id), chat_enabled:cfg.chat_enabled,
        model: cfg.model });
      if(body.action==='chat') return Response.json(await processChat(db,cfg,env,fetchImpl));
      if(body.action==='test_chat') {
        const question=typeof body.question==='string' ? body.question.slice(0,4000) : undefined;
        const result=await previewChat(db,cfg,env,fetchImpl,question);
        return Response.json({status:'chat_ok',answer:result.answer,tokens_used:result.tokens});
      }
      if(body.action==='setup_webhook') {
        if(!env.TELEGRAM_BOT_TOKEN || !cfg.telegram_chat_id) throw new Failure('telegram_not_bound');
        if(typeof body.secret_token!=='string' || body.secret_token.length!==64 ||
          await digest(body.secret_token)!==cfg.webhook_token_hash) throw new Failure('invalid_webhook_secret');
        const result=await telegram('setWebhook',{
          url:env.SUPABASE_URL+'/functions/v1/ai-news-monitor/telegram',
          secret_token:body.secret_token,allowed_updates:['message'],max_connections:1,
          drop_pending_updates:false
        },env,fetchImpl);
        return Response.json({status:result?'webhook_set':'webhook_failed'});
      }
      if(body.action==='webhook_info') {
        const info=await telegram('getWebhookInfo',{},env,fetchImpl);
        return Response.json({status:'webhook_info',url:info.url,pending:info.pending_update_count,
          last_error:info.last_error_message??null});
      }
      if (body.action === 'test_model') {
        if (!env.GROQ_API_KEY) throw new Failure('model_not_configured');
        // A small, authenticated setup probe. It never sends a Telegram message.
        let response;
        try {
          response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.model, reasoning_effort: 'none', temperature: 0,
              max_completion_tokens: 64, response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: 'Reply only with JSON: {"ok":true}' }] }),
            signal: deadline(20000)
          });
        } catch { throw new Failure('model_unavailable'); }
        if (!response.ok) throw new Failure('model_http_' + response.status);
        const data = await safeJson(response);
        let result;
        try { result = JSON.parse(data.choices?.[0]?.message?.content); }
        catch { throw new Failure('invalid_model_test'); }
        if (result.ok !== true) throw new Failure('invalid_model_test');
        return Response.json({ status: 'model_ok', model: cfg.model,
          tokens_used: data.usage?.total_tokens ?? null });
      }
      if (body.action === 'test_telegram') {
        if (!env.TELEGRAM_BOT_TOKEN) throw new Failure('telegram_not_configured');
        const bot = await telegram('getMe', {}, env, fetchImpl);
        if (!bot.is_bot || !bot.username) throw new Failure('invalid_telegram_bot');
        return Response.json({ status: 'telegram_ok', username: bot.username });
      }
      if (body.action === 'test_delivery') {
        if (!env.TELEGRAM_BOT_TOKEN || !cfg.telegram_chat_id) throw new Failure('telegram_not_bound');
        const message = await telegram('sendMessage', { chat_id: cfg.telegram_chat_id,
          text: '✅ AI-новости подключены.\n\nБуду сообщать о важных событиях в искусственном интеллекте: что произошло, почему это полезно и где попробовать. Если важных новостей нет — молчу.',
          link_preview_options: { is_disabled: true } }, env, fetchImpl);
        return Response.json({ status: 'delivered', message_id: message.message_id });
      }
      if (body.action === 'bind') {
        if (!env.TELEGRAM_BOT_TOKEN) throw new Failure('telegram_not_configured');
        if (cfg.telegram_chat_id) return Response.json({ status: 'already_bound' });
        const updates = await telegram('getUpdates', { allowed_updates: ['message'], limit: 100, timeout: 0 }, env, fetchImpl);
        const chats = [...new Set(updates.filter(update => update.message?.chat?.type === 'private' &&
          update.message.text === '/start ' + cfg.pairing_code).map(update => String(update.message.chat.id)))];
        if (chats.length !== 1) return Response.json({ status: 'waiting_for_pairing', pairing_code: cfg.pairing_code });
        await db.update('news_settings?id=eq.true', { telegram_chat_id: chats[0] });
        return Response.json({ status: 'bound' });
      }
      if (body.action !== 'run') return Response.json({ error: 'unknown_action' }, { status: 400 });
      if (missing.length || !cfg.telegram_chat_id) return Response.json({ status: 'setup_pending', missing,
        telegram_bound: Boolean(cfg.telegram_chat_id) });
      if (!cfg.enabled) return Response.json({ status: 'disabled' });
      return Response.json(await runMonitor(db, cfg, env, fetchImpl));
    } catch (error) {
      return Response.json({ error: errorCode(error) }, { status: 503 });
    }
  };
}
