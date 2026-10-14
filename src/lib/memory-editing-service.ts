import { supabase } from './supabase';
import { currentLocalDateIso, isValidDateIso } from './date-utils';

export const MAX_MEMORY_TITLE_LENGTH = 120;
export const MAX_MEMORY_BODY_LENGTH = 4000;

export type MemoryDetails = {
  title: string | null;
  body: string | null;
  eventDate: string;
  childIds: string[];
};

export type EditableMemory = {
  id: string;
  familyId: string;
  authorId: string;
  hasMedia: boolean;
  requiresText?: boolean;
  details: MemoryDetails;
};

export type MemoryEditAttempt = {
  userId: string;
  familyId: string;
  memoryId: string;
  expected: MemoryDetails;
  desired: MemoryDetails;
};

type EditErrorKind = 'invalid' | 'unavailable' | 'forbidden' | 'scope' | 'conflict' | 'pending' | 'busy' | 'read';

export class MemoryEditError extends Error {
  constructor(message: string, public readonly kind: EditErrorKind) {
    super(message);
    this.name = 'MemoryEditError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new MemoryEditError('Не удалось определить воспоминание или семейное пространство.', 'invalid');
  }
  return value.toLowerCase();
}

function copyDetails(value: MemoryDetails): MemoryDetails {
  if (!value || (value.title !== null && typeof value.title !== 'string')
    || (value.body !== null && typeof value.body !== 'string')
    || typeof value.eventDate !== 'string' || !isValidDateIso(value.eventDate)
    || !Array.isArray(value.childIds) || value.childIds.length > 1000) {
    throw new MemoryEditError('Не удалось прочитать дату, текст или отметки детей.', 'invalid');
  }
  return {
    title: value.title,
    body: value.body,
    eventDate: value.eventDate,
    childIds: [...new Set(value.childIds.map(requireUuid))].sort(),
  };
}

function validateDesired(value: MemoryDetails): MemoryDetails {
  const details = copyDetails(value);
  details.title = details.title?.trim() || null;
  details.body = details.body?.trim() || null;
  if ((details.title?.length ?? 0) > MAX_MEMORY_TITLE_LENGTH
    || (details.body?.length ?? 0) > MAX_MEMORY_BODY_LENGTH) {
    throw new MemoryEditError('Заголовок — до 120 символов, текст — до 4000 символов.', 'invalid');
  }
  if (details.eventDate > currentLocalDateIso()) {
    throw new MemoryEditError('Дата события не может быть позже сегодняшней.', 'invalid');
  }
  return details;
}

function sameDetails(left: MemoryDetails, right: MemoryDetails) {
  return left.title === right.title && left.body === right.body
    && left.eventDate === right.eventDate
    && left.childIds.length === right.childIds.length
    && left.childIds.every((id, index) => id === right.childIds[index]);
}

function copyAttempt(value: MemoryEditAttempt): MemoryEditAttempt {
  return {
    userId: requireUuid(value.userId),
    familyId: requireUuid(value.familyId),
    memoryId: requireUuid(value.memoryId),
    expected: copyDetails(value.expected),
    desired: validateDesired(value.desired),
  };
}

export function validateMemoryEditAttempt(value: MemoryEditAttempt) { return copyAttempt(value); }

// Preserve the exact original text (including null/whitespace) for the conflict
// check. Normalize only the user's requested replacement, never the baseline.
export function prepareMemoryEdit(input: {
  userId: string;
  memory: EditableMemory;
  details: MemoryDetails;
}): MemoryEditAttempt {
  const attempt = copyAttempt({
    userId: input.userId, familyId: input.memory.familyId, memoryId: input.memory.id,
    expected: input.memory.details, desired: input.details,
  });
  if ((!input.memory.hasMedia || input.memory.requiresText) && !attempt.desired.title && !attempt.desired.body) {
    throw new MemoryEditError('У текстового воспоминания нужно оставить заголовок или текст.', 'invalid');
  }
  return attempt;
}

async function requireAccount(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId || !data.session.access_token) {
    throw new MemoryEditError('Вход изменился. Откройте воспоминание в нужном аккаунте.', 'scope');
  }
  return data.session;
}

export async function loadEditableMemory(input: {
  userId: string; familyId: string; memoryId: string;
}): Promise<EditableMemory> {
  const userId = requireUuid(input.userId);
  const familyId = requireUuid(input.familyId);
  const memoryId = requireUuid(input.memoryId);
  const session = await requireAccount(userId);
  const { data: membership, error: membershipError } = await supabase.from('family_members')
    .select('role').eq('user_id', userId).eq('family_id', familyId)
    .setHeader('Authorization', `Bearer ${session.access_token}`).maybeSingle();
  await requireAccount(userId);
  if (membershipError) throw new MemoryEditError('Не удалось проверить доступ к семье. Попробуйте ещё раз.', 'read');
  if (!membership) throw new MemoryEditError('В этом аккаунте нет доступа к выбранной семье.', 'forbidden');

  const readSession = await requireAccount(userId);
  const { data: row, error } = await supabase.from('memories')
    .select('id, family_id, author_id, title, body, event_date, diary_category, memory_children(child_id), media_files(id)')
    .eq('id', memoryId).eq('family_id', familyId)
    .setHeader('Authorization', `Bearer ${readSession.access_token}`).maybeSingle();
  await requireAccount(userId);
  if (error) throw new MemoryEditError('Не удалось загрузить воспоминание. Попробуйте ещё раз.', 'read');
  if (!row || (row.author_id !== userId && membership.role !== 'owner')) {
    throw new MemoryEditError('Редактировать можно свои воспоминания; владелец — любые в своей семье.', 'forbidden');
  }
  if (row.id !== memoryId || row.family_id !== familyId || !UUID.test(row.author_id)
    || !Array.isArray(row.memory_children) || !Array.isArray(row.media_files)) {
    throw new MemoryEditError('Сервер вернул неожиданные данные. Обновите семейную историю.', 'read');
  }
  return {
    id: memoryId, familyId, authorId: row.author_id, hasMedia: row.media_files.length > 0,
    requiresText: row.diary_category != null,
    details: copyDetails({
      title: row.title, body: row.body, eventDate: row.event_date,
      childIds: row.memory_children.map((link: { child_id: string }) => link.child_id),
    }),
  };
}

export async function reconcileMemoryEdit(input: MemoryEditAttempt): Promise<{
  status: 'matches_requested' | 'not_confirmed' | 'conflict';
  memory: EditableMemory;
}> {
  const attempt = copyAttempt(input);
  const memory = await loadEditableMemory(attempt);
  return {
    status: sameDetails(memory.details, attempt.desired) ? 'matches_requested'
      : sameDetails(memory.details, attempt.expected) ? 'not_confirmed' : 'conflict',
    memory,
  };
}

function payload(details: MemoryDetails) {
  return { title: details.title, body: details.body, event_date: details.eventDate, child_ids: details.childIds };
}

function knownRpcError(error: unknown): MemoryEditError | null {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === 'PGRST202') {
    return new MemoryEditError('Редактирование ещё не включено на сервере. Существующее воспоминание не изменено.', 'unavailable');
  }
  if (value?.code === '42501') {
    return new MemoryEditError('Сервер не разрешил редактирование. Обновите данные семьи.', 'forbidden');
  }
  if (value?.code === 'P0001' && value.message?.includes('MEMORY_EDIT_CONFLICT')) {
    return new MemoryEditError('Воспоминание уже изменилось. Загрузите актуальную версию перед исправлением.', 'conflict');
  }
  if (value?.code === '22023' || value?.code === '22007' || value?.code === '22008' || value?.code === '22P02') {
    return new MemoryEditError('Сервер отклонил дату, текст или отметки детей. Проверьте поля.', 'invalid');
  }
  return null;
}

const activeEdits = new Set<string>();

// Reviewed SQL 003 is deployed and verified. This service never uploads/removes files,
// inserts a memory or issues a fallback direct table UPDATE.
export async function saveMemoryEdit(input: MemoryEditAttempt): Promise<string> {
  const attempt = copyAttempt(input);
  const key = `${attempt.familyId}:${attempt.memoryId}`;
  if (activeEdits.has(key)) throw new MemoryEditError('Сохранение уже выполняется.', 'busy');
  activeEdits.add(key);
  try {
    const before = await reconcileMemoryEdit(attempt);
    if (before.status === 'matches_requested') return attempt.memoryId;
    if (before.status === 'conflict') {
      throw new MemoryEditError('Воспоминание уже изменилось. Загрузите актуальную версию перед исправлением.', 'conflict');
    }
    if ((!before.memory.hasMedia || before.memory.requiresText) && !attempt.desired.title && !attempt.desired.body) {
      throw new MemoryEditError('У текстового воспоминания нужно оставить заголовок или текст.', 'invalid');
    }
    const session = await requireAccount(attempt.userId);
    try {
      const { data, error } = await supabase.rpc('update_family_memory_details', {
        p_memory_id: attempt.memoryId, p_family_id: attempt.familyId,
        p_expected: payload(attempt.expected), p_details: payload(attempt.desired),
      }).setHeader('Authorization', `Bearer ${session.access_token}`);
      await requireAccount(attempt.userId);
      if (error) throw error;
      if (data !== attempt.memoryId) throw new Error('Unexpected edit RPC response.');
      return attempt.memoryId;
    } catch (error) {
      if (error instanceof MemoryEditError && error.kind === 'scope') throw error;
      const known = knownRpcError(error);
      if (known) throw known;
      try {
        const after = await reconcileMemoryEdit(attempt);
        if (after.status === 'matches_requested') return attempt.memoryId;
        if (after.status === 'conflict') {
          throw new MemoryEditError('Ответ не получен, а воспоминание уже отличается. Сначала загрузите актуальную версию.', 'conflict');
        }
      } catch (checkError) {
        if (checkError instanceof MemoryEditError
          && ['scope', 'conflict', 'forbidden'].includes(checkError.kind)) throw checkError;
      }
      // A read of the original state does not prove a timed-out transaction
      // cannot still complete. Retry only this attempt, with its original
      // expected snapshot; never silently rebase it onto a fresh server row.
      throw new MemoryEditError('Сервер пока не подтвердил исправление. Проверьте результат; повтор должен использовать те же исходные данные.', 'pending');
    }
  } finally {
    activeEdits.delete(key);
  }
}
