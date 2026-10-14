import { isDiaryCategory, type DiaryCategory } from './diary';

export type UploadedMedia = {
  id: string;
  storage_path: string;
  media_type: 'image' | 'video' | 'audio';
  mime_type: string;
  file_size: number;
};

export type MemorySubmission = {
  version: 1;
  userId: string;
  familyId: string;
  memoryId: string;
  title: string;
  body: string;
  eventDate: string;
  childIds: string[];
  memoryType: 'note' | 'photo' | 'video' | 'mixed';
  diaryCategory?: DiaryCategory | null;
  uploaded: UploadedMedia[];
};

type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function journalKey(userId: string, familyId: string) {
  return `moya-istoriya:pending-memory:v1:${userId}:${familyId}`;
}

export function readSubmission(storage: JournalStorage, userId: string, familyId: string) {
  const raw = storage.getItem(journalKey(userId, familyId));
  if (!raw) return null;
  const value = JSON.parse(raw) as MemorySubmission;
  if (value.version !== 1 || value.userId !== userId || value.familyId !== familyId
    || typeof value.memoryId !== 'string' || typeof value.title !== 'string'
    || typeof value.body !== 'string' || typeof value.eventDate !== 'string'
    || !Array.isArray(value.childIds) || !value.childIds.every((id) => typeof id === 'string')
    || !['note', 'photo', 'video', 'mixed'].includes(value.memoryType)
    || (value.diaryCategory != null && !isDiaryCategory(value.diaryCategory))
    || (value.diaryCategory != null && value.diaryCategory !== 'skills'
      && value.uploaded?.some(media => media.media_type !== 'audio'))
    || (value.diaryCategory == null && value.uploaded?.some(media => media.media_type === 'audio'))
    || !Array.isArray(value.uploaded) || value.uploaded.length > 5
    || value.uploaded.filter(media => media.media_type === 'audio').length > 1
    || !value.uploaded.every((media) => typeof media.id === 'string'
      && typeof media.storage_path === 'string'
      && media.storage_path.startsWith(`${familyId}/${value.memoryId}/`)
      && ['image', 'video', 'audio'].includes(media.media_type)
      && (media.media_type !== 'audio' || (['audio/mp4', 'audio/webm'].includes(media.mime_type) && media.file_size > 0 && media.file_size <= 5242880))
      && typeof media.mime_type === 'string' && Number.isFinite(media.file_size))) {
    throw new Error('Invalid pending memory journal.');
  }
  return value;
}

export function writeSubmission(storage: JournalStorage, submission: MemorySubmission) {
  storage.setItem(journalKey(submission.userId, submission.familyId), JSON.stringify(submission));
}

export function clearSubmission(storage: JournalStorage, submission: MemorySubmission) {
  storage.removeItem(journalKey(submission.userId, submission.familyId));
}

export class PendingSubmissionError extends Error {
  constructor() {
    super('Сервер пока не подтвердил сохранение. Нажмите «Проверить и повторить»: мы проверим то же воспоминание без повторной загрузки файлов.');
    this.name = 'PendingSubmissionError';
  }
}

// A failed HTTP response does not prove a transaction failed. Never delete media
// after submission; reconcile/retry the same primary key (also after a restart).
export async function commitSubmission(
  submission: MemorySubmission,
  transport: {
    exists: (submission: MemorySubmission) => Promise<boolean>;
    insert: (submission: MemorySubmission) => Promise<void>;
  },
) {
  try {
    if (await transport.exists(submission)) return submission.memoryId;
    await transport.insert(submission);
    return submission.memoryId;
  } catch {
    try {
      if (await transport.exists(submission)) return submission.memoryId;
    } catch {
      // Preserve the journal and uploaded objects until the outcome is known.
    }
    throw new PendingSubmissionError();
  }
}
