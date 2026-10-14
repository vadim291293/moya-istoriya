import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { isValidDateIso } from './date-utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class FamilyOperationError extends Error {
  constructor(message: string, public readonly kind: 'scope' | 'invalid' | 'forbidden' | 'conflict' | 'pending' | 'read') { super(message); }
}
export function checkedId(id: string) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new FamilyOperationError('Не удалось определить семейные данные.', 'invalid');
  return id.toLowerCase();
}
export function invitationCode(value: string) {
  if (typeof value !== 'string') throw new FamilyOperationError('Вставьте код или ссылку приглашения.', 'invalid');
  let code = value.trim();
  if (code.startsWith('moyaistoriya://')) {
    const url = new URL(code);
    if (url.hostname !== 'family' || url.pathname !== '/join') throw new FamilyOperationError('Вставьте код или ссылку приглашения.', 'invalid');
    code = url.searchParams.get('code') ?? '';
  }
  if (!/^[0-9a-f]{64}$/i.test(code)) throw new FamilyOperationError('Вставьте полный код или ссылку приглашения.', 'invalid');
  return code.toLowerCase();
}
export type InvitationAttempt = { userId: string; familyId: string; id: string; token: string };
export function newInvitation(userId: string, familyId: string): InvitationAttempt {
  return { userId: checkedId(userId), familyId: checkedId(familyId), id: Crypto.randomUUID(),
    token: Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('') };
}
export type FamilyMember = { id: string; user_id: string; role: string; name: string | null };
export type Invitation = { id: string; expires_at: string; revoked_at: string | null; accepted_at: string | null };
export type FamilyAccess = { members: FamilyMember[]; invitations: Invitation[] };
export type MemoryLifecycle = { id: string; archived: boolean; version: number };
export type LifecycleAttempt = { userId: string; familyId: string; memoryId: string; expectedVersion: number; archived: boolean; operationId: string };
export function validateLifecycleAttempt(input: LifecycleAttempt): LifecycleAttempt {
  if (!input || typeof input !== 'object') throw new FamilyOperationError('Не удалось прочитать сохранённую операцию.', 'invalid');
  const a = { ...input, userId: checkedId(input.userId), familyId: checkedId(input.familyId), memoryId: checkedId(input.memoryId), operationId: checkedId(input.operationId) };
  if (!Number.isSafeInteger(a.expectedVersion) || a.expectedVersion < 0 || typeof a.archived !== 'boolean') throw new FamilyOperationError('Некорректное состояние воспоминания.', 'invalid');
  return a;
}
export type TrashMemory = { id: string; title: string | null; event_date: string; deleted_at: string; state_version: number; media_count: number };

async function account(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== checkedId(userId) || !data.session.access_token)
    throw new FamilyOperationError('Вход изменился. Откройте действие в нужном аккаунте.', 'scope');
  return data.session;
}
async function rpc(userId: string, name: string, args: Record<string, unknown>, write = false): Promise<unknown> {
  const actor = await account(userId);
  let result;
  try { result = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${actor.access_token}`); }
  catch { await account(userId); throw new FamilyOperationError(write ? 'Результат пока не подтверждён. Проверьте и повторите это же действие.' : 'Не удалось загрузить данные. Попробуйте ещё раз.', write ? 'pending' : 'read'); }
  await account(userId);
  if (result.error) {
    const { code, message = '' } = result.error;
    if (code === '42501') throw new FamilyOperationError('Нет разрешения на это действие. Обновите данные семьи.', 'forbidden');
    if (message.includes('INVITATION_UNAVAILABLE')) throw new FamilyOperationError('Приглашение истекло, отозвано или уже использовано. Попросите владельца дать новое.', 'invalid');
    if (message.includes('INVITATION_LIMIT')) throw new FamilyOperationError('Уже есть 20 действующих приглашений. Отзовите ненужные.', 'invalid');
    if (message.includes('CONFLICT')) throw new FamilyOperationError('Данные уже изменились. Сначала загрузите актуальную версию.', 'conflict');
    if (code === '22023' || code === '22P02') throw new FamilyOperationError('Сервер отклонил данные. Обновите экран и проверьте поля.', 'invalid');
    if (code === 'PGRST202') throw new FamilyOperationError('Функция пока недоступна через API. Попробуйте позже.', 'read');
    throw new FamilyOperationError(write ? 'Результат пока не подтверждён. Повторите только это же действие.' : 'Не удалось загрузить данные. Попробуйте ещё раз.', write ? 'pending' : 'read');
  }
  return result.data;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FamilyOperationError('Сервер вернул неожиданные данные.', 'read');
  return value as Record<string, unknown>;
}
function timestamp(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function parseInvitation(value: unknown): Invitation {
  const row = object(value);
  if (!timestamp(row.expires_at) || (row.revoked_at !== null && !timestamp(row.revoked_at))
    || (row.accepted_at !== null && !timestamp(row.accepted_at))) throw new FamilyOperationError('Не удалось прочитать приглашение.', 'read');
  return { id: checkedId(row.id as string), expires_at: row.expires_at as string, revoked_at: row.revoked_at as string | null, accepted_at: row.accepted_at as string | null };
}
export async function getFamilyAccess(userId: string, familyId: string): Promise<FamilyAccess> {
  const row = object(await rpc(userId, 'list_family_access', { p_family_id: checkedId(familyId) }));
  if (!Array.isArray(row.members) || !Array.isArray(row.invitations)) throw new FamilyOperationError('Не удалось прочитать участников.', 'read');
  return { members: row.members.map((value) => {
    const m = object(value);
    if (typeof m.role !== 'string' || (m.name !== null && typeof m.name !== 'string')) throw new FamilyOperationError('Не удалось прочитать участника.', 'read');
    return { id: checkedId(m.id as string), user_id: checkedId(m.user_id as string), role: m.role, name: m.name as string | null };
  }), invitations: row.invitations.map(parseInvitation) };
}
export async function createInvitation(input: InvitationAttempt) {
  const a = { userId: checkedId(input.userId), familyId: checkedId(input.familyId), id: checkedId(input.id), token: invitationCode(input.token) };
  const result = parseInvitation(await rpc(a.userId, 'create_family_invitation', { p_family_id: a.familyId, p_invitation_id: a.id, p_token: a.token }, true));
  if (result.id !== a.id) throw new FamilyOperationError('Ответ не подтвердил это приглашение. Повторите тот же запрос.', 'pending');
  return result;
}
export async function acceptInvitation(userId: string, value: string) {
  return checkedId(await rpc(userId, 'accept_family_invitation', { p_token: invitationCode(value) }, true) as string);
}
export async function revokeInvitation(userId: string, familyId: string, id: string) {
  const expected = checkedId(id);
  if (await rpc(userId, 'revoke_family_invitation', { p_family_id: checkedId(familyId), p_invitation_id: expected }, true) !== expected)
    throw new FamilyOperationError('Отзыв пока не подтверждён. Обновите список.', 'pending');
}
export async function removeFamilyMember(userId: string, familyId: string, membershipId: string) {
  const expected = checkedId(membershipId);
  if (await rpc(userId, 'remove_family_membership', { p_family_id: checkedId(familyId), p_membership_id: expected }, true) !== expected)
    throw new FamilyOperationError('Отзыв доступа пока не подтверждён. Обновите список.', 'pending');
}
function lifecycle(value: unknown, id: string): MemoryLifecycle {
  const r = object(value);
  if (r.id !== id || typeof r.archived !== 'boolean' || !Number.isSafeInteger(r.version) || (r.version as number) < 0)
    throw new FamilyOperationError('Сервер не подтвердил состояние воспоминания.', 'read');
  return { id, archived: r.archived, version: r.version as number };
}
export async function getMemoryLifecycle(userId: string, familyId: string, memoryId: string) {
  const id = checkedId(memoryId);
  return lifecycle(await rpc(userId, 'get_memory_lifecycle', { p_family_id: checkedId(familyId), p_memory_id: id }), id);
}
export async function setMemoryArchived(input: LifecycleAttempt) {
  const a = validateLifecycleAttempt(input);
  const result = lifecycle(await rpc(a.userId, 'set_family_memory_archived', { p_family_id: a.familyId, p_memory_id: a.memoryId,
    p_expected_version: a.expectedVersion, p_archived: a.archived, p_operation_id: a.operationId }, true), a.memoryId);
  if (result.archived !== a.archived) throw new FamilyOperationError('После этого действия состояние уже изменилось. Обновите экран.', 'conflict');
  return result;
}
export async function getFamilyTrash(userId: string, familyId: string, after?: { deleted_at: string; id: string }) {
  if (after && !timestamp(after.deleted_at)) throw new FamilyOperationError('Некорректное продолжение корзины.', 'invalid');
  const data = await rpc(userId, 'list_family_trash', { p_family_id: checkedId(familyId), p_before: after?.deleted_at ?? null, p_before_id: after ? checkedId(after.id) : null });
  if (!Array.isArray(data)) throw new FamilyOperationError('Не удалось прочитать корзину.', 'read');
  const rows = data.map((v): TrashMemory => {
    const r = object(v);
    if ((r.title !== null && typeof r.title !== 'string') || typeof r.event_date !== 'string' || !isValidDateIso(r.event_date)
      || !timestamp(r.deleted_at) || !Number.isSafeInteger(r.state_version) || (r.state_version as number) < 0
      || !Number.isSafeInteger(r.media_count) || (r.media_count as number) < 0) throw new FamilyOperationError('Не удалось прочитать запись корзины.', 'read');
    return { id: checkedId(r.id as string), title: r.title as string | null, event_date: r.event_date, deleted_at: r.deleted_at as string,
      state_version: r.state_version as number, media_count: r.media_count as number };
  });
  return { items: rows.slice(0,30), hasMore: rows.length > 30 };
}
