import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { isValidDateIso } from './date-utils';
import { parseCaptureDate } from './photo-date';
import { isDiaryCategory, type DiaryCategory } from './diary';
import { isVoiceAsset, type MemoryAsset } from './memory-asset';

export type PickerSnapshot = {
  title: string; body: string; eventDate: string; dateChosen: boolean;
  manualDate: boolean; archived: boolean; childIds: string[];
  assets: MemoryAsset[];
  diaryCategory?: DiaryCategory | null;
};
type PickerScope = { userId: string; familyId: string };
type PickerOutcome = { status: 'selected' | 'cancelled' | 'missing' | 'error'; assets: ImagePicker.ImagePickerAsset[]; limited?: true };
export type PickerAttempt = PickerScope & { id: string | null; snapshot: PickerSnapshot; outcome: PickerOutcome };
type PickerIntent = PickerScope & { version: 1; id: string; snapshot: PickerSnapshot; outcome: PickerOutcome | null };
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type NativeResult = ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult | null;

const JOURNAL_KEY = 'moya-istoriya:pending-picker:v1';
const options: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 5,
  allowsEditing: false, quality: 1, exif: true,
};

export class MediaPickerError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaPickerError'; }
}

function compactAsset(asset: MemoryAsset): MemoryAsset {
  if (typeof asset.uri !== 'string' || asset.uri.length > 4096 || !/^(file|content):\/\//.test(asset.uri)) {
    throw new Error('Invalid local media URI');
  }
  if (isVoiceAsset(asset)) {
    if (!['audio/mp4', 'audio/webm'].includes(asset.mimeType)) throw new Error('Invalid voice format');
    return { uri: asset.uri, type: 'audio', width: 0, height: 0, mimeType: asset.mimeType,
      fileName: asset.fileName, ...(Number.isFinite(asset.fileSize) ? { fileSize: asset.fileSize } : {}) };
  }
  const exif = asset.exif as Record<string, unknown> | null | undefined;
  const nested = exif?.['{Exif}'] ?? exif?.Exif;
  const nestedExif = typeof nested === 'object' && nested !== null ? nested as Record<string, unknown> : {};
  const original = [exif?.DateTimeOriginal, nestedExif.DateTimeOriginal]
    .find((value) => typeof value === 'string' && parseCaptureDate(value));
  // Keep original capture metadata only. Do not journal GPS or the entire EXIF.
  return {
    uri: asset.uri, width: Number.isFinite(asset.width) ? asset.width : 0,
    height: Number.isFinite(asset.height) ? asset.height : 0,
    ...(asset.type ? { type: asset.type } : {}),
    ...(typeof asset.assetId === 'string' ? { assetId: asset.assetId } : {}),
    ...(typeof asset.fileName === 'string' ? { fileName: asset.fileName } : {}),
    ...(typeof asset.mimeType === 'string' ? { mimeType: asset.mimeType } : {}),
    ...(Number.isFinite(asset.fileSize) ? { fileSize: asset.fileSize } : {}),
    ...(typeof original === 'string' ? { exif: { DateTimeOriginal: original } } : {}),
  };
}

function compactSnapshot(snapshot: PickerSnapshot): PickerSnapshot {
  if (snapshot.diaryCategory != null && !isDiaryCategory(snapshot.diaryCategory)) throw new Error('Invalid diary category');
  if (typeof snapshot.title !== 'string' || snapshot.title.length > 120
    || typeof snapshot.body !== 'string' || snapshot.body.length > 4000
    || !isValidDateIso(snapshot.eventDate) || typeof snapshot.dateChosen !== 'boolean'
    || typeof snapshot.manualDate !== 'boolean' || typeof snapshot.archived !== 'boolean'
    || !Array.isArray(snapshot.childIds) || !snapshot.childIds.every((id) => typeof id === 'string' && id.length > 0)
    || !Array.isArray(snapshot.assets) || snapshot.assets.length > 5) throw new Error('Invalid picker snapshot');
  return { title: snapshot.title, body: snapshot.body, eventDate: snapshot.eventDate,
    dateChosen: snapshot.dateChosen, manualDate: snapshot.manualDate, archived: snapshot.archived,
    childIds: [...snapshot.childIds], assets: snapshot.assets.map(compactAsset),
    ...(snapshot.diaryCategory !== undefined ? { diaryCategory: snapshot.diaryCategory } : {}) };
}

// The Android native pending slot is global and destructive to read. Every
// access is serialized and matched to an app-owned user/family/request marker.
export function createMediaPickerController(deps: {
  platform: () => string; storage: () => JournalStorage; randomId: () => string;
  launch: (options: ImagePicker.ImagePickerOptions) => Promise<ImagePicker.ImagePickerResult>;
  getPending: () => Promise<NativeResult>;
}) {
  let active: string | null = null;
  // A native pending result can be read only once. If local persistence fails,
  // keep its compact payload in memory for a retry while this JS process lives.
  let consumed: PickerIntent | null = null;
  function read(): PickerIntent | null {
    try {
      const raw = deps.storage().getItem(JOURNAL_KEY);
      if (!raw) return null;
      if (raw.length > 65536) throw new Error('Oversized picker journal');
      const value = JSON.parse(raw) as PickerIntent;
      if (value.version !== 1 || typeof value.id !== 'string' || !value.id
        || typeof value.userId !== 'string' || !value.userId || typeof value.familyId !== 'string' || !value.familyId) {
        throw new Error('Invalid picker marker');
      }
      const snapshot = compactSnapshot(value.snapshot);
      let outcome: PickerOutcome | null = null;
      if (value.outcome !== null) {
        if (!value.outcome || !['selected', 'cancelled', 'missing', 'error'].includes(value.outcome.status)
          || !Array.isArray(value.outcome.assets) || value.outcome.assets.length > 5
          || (value.outcome.limited !== undefined && value.outcome.limited !== true)) throw new Error('Invalid picker outcome');
        outcome = { status: value.outcome.status, assets: value.outcome.assets.map(compactAsset) as ImagePicker.ImagePickerAsset[],
          ...(value.outcome.limited ? { limited: true as const } : {}) };
      }
      return { version: 1, id: value.id, userId: value.userId, familyId: value.familyId, snapshot, outcome };
    } catch {
      throw new MediaPickerError('Не удалось прочитать незавершённый выбор файлов. Не очищайте данные приложения: сначала требуется проверка локального хранилища.');
    }
  }
  function matches(value: PickerScope, scope: PickerScope) {
    return value.userId === scope.userId && value.familyId === scope.familyId;
  }
  function write(intent: PickerIntent) {
    try {
      const raw = JSON.stringify(intent);
      if (raw.length > 65536) throw new Error('Oversized picker journal');
      deps.storage().setItem(JOURNAL_KEY, raw);
      if (deps.storage().getItem(JOURNAL_KEY) !== raw) throw new Error('Picker journal was not persisted');
    } catch {
      throw new MediaPickerError('Не удалось сохранить локальный выбор файлов. Проверьте свободное место и попробуйте снова.');
    }
  }
  function outcomeFor(result: NativeResult): PickerOutcome {
    if (!result) return { status: 'missing', assets: [] };
    if ('code' in result) return { status: 'error', assets: [] };
    if (result.canceled) return { status: 'cancelled', assets: [] };
    return { status: 'selected', assets: result.assets.slice(0, 5).map(compactAsset) as ImagePicker.ImagePickerAsset[],
      ...(result.assets.length > 5 ? { limited: true as const } : {}) };
  }
  function attemptFor(intent: PickerIntent): PickerAttempt {
    return { id: intent.id, userId: intent.userId, familyId: intent.familyId,
      snapshot: intent.snapshot, outcome: intent.outcome! };
  }
  function recordOutcome(intent: PickerIntent, outcome: PickerOutcome): PickerAttempt | null {
    const completed = { ...intent, outcome };
    consumed = completed;
    const current = read();
    if (!current || current.id !== intent.id || !matches(current, intent)) {
      consumed = null;
      return null;
    }
    // Persist a destructively-read native result before returning it to React.
    // If the route/account changed meanwhile, its original owner can recover it.
    write(completed);
    consumed = null;
    return attemptFor(completed);
  }
  function finish(id: string | null) {
    if (!id || deps.platform() !== 'android') return;
    if (read()?.id !== id) return; // Never clear a newer operation's marker.
    if (active === id) throw new MediaPickerError('Дождитесь результата выбора файлов.');
    try { deps.storage().removeItem(JOURNAL_KEY); }
    catch { throw new MediaPickerError('Не удалось завершить локальный выбор файлов. Повторите проверку перед сохранением.'); }
    if (read()?.id === id) throw new MediaPickerError('Локальный выбор файлов ещё не завершён. Повторите проверку перед сохранением.');
    if (consumed?.id === id) consumed = null;
  }
  return {
    hasPending(scope: PickerScope) {
      if (deps.platform() !== 'android') return false;
      const intent = read(); return Boolean(intent && matches(intent, scope));
    },
    async choose(scope: PickerScope, snapshot: PickerSnapshot): Promise<PickerAttempt> {
      if (active) throw new MediaPickerError('Медиатека уже открыта. Завершите предыдущий выбор.');
      const id = deps.randomId(); active = id;
      try {
        if (deps.platform() !== 'android') {
          const result = await deps.launch(options);
          return { ...scope, id: null, snapshot, outcome: { status: result.canceled ? 'cancelled' : 'selected', assets: result.assets ?? [] } };
        }
        read(); // Do not overwrite a corrupt recovery record.
        const intent: PickerIntent = { ...scope, version: 1, id, snapshot: compactSnapshot(snapshot), outcome: null };
        // An explicit new choice supersedes the device's previous native slot,
        // just as the SDK does. This never removes an actual media file.
        write(intent);
        consumed = null;
        let outcome: PickerOutcome;
        try { outcome = outcomeFor(await deps.launch(options)); }
        catch { outcome = { status: 'error', assets: [] }; }
        const attempt = recordOutcome(intent, outcome);
        if (!attempt) throw new MediaPickerError('Выбор файлов изменился. Откройте форму заново.');
        return attempt;
      } finally { if (active === id) active = null; }
    },
    async recover(scope: PickerScope): Promise<PickerAttempt | null> {
      if (deps.platform() !== 'android') return null;
      const intent = read();
      if (!intent || !matches(intent, scope)) return null;
      if (active) throw new MediaPickerError('Предыдущий выбор ещё выполняется. Повторите проверку после его завершения.');
      if (intent.outcome) return attemptFor(intent);
      if (consumed?.id === intent.id && matches(consumed, intent)) {
        return recordOutcome(consumed, consumed.outcome!);
      }
      active = intent.id;
      try {
        let outcome: PickerOutcome;
        try { outcome = outcomeFor(await deps.getPending()); }
        catch { outcome = { status: 'error', assets: [] }; }
        return recordOutcome(intent, outcome);
      } finally { if (active === intent.id) active = null; }
    },
    finish,
    clearBeforeSave(scope: PickerScope) {
      if (deps.platform() !== 'android') return;
      const intent = read();
      if (!intent || !matches(intent, scope)) return;
      if (active === intent.id) throw new MediaPickerError('Дождитесь результата выбора файлов.');
      finish(intent.id);
    },
  };
}

const controller = createMediaPickerController({
  platform: () => Platform.OS,
  storage: () => {
    if (typeof localStorage === 'undefined') throw new Error('Local storage unavailable');
    return localStorage;
  },
  randomId: () => Crypto.randomUUID(), launch: ImagePicker.launchImageLibraryAsync,
  getPending: ImagePicker.getPendingResultAsync,
});
export const hasPendingMediaPicker = controller.hasPending;
export const chooseFamilyMedia = controller.choose;
export const recoverFamilyMedia = controller.recover;
export const finishMediaPicker = controller.finish;
export const clearMediaPickerBeforeSave = controller.clearBeforeSave;
