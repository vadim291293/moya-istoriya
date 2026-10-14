import * as Crypto from 'expo-crypto';
import { isVoiceAsset, MAX_VOICE_BYTES, type MemoryAsset } from './memory-asset';
import { supabase } from './supabase';
import { diaryFilterExpression, isDiaryCategory, type DiaryCategory, type DiaryFilter } from './diary';
import { readPickedMedia } from './media-file';
import { currentLocalDateIso, isValidDateIso } from './date-utils';
import type { MemoryDateRange } from './child-book';
import { createMemoryCursor, memoryCursorFilter, memoryPageOrder, type MemoryCursor } from './memory-pagination';
export type { MemoryCursor } from './memory-pagination';
import {
  clearSubmission, commitSubmission, PendingSubmissionError, readSubmission,
  writeSubmission, type MemorySubmission, type UploadedMedia,
} from './memory-submission';

export const FAMILY_MEDIA_BUCKET = 'family-media';
export const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024;
export const MEMORY_PAGE_SIZE = 10;

export type MemoryUploadProgress = {
  phase: 'preparing' | 'uploading' | 'checking' | 'saving';
  completedFiles: number;
  totalFiles: number;
};
type ProgressCallback = (progress: MemoryUploadProgress) => void;

function reportProgress(callback: ProgressCallback | undefined, progress: MemoryUploadProgress) {
  // A UI callback cannot turn a successful write into an upload rollback.
  try { callback?.(progress); } catch { /* Rendering feedback is best effort. */ }
}

async function requireSameAccount(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId || !data.session.access_token) {
    throw new MemoryWriteError('Вход изменился. Войдите в прежний аккаунт и повторите проверку.');
  }
  return data.session;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  // The recorder supplies audio/webm explicitly; a picked .webm stays video.
};

const SUPPORTED_MIME_TYPES = new Set([...Object.values(MIME_BY_EXTENSION), 'audio/webm']);

export type MemoryMedia = {
  id: string;
  storage_path: string;
  media_type: 'image' | 'video' | 'audio';
  mime_type: string;
  file_size: number;
  signed_url: string | null;
};

export type FamilyMemory = {
  id: string;
  title: string | null;
  body: string | null;
  event_date: string;
  memory_type: 'note' | 'photo' | 'video' | 'mixed';
  created_at: string;
  author_id: string;
  child_ids: string[];
  media: MemoryMedia[];
  diary_category?: DiaryCategory | null;
};

export type MemoryPage = {
  items: FamilyMemory[];
  hasMore: boolean;
  nextCursor: MemoryCursor | null;
};

export class MemoryWriteError extends Error {
  cleanupFailed: boolean;
  pending: boolean;

  constructor(message: string, cleanupFailed = false, pending = false) {
    super(message);
    this.name = 'MemoryWriteError';
    this.cleanupFailed = cleanupFailed;
    this.pending = pending;
  }
}

type MemoryRow = Omit<FamilyMemory, 'child_ids' | 'media'> & {
  memory_children?: Array<{ child_id: string }> | null;
  media_files?: Array<Omit<MemoryMedia, 'signed_url'>> | null;
};

function messageForError(error: unknown, operation: 'read' | 'write' = 'write') {
  const value = error as {
    code?: string;
    status?: number;
    statusCode?: number;
    message?: string;
  };
  const message = value?.message ?? '';

  if (value?.code === '42501' || /permission denied/i.test(message)) {
    return 'Supabase пока не разрешает эту операцию. Нужно проверить таблицы и правила доступа.';
  }
  if (/bucket.*not found|bucket not found/i.test(message)) {
    return 'Приватное хранилище ещё не настроено в Supabase.';
  }
  if (value?.status === 413 || value?.statusCode === 413 || /file too large|entity too large/i.test(message)) {
    return 'Файл превышает доступный лимит 50 МБ.';
  }
  if (value?.code === 'PGRST202' || value?.code === 'PGRST205' || /create_family_memory/i.test(message)) {
    return 'Таблицы воспоминаний ещё не настроены в Supabase.';
  }

  return operation === 'read'
    ? 'Не удалось загрузить воспоминания. Проверьте соединение и попробуйте ещё раз.'
    : 'Не удалось сохранить воспоминание. Проверьте соединение и попробуйте ещё раз.';
}

function extensionFor(asset: MemoryAsset) {
  const suppliedName = asset.fileName ?? asset.uri.split('?')[0].split('/').pop() ?? '';
  const extension = suppliedName.split('.').pop()?.toLowerCase() ?? '';
  return extension in MIME_BY_EXTENSION ? extension : null;
}

function mediaDetails(asset: MemoryAsset) {
  const extension = extensionFor(asset);
  const declaredMimeType = asset.mimeType?.split(';')[0].trim().toLowerCase();
  // A generic/missing MIME may use the extension. A known incompatible MIME
  // must not be relabelled as JPEG just because a provider supplied that name.
  if (declaredMimeType && declaredMimeType !== 'application/octet-stream' && !SUPPORTED_MIME_TYPES.has(declaredMimeType)) {
    throw new MemoryWriteError('Этот формат файла пока не поддерживается. Выберите JPEG, PNG, WEBP, HEIC/HEIF или MP4, MOV, WEBM.');
  }
  const mimeType = declaredMimeType && SUPPORTED_MIME_TYPES.has(declaredMimeType)
    ? declaredMimeType
    : extension
      ? MIME_BY_EXTENSION[extension]
      : null;

  if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new MemoryWriteError('Этот формат файла пока не поддерживается.');
  }

  const mediaType = mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'image';
  if ((asset.type === 'audio') !== (mediaType === 'audio')) {
    throw new MemoryWriteError('Не удалось определить формат голосовой записи.');
  }
  if (asset.type === 'video' && mediaType !== 'video') {
    throw new MemoryWriteError('Не удалось определить формат выбранного видео.');
  }
  if (asset.type === 'image' && mediaType !== 'image') {
    throw new MemoryWriteError('Не удалось определить формат выбранной фотографии.');
  }

  const resolvedExtension = mimeType === 'audio/webm' ? 'webm' : Object.entries(MIME_BY_EXTENSION)
    .find(([, value]) => value === mimeType)?.[0];
  if (!resolvedExtension) {
    throw new MemoryWriteError('Не удалось определить расширение выбранного файла.');
  }

  return { mediaType, mimeType, extension: resolvedExtension } as const;
}

function memoryTypeFor(
  title: string,
  body: string,
  uploaded: Array<{ media_type: 'image' | 'video' | 'audio' }>,
): FamilyMemory['memory_type'] {
  if (uploaded.length === 0) return 'note';
  if (uploaded.every(file => file.media_type === 'audio')) return 'note';
  if (title.trim() || body.trim()) return 'mixed';

  const types = new Set(uploaded.map((item) => item.media_type));
  if (types.size > 1) return 'mixed';
  return types.has('video') ? 'video' : 'photo';
}

function journalStorage() {
  if (typeof localStorage === 'undefined') {
    throw new MemoryWriteError('Не удалось открыть локальное хранилище. Перезапустите приложение.');
  }
  return localStorage;
}

export function getPendingFamilyMemory(userId: string, familyId: string) {
  try {
    return readSubmission(journalStorage(), userId, familyId);
  } catch {
    throw new MemoryWriteError('Не удалось прочитать незавершённое сохранение. Не отправляйте его заново: требуется проверка локального хранилища.', false, true);
  }
}

async function completeSubmission(submission: MemorySubmission, onProgress?: ProgressCallback) {
  const progress = (phase: 'checking' | 'saving') => reportProgress(onProgress, {
    phase, completedFiles: submission.uploaded.length, totalFiles: submission.uploaded.length,
  });
  try {
    const id = await commitSubmission(submission, {
      exists: async (attempt) => {
        progress('checking');
        const session = await requireSameAccount(submission.userId);
        let query = supabase.from('memories').select('id')
          .eq('id', attempt.memoryId).eq('family_id', attempt.familyId)
          .eq('author_id', attempt.userId);
        if (attempt.diaryCategory) query = query.eq('diary_category', attempt.diaryCategory);
        const { data, error } = await query.setHeader('Authorization', `Bearer ${session.access_token}`).maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      insert: async (attempt) => {
        const session = await requireSameAccount(submission.userId);
        progress('saving');
        const { data, error } = await supabase.rpc('create_family_memory', {
          p_memory_id: attempt.memoryId,
          p_family_id: attempt.familyId,
          p_title: attempt.title || null,
          p_body: attempt.body || null,
          p_event_date: attempt.eventDate,
          p_memory_type: attempt.memoryType,
          p_child_ids: attempt.childIds,
          p_media_files: attempt.uploaded,
          ...(attempt.diaryCategory ? { p_diary_category: attempt.diaryCategory } : {}),
        }).setHeader('Authorization', `Bearer ${session.access_token}`);
        if (error) throw error;
        if (data !== attempt.memoryId) throw new Error('Unexpected memory RPC response.');
        await requireSameAccount(submission.userId);
      },
    });
    try { clearSubmission(journalStorage(), submission); } catch {
      // A remaining journal is safe: the next check finds the committed row.
    }
    return id;
  } catch (error) {
    if (error instanceof PendingSubmissionError) {
      throw new MemoryWriteError(error.message, false, true);
    }
    throw error;
  }
}

const activeWrites = new Set<string>();

export async function createFamilyMemory(input: {
  userId: string;
  familyId: string;
  childIds: string[];
  title: string;
  body: string;
  eventDate: string;
  assets: MemoryAsset[];
  diaryCategory?: DiaryCategory | null;
  onProgress?: ProgressCallback;
}) {
  const writeKey = `${input.userId}:${input.familyId}`;
  if (activeWrites.has(writeKey)) throw new MemoryWriteError('Сохранение уже выполняется.');
  activeWrites.add(writeKey);
  try {
    await requireSameAccount(input.userId);
    const pending = getPendingFamilyMemory(input.userId, input.familyId);
    if (pending) return await completeSubmission(pending, input.onProgress);
    return await uploadAndSubmit(input);
  } finally {
    activeWrites.delete(writeKey);
  }
}

async function uploadAndSubmit(input: {
  userId: string;
  familyId: string;
  childIds: string[];
  title: string;
  body: string;
  eventDate: string;
  assets: MemoryAsset[];
  diaryCategory?: DiaryCategory | null;
  onProgress?: ProgressCallback;
}) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (input.diaryCategory != null) {
    if (!isDiaryCategory(input.diaryCategory)) throw new MemoryWriteError('Выберите раздел дневника.');
    if (!title && !body) throw new MemoryWriteError('Напишите несколько слов об этом событии.');
    if (input.diaryCategory !== 'skills' && input.assets.some(asset => !isVoiceAsset(asset))) {
      throw new MemoryWriteError('Фото и видео можно прикрепить только к новым умениям.');
    }
  }
  if (!input.diaryCategory && input.assets.some(isVoiceAsset)) {
    throw new MemoryWriteError('Голосовую запись можно сохранить только в дневнике.');
  }
  if (input.assets.filter(isVoiceAsset).length > 1) throw new MemoryWriteError('К заметке можно прикрепить одну голосовую запись.');
  if (!title && !body && input.assets.length === 0) {
    throw new MemoryWriteError('Добавьте текст или хотя бы один файл.');
  }
  if (input.assets.length > 5) {
    throw new MemoryWriteError('За один раз можно добавить не больше пяти файлов.');
  }
  if (!isValidDateIso(input.eventDate) || input.eventDate > currentLocalDateIso()) {
    throw new MemoryWriteError('Укажите корректную дату события, не позже сегодняшней.');
  }
  // Validate the entire selection before the first file is read or uploaded.
  const detailsByAsset = input.assets.map((asset) => {
    if (asset.fileSize !== undefined && asset.fileSize > (isVoiceAsset(asset) ? MAX_VOICE_BYTES : MAX_MEDIA_FILE_SIZE)) {
      throw new MemoryWriteError(isVoiceAsset(asset) ? 'Голосовая запись превышает лимит 5 МБ.' : 'Файл превышает доступный лимит 50 МБ.');
    }
    return mediaDetails(asset);
  });

  const memoryId = Crypto.randomUUID();
  const uploaded: UploadedMedia[] = [];
  const attemptedPaths: string[] = [];
  let submission: MemorySubmission;

  try {
    for (const [index, asset] of input.assets.entries()) {
      await requireSameAccount(input.userId);
      reportProgress(input.onProgress, { phase: 'preparing', completedFiles: index, totalFiles: input.assets.length });
      const details = detailsByAsset[index];
      const maxBytes = isVoiceAsset(asset) ? MAX_VOICE_BYTES : MAX_MEDIA_FILE_SIZE;
      const buffer = await readPickedMedia(asset, maxBytes);
      const fileSize = buffer.byteLength;

      if (fileSize < 1) {
        throw new MemoryWriteError('Не удалось прочитать выбранный файл.');
      }
      if (fileSize > maxBytes) {
        throw new MemoryWriteError(isVoiceAsset(asset) ? 'Голосовая запись превышает лимит 5 МБ.' : 'Файл превышает доступный лимит 50 МБ.');
      }
      // Reading may take time. Recheck and bind this request's Authorization
      // header to that exact session, not a later account in the global client.
      const session = await requireSameAccount(input.userId);

      const id = Crypto.randomUUID();
      const storagePath = `${input.familyId}/${memoryId}/${id}.${details.extension}`;
      attemptedPaths.push(storagePath);
      reportProgress(input.onProgress, { phase: 'uploading', completedFiles: index, totalFiles: input.assets.length });
      const { error } = await supabase.storage
        .from(FAMILY_MEDIA_BUCKET)
        .upload(storagePath, buffer, {
          cacheControl: '3600',
          contentType: details.mimeType,
          upsert: false,
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

      if (error) throw error;

      uploaded.push({
        id,
        storage_path: storagePath,
        media_type: details.mediaType,
        mime_type: details.mimeType,
        file_size: fileSize,
      });
    }

    await requireSameAccount(input.userId);
    submission = {
      version: 1, userId: input.userId, familyId: input.familyId, memoryId,
      title, body, eventDate: input.eventDate, memoryType: memoryTypeFor(title, body, uploaded),
      childIds: [...new Set(input.childIds)], uploaded,
      ...(input.diaryCategory ? { diaryCategory: input.diaryCategory } : {}),
    };
    // Persist before starting the RPC. Quota/storage failure aborts before SQL.
    writeSubmission(journalStorage(), submission);
  } catch (error) {
    if (attemptedPaths.length > 0) {
      try {
        // Do not issue a cleanup with an already changed account. RLS remains
        // authoritative if the session changes while this request is in flight.
        await requireSameAccount(input.userId);
        const { error: cleanupError } = await supabase.storage
          .from(FAMILY_MEDIA_BUCKET).remove(attemptedPaths);
        if (cleanupError) throw cleanupError;
      } catch {
        throw new MemoryWriteError(
          'Не удалось завершить сохранение и очистить временные файлы. Файлы остались в приватном хранилище; не отправляйте их повторно, пока не обновите ленту.',
          true,
        );
      }
    }

    if (error instanceof MemoryWriteError) throw error;
    throw new MemoryWriteError(messageForError(error));
  }
  // This phase must not enter the upload rollback handler.
  return completeSubmission(submission, input.onProgress);
}

export async function getFamilyMemories(input: {
  familyId: string;
  childId?: string;
  dateRange?: MemoryDateRange;
  ascending?: boolean;
  orderBy?: 'event' | 'added';
  diary?: DiaryFilter;
  after?: MemoryCursor | null;
  limit?: number;
}): Promise<MemoryPage> {
  const limit = input.limit ?? MEMORY_PAGE_SIZE;
  const { fromInclusive, toExclusive } = input.dateRange ?? {};
  if ((fromInclusive !== undefined && !isValidDateIso(fromInclusive)) ||
      (toExclusive !== undefined && !isValidDateIso(toExclusive)) ||
      (fromInclusive && toExclusive && fromInclusive >= toExclusive)) {
    throw new MemoryWriteError('Не удалось определить даты главы. Откройте книгу заново.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new MemoryWriteError('Не удалось определить страницу воспоминаний. Откройте книгу заново.');
  }
  const childSelection = input.childId
    ? 'memory_children!inner(child_id)'
    : 'memory_children(child_id)';
  // A child's book follows event time. The family activity feed follows when
  // a memory was added, so a newly uploaded old photo is not hidden at the end.
  const { primary: primaryOrder, secondary: secondaryOrder, ascending } = memoryPageOrder(input);
  let afterFilter: string | null = null;
  try {
    if (input.after !== undefined && input.after !== null) afterFilter = memoryCursorFilter(input.after, input);
  } catch {
    throw new MemoryWriteError('Не удалось определить страницу воспоминаний. Обновите альбом.');
  }

  let query = supabase
    .from('memories')
    .select(
      `id, title, body, event_date, memory_type, diary_category, created_at, author_id, ${childSelection}, media_files(id, storage_path, media_type, mime_type, file_size)`,
    )
    .eq('family_id', input.familyId)
    .order(primaryOrder, { ascending })
    .order(secondaryOrder, { ascending })
    .order('id', { ascending })
    .order('created_at', { ascending: true, referencedTable: 'media_files' })
    .order('id', { ascending: true, referencedTable: 'media_files' });

  if (input.childId) {
    query = query.eq('memory_children.child_id', input.childId);
  }
  if (fromInclusive) query = query.gte('event_date', fromInclusive);
  if (toExclusive) query = query.lt('event_date', toExclusive);
  // Use a single .or(): a second call would overwrite the PostgREST parameter.
  const diaryFilter = input.diary ? diaryFilterExpression(input.diary) : null;
  if (diaryFilter && afterFilter) query = query.or(`and(or(${diaryFilter}),or(${afterFilter}))`);
  else if (diaryFilter || afterFilter) query = query.or((diaryFilter ?? afterFilter)!);

  const { data, error } = await query.limit(limit + 1);
  if (error) throw new MemoryWriteError(messageForError(error, 'read'));

  const rows = (data ?? []) as unknown as MemoryRow[];
  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  let nextCursor: MemoryCursor | null = null;
  if (hasMore) {
    try { nextCursor = createMemoryCursor(pageRows[pageRows.length - 1], input); }
    catch { throw new MemoryWriteError('Не удалось определить следующую страницу. Обновите альбом.'); }
  }
  const items = await Promise.all(
    pageRows.map(async (row): Promise<FamilyMemory> => {
      const media = await Promise.all(
        (row.media_files ?? []).map(async (file): Promise<MemoryMedia> => {
          try {
            const { data: signed, error: signedError } = await supabase.storage
              .from(FAMILY_MEDIA_BUCKET)
              .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
            return { ...file, signed_url: signedError ? null : signed?.signedUrl ?? null };
          } catch {
            return { ...file, signed_url: null };
          }
        }),
      );

      return {
        id: row.id,
        title: row.title,
        body: row.body,
        event_date: row.event_date,
        memory_type: row.memory_type,
        diary_category: row.diary_category ?? null,
        created_at: row.created_at,
        author_id: row.author_id,
        child_ids: (row.memory_children ?? []).map((link) => link.child_id),
        media,
      };
    }),
  );

  return {
    items,
    hasMore,
    nextCursor,
  };
}
