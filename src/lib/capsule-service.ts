import * as Crypto from 'expo-crypto';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { readPickedMedia } from './media-file';
import type { MemoryAsset } from './memory-asset';
import { newCapsuleKey, encryptCapsuleBytes, encryptCapsuleLetter, decryptCapsuleLetter } from './capsule-crypto';

export type CapsuleScope = { userId: string; familyId: string };
export type CapsulePermit = { token: string; expiresAt: string };
export type CapsuleFile = { id: string; storage_path: string; media_type: 'image' | 'video' | 'audio'; mime_type: string; file_size: number };
export type Capsule = { id: string; child_id: string | null; title: string; version: number; archived: boolean; updated_at: string };
export type CapsuleCursor = Readonly<CapsuleScope & { archived: boolean; updatedAt: string; id: string }>;
export type CapsulePage = { items: Capsule[]; nextCursor: CapsuleCursor | null };
export const CAPSULE_PAGE_SIZE = 30;
export type CapsuleContent = Capsule & { letter: string; files: CapsuleFile[]; keyHex: string; lastOperation: string };
export type CapsuleWrite = { action: 'save' | 'archive'; id: string; operation_id: string; expected_version: number;
  title?: string; child_id?: string | null; content_cipher?: string; files?: CapsuleFile[]; archived?: boolean };
export class CapsuleError extends Error {
  constructor(message: string, public kind: 'locked' | 'scope' | 'read' | 'pending' | 'invalid' | 'conflict' = 'read', public reason?: string) {
    super(message); this.name = 'CapsuleError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CAPSULE_BUCKET = 'family-capsules';
export const CAPSULE_MAX_BYTES = 50 * 1024 * 1024;
const mime = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/heic': 'image', 'image/heif': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video', 'audio/mp4': 'audio', 'audio/webm': 'audio' } as const;
function id(value: string) { if (!UUID.test(value)) throw new CapsuleError('Не удалось определить капсулу или семью.', 'invalid'); return value; }
export function checkCapsulePassword(password: string) {
  if (password.length < 8 || password.length > 64 || new TextEncoder().encode(password).length > 72)
    throw new CapsuleError('Пароль — от 8 до 64 символов, не более 72 байтов. Лучше использовать буквы и цифры.', 'invalid');
}
async function account(scope: CapsuleScope) {
  id(scope.userId); id(scope.familyId);
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== scope.userId || !data.session.access_token)
    throw new CapsuleError('Аккаунт изменился. Откройте капсулу заново.', 'scope');
  return data.session;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CapsuleError('Неожиданный ответ сервера.');
  return value as Record<string, unknown>;
}
async function request(scope: CapsuleScope, endpoint: string, args: object, write = false, overrideToken?: string) {
  const actor = await account(scope);
  let result;
  try { result = await supabase.rpc(endpoint, args)
    .setHeader('Authorization', `Bearer ${overrideToken ?? actor.access_token}`); }
  catch { await account(scope); throw new CapsuleError(write ? 'Результат пока не подтверждён. Проверьте состояние, не создавая вторую капсулу.' : 'Не удалось связаться с сервером.', write ? 'pending' : 'read'); }
  await account(scope);
  if (result.error) {
    const message = result.error.message ?? '';
    if (message.includes('CAPSULE_LOCKED')) throw new CapsuleError('Раздел закрыт. Введите пароль ещё раз.', 'locked');
    if (message.includes('CAPSULE_CONFLICT')) throw new CapsuleError('Капсула изменилась на другом устройстве. Откройте актуальную версию.', 'conflict');
    if (message.includes('CAPSULE_REAUTH_REQUIRED')) throw new CapsuleError('Сначала подтвердите пароль своего аккаунта.', 'locked');
    if (result.error.code === '42501') throw new CapsuleError('Капсула доступна только создателю этой семьи.', 'scope');
    if (['22023', '22P02', '23514'].includes(result.error.code)) throw new CapsuleError('Сервер отклонил данные капсулы. Проверьте поля и файлы.', 'invalid');
    if (result.error.code === 'PGRST202') throw new CapsuleError('Раздел ещё не доступен через API. Попробуйте позже.');
    throw new CapsuleError(write ? 'Сохранение пока не подтверждено. Проверьте ту же капсулу.' : 'Не удалось загрузить капсулу.', write ? 'pending' : 'read');
  }
  return result.data as unknown;
}
function call(scope: CapsuleScope, action: string, token: string | null, data: object = {}, write = false, overrideToken?: string) {
  return request(scope, 'family_capsule', { p_family_id: scope.familyId, p_action: action, p_token: token, p_data: data }, write, overrideToken);
}
export async function capsuleConfigured(scope: CapsuleScope) {
  const r = object(await call(scope, 'status', null));
  if (typeof r.configured !== 'boolean') throw new CapsuleError('Не удалось проверить состояние раздела.');
  return r.configured;
}
export async function setupCapsuleVault(scope: CapsuleScope, password: string) {
  checkCapsulePassword(password); const keyHex = await newCapsuleKey(); await account(scope);
  const r = object(await call(scope, 'setup', null, { password, key_hex: keyHex }, true));
  if (r.configured !== true && r.error !== 'already_configured') throw new CapsuleError('Настройка пока не подтверждена.', 'pending');
}
export async function unlockCapsuleVault(scope: CapsuleScope, password: string): Promise<CapsulePermit> {
  const r = object(await call(scope, 'unlock', null, { password }));
  if (r.error === 'bad_password') throw new CapsuleError(`Неверный пароль. Осталось попыток: ${r.remaining}. После пяти ошибок — перерыв 15 минут.`, 'invalid', 'bad_password');
  if (r.error === 'blocked') throw new CapsuleError(`Слишком много попыток. Повторите через ${Math.max(1, Math.ceil(Number(r.retry_after) / 60))} мин.`, 'invalid');
  if (typeof r.token !== 'string' || !/^[0-9a-f]{64}$/.test(r.token) || typeof r.expires_at !== 'string' || !Number.isFinite(Date.parse(r.expires_at)))
    throw new CapsuleError('Не удалось подтвердить открытие раздела.');
  return { token: r.token, expiresAt: r.expires_at };
}
export async function lockCapsuleVault(scope: CapsuleScope, permit: CapsulePermit) { await call(scope, 'lock', permit.token); }
function capsule(value: unknown): Capsule {
  const r = object(value);
  if (typeof r.title !== 'string' || r.title.length > 120 || !Number.isSafeInteger(r.version) || Number(r.version) < 0
    || typeof r.archived !== 'boolean' || typeof r.updated_at !== 'string' || !Number.isFinite(Date.parse(r.updated_at))) throw new CapsuleError('Не удалось прочитать капсулу.');
  return { id: id(r.id as string), child_id: r.child_id === null ? null : id(r.child_id as string), title: r.title,
    version: Number(r.version), archived: r.archived, updated_at: r.updated_at };
}
export async function listCapsules(scope: CapsuleScope, permit: CapsulePermit) {
  const result = await call(scope, 'list', permit.token);
  if (!Array.isArray(result)) throw new CapsuleError('Не удалось прочитать список капсул.');
  return result.map(capsule);
}
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
export async function getCapsulePage(scope: CapsuleScope, permit: CapsulePermit, archived: boolean, cursor: CapsuleCursor | null = null): Promise<CapsulePage> {
  if (typeof archived !== 'boolean' || cursor && (cursor.userId !== scope.userId || cursor.familyId !== scope.familyId || cursor.archived !== archived
    || typeof cursor.updatedAt !== 'string' || !CURSOR_TIME.test(cursor.updatedAt) || !Number.isFinite(Date.parse(cursor.updatedAt)) || !UUID.test(cursor.id)))
    throw new CapsuleError('Страница изменилась. Обновите список капсул.', 'invalid');
  const result = await request(scope, 'list_family_capsules', { p_family_id: scope.familyId, p_token: permit.token, p_archived: archived,
    p_before_updated_at: cursor?.updatedAt ?? null, p_before_id: cursor?.id ?? null });
  if (!Array.isArray(result) || result.length > CAPSULE_PAGE_SIZE + 1) throw new CapsuleError('Не удалось прочитать страницу капсул.');
  const rows = result.map(capsule);
  if (rows.some(row => row.archived !== archived || !CURSOR_TIME.test(row.updated_at)) || new Set(rows.map(row => row.id)).size !== rows.length)
    throw new CapsuleError('Список не соответствует выбранному разделу.');
  const items = rows.slice(0, CAPSULE_PAGE_SIZE), last = items.at(-1);
  // Keep the exact Postgres microsecond timestamp, not a JS Date roundtrip.
  return { items, nextCursor: rows.length > CAPSULE_PAGE_SIZE && last ? { ...scope, archived, updatedAt: last.updated_at, id: last.id } : null };
}
export async function capsuleKey(scope: CapsuleScope, permit: CapsulePermit) {
  const r = object(await call(scope, 'key', permit.token));
  if (typeof r.key_hex !== 'string' || !/^[0-9a-f]{64}$/.test(r.key_hex)) throw new CapsuleError('Ключ раздела недоступен.');
  return r.key_hex;
}
function file(value: unknown, scope: CapsuleScope, capsuleId: string): CapsuleFile {
  const r = object(value); const fileId = id(r.id as string);
  if (r.storage_path !== `${scope.familyId}/${capsuleId}/${fileId}.bin` || typeof r.mime_type !== 'string' || !(r.mime_type in mime)
    || mime[r.mime_type as keyof typeof mime] !== r.media_type || !Number.isSafeInteger(r.file_size) || Number(r.file_size) < 1 || Number(r.file_size) > CAPSULE_MAX_BYTES)
    throw new CapsuleError('Некорректное вложение капсулы.');
  return { id: fileId, storage_path: r.storage_path as string, media_type: r.media_type as CapsuleFile['media_type'], mime_type: r.mime_type, file_size: Number(r.file_size) };
}
export async function getCapsule(scope: CapsuleScope, permit: CapsulePermit, capsuleId: string): Promise<CapsuleContent | null> {
  const r = object(await call(scope, 'get', permit.token, { id: id(capsuleId) }));
  if (r.missing === true) return null;
  const entry = capsule(r);
  if (entry.id !== capsuleId || !Array.isArray(r.files) || r.files.length > 5 || typeof r.content_cipher !== 'string' || typeof r.key_hex !== 'string') throw new CapsuleError('Ответ не соответствует выбранной капсуле.');
  const letter = await decryptCapsuleLetter(r.content_cipher, r.key_hex); await account(scope);
  return { ...entry, letter, keyHex: r.key_hex, lastOperation: id(r.last_operation as string), files: r.files.map(f => file(f, scope, capsuleId)) };
}
const suffixMime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4a: 'audio/mp4' };
export async function uploadCapsuleFile(scope: CapsuleScope, permit: CapsulePermit, capsuleId: string, asset: MemoryAsset, keyHex: string, active: () => boolean): Promise<CapsuleFile> {
  const guard = () => { if (!active() || Date.parse(permit.expiresAt) <= Date.now()) throw new CapsuleError('Раздел уже закрыт.', 'locked'); };
  guard(); id(capsuleId);
  const type = asset.mimeType?.split(';')[0].toLowerCase() || suffixMime[(asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase() ?? ''];
  if (!type || !(type in mime) || (asset.type && asset.type !== mime[type as keyof typeof mime])) throw new CapsuleError('Выберите поддерживаемое фото, видео MP4/MOV/WEBM или записанный голос.', 'invalid');
  if ((asset.fileSize ?? 0) > CAPSULE_MAX_BYTES) throw new CapsuleError('Файл больше 50 МиБ.', 'invalid');
  const bytes = await readPickedMedia(asset, CAPSULE_MAX_BYTES); guard(); await account(scope);
  if (bytes.byteLength < 1 || bytes.byteLength > CAPSULE_MAX_BYTES) throw new CapsuleError('Файл пуст или больше 50 МиБ.', 'invalid');
  const encrypted = await encryptCapsuleBytes(bytes, keyHex); guard();
  // RN Storage uploads use ArrayBuffer, not Blob/FormData. Avoid copying the
  // usual full Expo buffer; copy only when it is a sliced/shared typed view.
  const body = encrypted.buffer instanceof ArrayBuffer && encrypted.byteOffset === 0 && encrypted.byteLength === encrypted.buffer.byteLength
    ? encrypted.buffer : new Uint8Array(encrypted).buffer;
  const fileId = Crypto.randomUUID(); const storage_path = `${scope.familyId}/${capsuleId}/${fileId}.bin`;
  const actor = await account(scope); guard();
  const { error } = await supabase.storage.from(CAPSULE_BUCKET).upload(storage_path, body, {
    contentType: 'application/octet-stream', upsert: false, cacheControl: '0', headers: { Authorization: `Bearer ${actor.access_token}` },
  });
  await account(scope); guard();
  if (error) throw new CapsuleError('Не удалось загрузить зашифрованный файл. Повторите попытку.');
  return { id: fileId, storage_path, mime_type: type, media_type: mime[type as keyof typeof mime], file_size: bytes.byteLength };
}
export async function prepareCapsuleWrite(input: { id: string; expectedVersion: number; title: string; childId: string | null; letter: string; files: CapsuleFile[]; keyHex: string }): Promise<CapsuleWrite> {
  if (!input.title.trim() || input.title.trim().length > 120 || input.letter.length > 8000 || input.files.length > 5 || (!input.letter.trim() && !input.files.length))
    throw new CapsuleError('Добавьте название и письмо либо хотя бы одно вложение. Текст — до 8000 символов, вложений — до пяти.', 'invalid');
  return { action: 'save', id: id(input.id), operation_id: Crypto.randomUUID(), expected_version: input.expectedVersion, title: input.title.trim(),
    child_id: input.childId, content_cipher: await encryptCapsuleLetter(input.letter, input.keyHex), files: input.files.map(f => ({ ...f })) };
}
export async function commitCapsuleWrite(scope: CapsuleScope, permit: CapsulePermit, attempt: CapsuleWrite) {
  const r = object(await call(scope, attempt.action, permit.token, { ...attempt }, true));
  if (r.id !== attempt.id || r.operation_id !== attempt.operation_id || !Number.isSafeInteger(r.version) || Number(r.version) < 0) throw new CapsuleError('Ответ не подтвердил это действие.', 'pending');
}
export function archiveCapsuleWrite(c: Capsule, archived: boolean): CapsuleWrite {
  return { action: 'archive', id: c.id, operation_id: Crypto.randomUUID(), expected_version: c.version, archived };
}
export async function downloadCapsuleFile(scope: CapsuleScope, permit: CapsulePermit, f: CapsuleFile): Promise<Uint8Array> {
  // Revalidate the password session before allowing plaintext preparation.
  await capsuleKey(scope, permit);
  const actor = await account(scope);
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${url}/storage/v1/object/authenticated/${CAPSULE_BUCKET}/${f.storage_path}`, {
    headers: { apikey: apiKey ?? '', Authorization: `Bearer ${actor.access_token}` },
  });
  await account(scope);
  if (!response.ok || Number(response.headers.get('content-length')) > CAPSULE_MAX_BYTES + 32) throw new CapsuleError('Не удалось загрузить вложение.');
  const bytes = await response.arrayBuffer(); await account(scope);
  if (bytes.byteLength !== f.file_size + 28) throw new CapsuleError('Вложение повреждено или недоступно.');
  return new Uint8Array(bytes);
}
export async function resetCapsulePassword(scope: CapsuleScope, accountPassword: string, password: string) {
  checkCapsulePassword(password); const actor = await account(scope);
  if (!actor.user.email || !accountPassword) throw new CapsuleError('Введите пароль вашего аккаунта.', 'invalid');
  // Fresh password AMR without replacing the app's session or persisting tokens.
  const isolated = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const verified = await isolated.auth.signInWithPassword({ email: actor.user.email, password: accountPassword });
    await account(scope);
    if (verified.error || verified.data.session?.user.id !== scope.userId) throw new CapsuleError('Пароль аккаунта не подтверждён.', 'invalid');
    await call(scope, 'reset', null, { password }, true, verified.data.session.access_token);
  } finally { await isolated.auth.signOut({ scope: 'local' }).catch(() => {}); }
}
