// Explicitly approved live fixtures only. Never use service_role or existing users.
// Credentials/tokens exist in process memory only. No cleanup or settings changes.
const { randomUUID, randomBytes } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
require('@expo/env').load(process.cwd());

const PROJECT = 'thmzpgugjognrnqtzbqg';
if (!process.argv.includes('--allow-live-test-data') || process.argv[process.argv.indexOf('--project') + 1] !== PROJECT) {
  throw new Error('Requires explicit --allow-live-test-data --project thmzpgugjognrnqtzbqg approval.');
}
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (new URL(url).hostname !== `${PROJECT}.supabase.co` || !key) throw new Error('Wrong project or missing public configuration.');
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const run = randomUUID().slice(0, 8);
const report = { run, project: PROJECT, created: [], checks: [], failures: [], deleted: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
function check(name, pass, details = {}) {
  report.checks.push({ name, pass, ...details });
  if (!pass) report.failures.push(name);
}
function fail(name, error) {
  throw Object.assign(new Error(name), { safeCode: error?.code ?? error?.statusCode ?? error?.status ?? 'unknown' });
}
async function query(name, promise) {
  const result = await promise;
  if (result.error) fail(name, result.error);
  return result.data;
}
async function signup(label) {
  const api = client();
  const email = `codex-privacy-${label.toLowerCase()}-${run}@moya-istoriya.invalid`;
  const password = `Mi_TEST_${randomBytes(32).toString('base64url')}a9!`;
  const result = await api.auth.signUp({ email, password, options: { data: { name: `[TEST ${run}] ${label}` } } });
  if (result.error) fail(`signup_${label}`, result.error);
  if (!result.data.user || !result.data.session) fail(`signup_${label}_needs_confirmation`);
  const userId = result.data.user.id;
  report.created.push({ type: 'test_user', label, id: userId });
  console.log(JSON.stringify({ progress: `created_test_user_${label}`, run }));
  return { api, userId, email, password, label };
}
async function family(account) {
  const args = { p_family_name: `[TEST ${run}] Family ${account.label}`, p_child_name: `[TEST] Child ${account.label}`, p_birth_date: '2024-01-01' };
  const child = await query(`setup_${account.label}`, account.api.rpc('create_family_with_child', args));
  const row = Array.isArray(child) ? child[0] : child;
  if (!row?.family_id || !row?.id) fail('unexpected_setup_shape');
  account.familyId = row.family_id; account.childId = row.id;
  report.created.push({ type: 'test_family', label: account.label, id: row.family_id, childId: row.id });
  const retries = await Promise.all([account.api.rpc('create_family_with_child', args), account.api.rpc('create_family_with_child', args)]);
  check(`idempotent_concurrent_setup_${account.label}`, retries.every((result) => !result.error && (Array.isArray(result.data) ? result.data[0]?.id : result.data?.id) === row.id));
  const memberships = await query(`own_membership_${account.label}`, account.api.from('family_members').select('family_id').eq('user_id', account.userId));
  check(`single_test_membership_${account.label}`, memberships.length === 1 && memberships[0].family_id === row.family_id);
}
async function memory(account) {
  account.memoryId = randomUUID(); account.mediaId = randomUUID();
  account.path = `${account.familyId}/${account.memoryId}/${account.mediaId}.png`;
  await query(`upload_${account.label}`, account.api.storage.from('family-media').upload(account.path, png, { contentType: 'image/png', upsert: false }));
  report.created.push({ type: 'test_file', label: account.label, path: account.path });
  const id = await query(`memory_${account.label}`, account.api.rpc('create_family_memory', {
    p_memory_id: account.memoryId, p_family_id: account.familyId, p_title: `[TEST ${run}] Pixel ${account.label}`,
    p_body: 'Synthetic privacy test. Contains no personal data.', p_event_date: '2024-01-02', p_memory_type: 'photo',
    p_child_ids: [account.childId], p_media_files: [{ id: account.mediaId, storage_path: account.path,
      media_type: 'image', mime_type: 'image/png', file_size: png.length }],
  }));
  report.created.push({ type: 'test_memory', label: account.label, id: account.memoryId });
  check(`memory_uuid_${account.label}`, id === account.memoryId);
  const read = await query(`read_memory_${account.label}`, account.api.from('memories').select('id,event_date,memory_children(child_id),media_files(id)').eq('id', account.memoryId));
  check(`own_memory_links_${account.label}`, read.length === 1 && read[0].memory_children[0]?.child_id === account.childId && read[0].media_files[0]?.id === account.mediaId);
  const signed = await account.api.storage.from('family-media').createSignedUrl(account.path, 60);
  check(`own_signed_url_${account.label}`, !signed.error && Boolean(signed.data?.signedUrl));
  if (signed.data?.signedUrl) {
    const fetched = await fetch(signed.data.signedUrl);
    check(`own_signed_download_${account.label}`, fetched.ok && (await fetched.arrayBuffer()).byteLength === png.length);
  }
}
async function isolation(own, other) {
  const selections = [
    ['families', 'id', other.familyId], ['children', 'id', other.childId],
    ['family_members', 'user_id', other.userId], ['memories', 'id', other.memoryId],
    ['memory_children', 'memory_id', other.memoryId], ['media_files', 'id', other.mediaId],
  ];
  for (const [table, field, id] of selections) {
    const result = await own.api.from(table).select(field).eq(field, id);
    check(`foreign_select_${own.label}_${table}`, !result.error && result.data.length === 0);
  }
  const signed = await own.api.storage.from('family-media').createSignedUrl(other.path, 60);
  check(`foreign_sign_${own.label}`, Boolean(signed.error) && !signed.data?.signedUrl);
  const downloaded = await own.api.storage.from('family-media').download(other.path);
  check(`foreign_download_${own.label}`, Boolean(downloaded.error) && !downloaded.data);
  const upload = await own.api.storage.from('family-media').upload(`${other.familyId}/${randomUUID()}/denied.png`, png, { contentType: 'image/png', upsert: false });
  check(`foreign_upload_${own.label}`, Boolean(upload.error));
  const insert = await own.api.from('memories').insert({ id: randomUUID(), family_id: other.familyId, author_id: own.userId, title: `[TEST ${run}] Expected denied`, event_date: '2024-01-02', memory_type: 'note' });
  check(`foreign_memory_insert_${own.label}`, Boolean(insert.error));
  const forged = await own.api.from('memories').insert({ id: randomUUID(), family_id: own.familyId, author_id: other.userId, title: `[TEST ${run}] Expected denied author`, event_date: '2024-01-02', memory_type: 'note' });
  check(`forged_author_${own.label}`, Boolean(forged.error));
  const linked = await own.api.from('memory_children').insert({ memory_id: own.memoryId, child_id: other.childId });
  check(`foreign_child_link_${own.label}`, Boolean(linked.error));
  const rpc = await own.api.rpc('create_family_memory', { p_memory_id: randomUUID(), p_family_id: other.familyId,
    p_title: `[TEST ${run}] Expected denied RPC`, p_body: null, p_event_date: '2024-01-02', p_memory_type: 'note', p_child_ids: [], p_media_files: [] });
  check(`foreign_memory_rpc_${own.label}`, Boolean(rpc.error));
}
async function relogin(account) {
  await query(`signout_${account.label}`, account.api.auth.signOut({ scope: 'local' }));
  const after = await account.api.auth.getSession();
  check(`signout_clears_session_${account.label}`, !after.error && after.data.session === null);
  const result = await account.api.auth.signInWithPassword({ email: account.email, password: account.password });
  check(`repeat_login_${account.label}`, !result.error && result.data.user?.id === account.userId);
  if (result.error) fail(`repeat_login_${account.label}`, result.error);
  const memories = await query(`relogin_memory_${account.label}`, account.api.from('memories').select('id').eq('id', account.memoryId));
  check(`existing_memory_after_login_${account.label}`, memories.length === 1);
}
async function main() {
  const a = await signup('A'); const b = await signup('B');
  await family(a); await family(b); await memory(a); await memory(b);
  await isolation(a, b); await isolation(b, a);
  const anon = client();
  for (const table of ['families', 'family_members', 'children', 'memories', 'memory_children', 'media_files']) {
    const result = await anon.from(table).select(table === 'memory_children' ? 'memory_id' : 'id').limit(1);
    check(`anonymous_read_${table}`, !result.error && result.data.length === 0);
  }
  const publicUrl = anon.storage.from('family-media').getPublicUrl(a.path).data.publicUrl;
  const publicFile = await fetch(publicUrl);
  check('private_bucket_not_public', !publicFile.ok, { httpStatus: publicFile.status });
  await relogin(a); await relogin(b);
}
main().catch((error) => { report.failures.push({ step: error.message, code: error.safeCode ?? 'unexpected' }); })
  .finally(() => { console.log(JSON.stringify(report, null, 2)); if (report.failures.length) process.exitCode = 1; });
