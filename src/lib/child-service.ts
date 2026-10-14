import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { currentLocalDateIso, isValidDateIso } from './date-utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_CHILD_NAME_LENGTH = 80;

export type ChildSubmission = {
  version: 1;
  userId: string;
  familyId: string;
  childId: string;
  name: string;
  birthDate: string;
};

export class ChildWriteError extends Error {
  constructor(message: string, public pending = false) {
    super(message);
    this.name = 'ChildWriteError';
  }
}

function storage() {
  if (typeof localStorage === 'undefined') {
    throw new Error('Local storage is unavailable.');
  }
  return localStorage;
}

function key(userId: string, familyId: string) {
  return `moya-istoriya:pending-child:v1:${userId}:${familyId}`;
}

export function getPendingFamilyChild(userId: string, familyId: string): ChildSubmission | null {
  try {
    const raw = storage().getItem(key(userId, familyId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error('Invalid journal.');
    const item = value as Partial<ChildSubmission>;
    if (item.version !== 1 || item.userId !== userId || item.familyId !== familyId
      || typeof item.childId !== 'string' || !UUID.test(item.childId)
      || !UUID.test(userId) || !UUID.test(familyId)
      || typeof item.name !== 'string' || !item.name.trim()
      || item.name !== item.name.trim() || item.name.length > MAX_CHILD_NAME_LENGTH
      || typeof item.birthDate !== 'string' || !isValidDateIso(item.birthDate)) {
      throw new Error('Invalid journal.');
    }
    return item as ChildSubmission;
  } catch {
    throw new ChildWriteError(
      'Не удалось прочитать незавершённое добавление ребёнка. Не создавайте дубликат: требуется проверка локального хранилища.', true,
    );
  }
}

async function requireSameAccount(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId) {
    throw new ChildWriteError('Вход изменился. Войдите в прежний аккаунт перед повторной проверкой.');
  }
}

async function requireMembership(userId: string, familyId: string) {
  await requireSameAccount(userId);
  const { data, error } = await supabase.from('family_members')
    .select('family_id').eq('user_id', userId).eq('family_id', familyId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ChildWriteError('Нет доступа к этой семье. Обновите семейные данные.');
  await requireSameAccount(userId);
}

type ChildRow = { id: string; family_id: string; name: string; birth_date: string };

function isExpectedChild(row: ChildRow, submission: ChildSubmission) {
  return row.id === submission.childId && row.family_id === submission.familyId
    && row.name === submission.name && row.birth_date === submission.birthDate;
}

async function findSubmission(submission: ChildSubmission) {
  await requireSameAccount(submission.userId);
  const { data, error } = await supabase.from('children')
    .select('id, family_id, name, birth_date')
    .eq('id', submission.childId).eq('family_id', submission.familyId).maybeSingle();
  if (error) throw error;
  await requireSameAccount(submission.userId);
  if (data && !isExpectedChild(data, submission)) {
    throw new Error('The existing child does not match the pending submission.');
  }
  return Boolean(data);
}

function pendingMessage(error: unknown) {
  if (error instanceof ChildWriteError) return error.message;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === '42501') {
    return 'Сервер не разрешил добавить ребёнка. Обновите доступ к семье и повторите проверку той же записи.';
  }
  return 'Сервер пока не подтвердил добавление. Нажмите «Проверить и повторить»: проверим ту же запись, не создавая второго ребёнка.';
}

async function commitChild(submission: ChildSubmission) {
  try {
    if (!await findSubmission(submission)) {
      await requireMembership(submission.userId, submission.familyId);
      // Explicit primary key + durable journal keep retries idempotent. Never upsert:
      // a conflict must be reconciled, not overwrite an existing child's data.
      const { data, error } = await supabase.from('children').insert({
        id: submission.childId,
        family_id: submission.familyId,
        name: submission.name,
        birth_date: submission.birthDate,
      }).select('id, family_id, name, birth_date').single();
      if (error) throw error;
      if (!data || !isExpectedChild(data, submission)) throw new Error('Unexpected insert response.');
      await requireSameAccount(submission.userId);
    }
  } catch (error) {
    try {
      if (await findSubmission(submission)) {
        clearJournal(submission);
        return submission.childId;
      }
    } catch {
      // Neither a lost response nor a failed read proves the insert did not commit.
    }
    throw new ChildWriteError(pendingMessage(error), true);
  }
  clearJournal(submission);
  return submission.childId;
}

function clearJournal(submission: ChildSubmission) {
  try {
    storage().removeItem(key(submission.userId, submission.familyId));
  } catch {
    // Safe to retain: next reconciliation finds the exact same row.
  }
}

const activeWrites = new Set<string>();

export async function createFamilyChild(input: {
  userId: string;
  familyId: string;
  name: string;
  birthDate: string;
}) {
  const writeKey = key(input.userId, input.familyId);
  if (activeWrites.has(writeKey)) throw new ChildWriteError('Добавление уже выполняется.');
  activeWrites.add(writeKey);
  try {
    if (!UUID.test(input.userId) || !UUID.test(input.familyId)) {
      throw new ChildWriteError('Не удалось определить семью. Откройте семейную историю заново.');
    }
    await requireSameAccount(input.userId);
    const pending = getPendingFamilyChild(input.userId, input.familyId);
    if (pending) return await commitChild(pending);
    const name = input.name.trim();
    if (!name || name.length > MAX_CHILD_NAME_LENGTH) {
      throw new ChildWriteError(`Введите имя ребёнка (до ${MAX_CHILD_NAME_LENGTH} символов).`);
    }
    if (!isValidDateIso(input.birthDate) || input.birthDate > currentLocalDateIso()) {
      throw new ChildWriteError('Выберите настоящую дату рождения, не позже сегодняшней.');
    }
    try {
      await requireMembership(input.userId, input.familyId);
    } catch (error) {
      if (error instanceof ChildWriteError) throw error;
      throw new ChildWriteError('Не удалось проверить доступ к семье. Проверьте подключение и попробуйте ещё раз.');
    }
    const submission: ChildSubmission = {
      version: 1, userId: input.userId, familyId: input.familyId,
      childId: Crypto.randomUUID(), name, birthDate: input.birthDate,
    };
    try {
      // No server write unless the submission can survive a process restart.
      storage().setItem(writeKey, JSON.stringify(submission));
    } catch {
      throw new ChildWriteError('Не удалось сохранить данные на устройстве. Ребёнок не отправлен на сервер; попробуйте ещё раз.');
    }
    return await commitChild(submission);
  } finally {
    activeWrites.delete(writeKey);
  }
}
