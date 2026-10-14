import { colors } from '../../lib/theme';
import { StoryIcon } from '../../components/story-ui';
import { DiaryCategories } from '../../components/diary-categories';
import { VoiceRecorder } from '../../components/voice-recorder';
import { isVoiceAsset, type MemoryAsset } from '../../lib/memory-asset';
import { diaryCategories, isDiaryCategory, type DiaryCategory } from '../../lib/diary';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth-context';
import { navigationStage } from '../../lib/navigation-state';
import { currentLocalDateIso, formatRuDate } from '../../lib/date-utils';
import { photoCaptureDate, selectionCaptureDate } from '../../lib/photo-date';
import {
  hasPendingMediaPicker, chooseFamilyMedia, recoverFamilyMedia,
  finishMediaPicker, clearMediaPickerBeforeSave, MediaPickerError,
  type PickerSnapshot,
} from '../../lib/media-picker';
import {
  createFamilyMemory,
  getPendingFamilyMemory,
  MAX_MEDIA_FILE_SIZE,
  MemoryWriteError,
  type MemoryUploadProgress,
} from '../../lib/memory-service';

const MAX_SELECTED_FILES = 5;

function toDateIso(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function assetTypeLabel(asset: ImagePicker.ImagePickerAsset) {
  if (asset.type === 'video') return 'Видео';
  if (asset.type === 'image') return 'Фото';
  return 'Файл';
}

function progressLabel(progress: MemoryUploadProgress | null, pending: boolean) {
  if (!progress) return pending ? 'Проверяем результат…' : 'Подготавливаем запись…';
  if (progress.phase === 'checking') return 'Проверяем результат…';
  if (progress.phase === 'saving') return 'Сохраняем запись…';
  const action = progress.phase === 'uploading' ? 'Загружаем' : 'Подготавливаем';
  return progress.totalFiles > 0
    ? `${action} файл ${progress.completedFiles + 1} из ${progress.totalFiles}…`
    : 'Подготавливаем запись…';
}

export default function NewMemoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ childId?: string; archived?: string; diary?: string; category?: string }>();
  const [archived, setArchived] = useState(params.archived === '1');
  const auth = useAuth();
  const { family, session } = auth;
  const isFocused = useIsFocused();
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  const mounted = useRef(true);
  const busy = useRef(false);
  const pickerBusy = useRef(false);
  const initialScope = useRef({ userId: session?.user.id, familyId: family.status === 'ready' ? family.family.id : null });
  const currentScope = navigationStage(auth) === 'family' && session?.user.id === initialScope.current.userId
    && family.status === 'ready' && family.family.id === initialScope.current.familyId;
  const scope = useRef(currentScope);
  scope.current = currentScope;
  const currentChildren = useRef(family.status === 'ready' ? family.children : []);
  currentChildren.current = family.status === 'ready' ? family.children : [];
  const [restored] = useState(() => {
    if (family.status !== 'ready' || !session) return { submission: null, error: null };
    try {
      return { submission: getPendingFamilyMemory(session.user.id, family.family.id), error: null };
    } catch {
      return { submission: null, error: 'Не удалось прочитать незавершённое сохранение. Не создавайте дубликат; требуется проверка локального хранилища.' };
    }
  });
  const [pending, setPending] = useState(Boolean(restored.submission || restored.error));
  const [pickerRestore] = useState<{ pending: boolean; error: string | null }>(() => {
    if (restored.submission || restored.error || !session || family.status !== 'ready') return { pending: false, error: null };
    try {
      return { pending: hasPendingMediaPicker({ userId: session.user.id, familyId: family.family.id }), error: null };
    } catch (error) {
      return { pending: false, error: error instanceof MediaPickerError ? error.message : 'Не удалось проверить незавершённый выбор файлов.' };
    }
  });
  const needsPickerRecovery = useRef(pickerRestore.pending);
  const [recoveringMedia, setRecoveringMedia] = useState(pickerRestore.pending);
  const [pickerError, setPickerError] = useState<string | null>(pickerRestore.error);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const initialChildId = Array.isArray(params.childId) ? params.childId[0] : params.childId;
  const requestedCategory = Array.isArray(params.category) ? params.category[0] : params.category;
  const [diaryCategory, setDiaryCategory] = useState<DiaryCategory | null>(restored.submission
    ? restored.submission.diaryCategory ?? null : isDiaryCategory(requestedCategory) ? requestedCategory : null);
  const [diaryMode, setDiaryMode] = useState(restored.submission
    ? Boolean(restored.submission.diaryCategory) : params.diary === '1' || isDiaryCategory(requestedCategory));
  const category = diaryCategories.find((entry) => entry.id === diaryCategory);
  const allowsMedia = !diaryMode || diaryCategory === 'skills';
  const [title, setTitle] = useState(restored.submission?.title ?? '');
  const [body, setBody] = useState(restored.submission?.body ?? '');
  const [eventDate, setEventDate] = useState(restored.submission
    ? new Date(`${restored.submission.eventDate}T12:00:00`) : new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateChosen, setDateChosen] = useState(!archived || Boolean(restored.submission));
  const [assets, setAssets] = useState<MemoryAsset[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceBusyRef = useRef(false);
  const voiceAsset = assets.find(isVoiceAsset);
  const visualAssets = assets.filter((asset): asset is ImagePicker.ImagePickerAsset => !isVoiceAsset(asset));
  const [manualDate, setManualDate] = useState(Boolean(restored.submission));
  const captureDate = selectionCaptureDate(visualAssets, currentLocalDateIso());
  const [pickingMedia, setPickingMedia] = useState(false);
  const [childIds, setChildIds] = useState<string[]>(restored.submission?.childIds
    ?? (initialChildId ? [initialChildId] : family.status === 'ready' && family.children.length === 1 ? [family.children[0].id] : []));
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<MemoryUploadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(restored.error
    ?? (restored.submission ? 'Есть незавершённое сохранение. Проверим его без повторной загрузки файлов.' : null));
  const [saved, setSaved] = useState(false);
  const locked = loading || voiceBusy || pickingMedia || recoveringMedia || Boolean(pickerError) || pending || saved || !currentScope || Boolean(restored.error);
  const savingLabel = progressLabel(progress, pending);
  useEffect(() => {
    if (manualDate || pending || recoveringMedia || pickerError || !currentScope) return;
    if (captureDate.status === 'detected') {
      setEventDate(new Date(`${captureDate.date}T12:00:00`));
      setDateChosen(true);
    } else {
      setEventDate(new Date());
      setDateChosen(captureDate.status === 'empty' && !archived);
    }
  }, [captureDate.status, captureDate.date, manualDate, pending, archived, currentScope, recoveringMedia, pickerError]);
  // A protected-route removal on logout/recovery must not be blocked by a save.
  usePreventRemove(loading && currentScope, () => {
    setErrorMessage('Дождитесь результата сохранения.');
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (saved && isFocused && currentScope && !loading) {
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    }
  }, [saved, isFocused, currentScope, loading, router]);
  useEffect(() => {
    if (currentScope && isFocused && needsPickerRecovery.current && !pickerBusy.current) void handleRecoverMedia();
  }, [currentScope, isFocused]);

  if (family.status !== 'ready' || !currentScope) return null;
  const familyId = family.family.id;

  const mediaSection = allowsMedia ? <>
          <Text style={styles.label}>Фото или видео</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Выбрать фото или видео"
            disabled={locked || pickingMedia}
            onPress={() => void handlePickMedia()}
            style={({ pressed }) => [styles.addMediaButton, pressed && styles.pressed]}
          >
            <View style={styles.mediaIcon}><StoryIcon name="photo" size={28} color={colors.primary} /></View>
            <View style={styles.mediaActionInfo}><Text style={styles.addMediaText}>
              {recoveringMedia ? 'Восстанавливаем выбор…' : pickingMedia ? 'Открываем медиатеку…' : 'Выбрать фото или видео'}
            </Text><Text style={styles.mediaActionHint}>Из галереи вашего телефона</Text></View>
          </Pressable>
          <Text style={styles.helperText}>
            До 5 файлов · до 50 МБ каждый. Можно сохранить и без фото.
          </Text>
          {pickerNotice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{pickerNotice}</Text> : null}
          {restored.submission?.uploaded.length ? (
            <Text style={styles.helperText}>Уже загружено файлов: {restored.submission.uploaded.length}. Повторно выбирать их не нужно.</Text>
          ) : null}

          {visualAssets.length > 0 ? (
            <View style={styles.selectedList}>
              {visualAssets.map((asset) => (
                <View key={asset.assetId ?? asset.uri} style={styles.selectedRow}>
                  {asset.type === 'image' ? (
                    <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
                  ) : (
                    <View style={[styles.thumbnail, styles.videoThumbnail]}>
                      <Text style={styles.thumbnailPlay}>▶</Text>
                    </View>
                  )}
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileType}>{assetTypeLabel(asset)}</Text>
                    <Text style={styles.fileDate}>
                      {photoCaptureDate(asset) ? `Снято ${formatRuDate(photoCaptureDate(asset)!)}` : 'Дата съёмки недоступна'}
                    </Text>
                    <Text style={styles.fileSize}>
                      {asset.fileSize ? `${(asset.fileSize / (1024 * 1024)).toFixed(1)} МБ` : 'Размер проверим при сохранении'}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Убрать файл"
                    disabled={locked}
                    onPress={() => setAssets((current) => current.filter((item) => item.uri !== asset.uri))}
                    style={styles.removeFileButton}
                  >
                    <StoryIcon name="close" size={18} color={colors.ink} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
  </> : null;

  const childPicker = <>
          <View style={styles.childrenHeading}>
            <Text style={styles.label}>Кто на фото или в записи?</Text>
            <Text style={styles.optional}>Отметьте ребёнка</Text>
          </View>
          <View style={styles.chips}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="Для всей семьи без отметки ребёнка"
              accessibilityState={{ checked: childIds.length === 0 }} disabled={locked} onPress={() => { if (canEditChildren()) setChildIds([]); }}
              style={[styles.childChip, childIds.length === 0 && styles.childChipSelected]}>
              <Text style={[styles.childChipText, childIds.length === 0 && styles.childChipTextSelected]}>Вся семья</Text>
            </Pressable>
            {family.children.map((child) => {
              const selected = childIds.includes(child.id);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Связать воспоминание с ребёнком ${child.name}`}
                  disabled={locked}
                  accessibilityState={{ checked: selected }}
                  key={child.id}
                  onPress={() => toggleChild(child.id)}
                  style={[styles.childChip, selected && styles.childChipSelected]}
                >
                  <Text style={[styles.childChipText, selected && styles.childChipTextSelected]}>
                    {selected ? '✓ ' : ''}{child.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            Отметьте ребёнка, чтобы момент появился и в его альбоме. «Вся семья» сохраняет запись только в общем альбоме.
          </Text>

  </>;

  function pickerSnapshot(): PickerSnapshot {
    return { title, body, eventDate: toDateIso(eventDate), dateChosen, manualDate, archived, childIds, assets, diaryCategory };
  }

  function acceptAssets(previous: MemoryAsset[], selected: ImagePicker.ImagePickerAsset[], limited = false) {
    const oversized = selected.some((asset) => (asset.fileSize ?? 0) > MAX_MEDIA_FILE_SIZE);
    const combined = [...previous];
    for (const asset of selected.filter((item) => (item.fileSize ?? 0) <= MAX_MEDIA_FILE_SIZE)) {
      const identity = asset.assetId ?? asset.uri;
      if (!combined.some((item) => (item.assetId ?? item.uri) === identity)) combined.push(asset);
    }
    setAssets(combined.slice(0, MAX_SELECTED_FILES));
    if (limited || combined.length > MAX_SELECTED_FILES) setErrorMessage('За один раз можно добавить не больше пяти файлов.');
    else if (oversized) setErrorMessage('Файл больше 50 МБ и не был добавлен.');
  }

  async function handleRecoverMedia() {
    if (!mounted.current || pickerBusy.current || busy.current || pending || restored.error || !session || !scope.current || !focusedRef.current) return;
    pickerBusy.current = true;
    setRecoveringMedia(true);
    setPickerError(null);
    try {
      const attempt = await recoverFamilyMedia({ userId: session.user.id, familyId });
      if (!mounted.current || !scope.current || !focusedRef.current) return;
      if (!attempt) { needsPickerRecovery.current = false; return; }
      const snapshot = attempt.snapshot;
      setTitle(snapshot.title); setBody(snapshot.body);
      setDiaryCategory(snapshot.diaryCategory ?? null); setDiaryMode(Boolean(snapshot.diaryCategory));
      setEventDate(new Date(`${snapshot.eventDate}T12:00:00`));
      setDateChosen(snapshot.dateChosen); setManualDate(snapshot.manualDate); setArchived(snapshot.archived);
      setChildIds(snapshot.childIds.filter((id) => currentChildren.current.some((child) => child.id === id)));
      setErrorMessage(null);
      acceptAssets(snapshot.assets, attempt.outcome.assets, attempt.outcome.limited);
      setPickerNotice(attempt.outcome.status === 'selected'
        ? 'Восстановлен прерванный выбор файлов и поля формы. Проверьте дату и сохраните воспоминание.'
        : 'Поля прежней формы восстановлены, но Android не вернул новые файлы. При необходимости выберите их ещё раз.');
      finishMediaPicker(attempt.id);
      needsPickerRecovery.current = false;
    } catch (error) {
      if (mounted.current && scope.current) {
        needsPickerRecovery.current = true;
        setPickerError(error instanceof MediaPickerError ? error.message : 'Не удалось восстановить выбор файлов. Повторите проверку.');
      }
    } finally {
      pickerBusy.current = false;
      if (mounted.current) setRecoveringMedia(false);
    }
  }

  async function handlePickMedia() {
    if (!allowsMedia || !mounted.current || voiceBusyRef.current || pickerBusy.current || needsPickerRecovery.current || pickingMedia || locked || busy.current || !session || !scope.current || !focusedRef.current) return;
    // React state alone does not block two taps before the next render.
    pickerBusy.current = true;
    setPickingMedia(true);
    setErrorMessage(null);

    try {
      if (Platform.OS === 'ios') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!mounted.current || !scope.current || !focusedRef.current) return;
        if (!permission.granted) {
          setErrorMessage('Разрешите доступ к медиатеке, чтобы выбрать фото или видео.');
          return;
        }
      }

      const attempt = await chooseFamilyMedia({ userId: session.user.id, familyId }, pickerSnapshot());
      if (!mounted.current || !scope.current || !focusedRef.current) {
        if (attempt.id) needsPickerRecovery.current = true;
        return;
      }
      if (attempt.outcome.status === 'selected') acceptAssets(assets, attempt.outcome.assets, attempt.outcome.limited);
      else if (attempt.outcome.status === 'error') setErrorMessage('Не удалось открыть медиатеку. Попробуйте ещё раз.');
      finishMediaPicker(attempt.id);
      setPickerNotice(null);
    } catch (error) {
      if (mounted.current && scope.current) {
        if (error instanceof MediaPickerError) {
          needsPickerRecovery.current = true;
          setPickerError(error.message);
        } else setErrorMessage('Не удалось открыть медиатеку. Попробуйте ещё раз.');
      }
    } finally {
      pickerBusy.current = false;
      if (mounted.current) setPickingMedia(false);
    }
  }

  function toggleChild(childId: string) {
    if (!canEditChildren()) return;
    setChildIds((current) => current.includes(childId)
      ? current.filter((id) => id !== childId)
      : [...current, childId]);
  }

  function canEditChildren() {
    return !locked && !voiceBusyRef.current && mounted.current && scope.current && focusedRef.current && !busy.current
      && !pickerBusy.current && !needsPickerRecovery.current;
  }

  async function handleSave() {
    if (!mounted.current || voiceBusyRef.current || busy.current || pickerBusy.current || needsPickerRecovery.current || loading || saved || pickingMedia || recoveringMedia || pickerError || restored.error || !session || !scope.current || !focusedRef.current) return;
    if (!pending && diaryMode && !diaryCategory) { setErrorMessage('Выберите раздел дневника.'); return; }
    if (!pending && diaryMode && !title.trim() && !body.trim()) { setErrorMessage('Напишите несколько слов об этом событии.'); return; }
    if (!pending && !allowsMedia && visualAssets.length) { setErrorMessage('Фото и видео можно прикрепить к новым умениям.'); return; }
    if (!pending && visualAssets.length && !manualDate && captureDate.status !== 'detected') {
      setErrorMessage(captureDate.status === 'mixed'
        ? 'Фотографии сняты в разные дни. Добавьте их отдельными воспоминаниями или явно выберите одну общую дату события.'
        : captureDate.status === 'future'
          ? 'В фото указана будущая дата. Проверьте часы камеры и выберите правильную дату события.'
          : 'У файла нет доступной даты съёмки. Укажите дату события вручную — дату загрузки мы не подставляем.');
      return;
    }
    if (!dateChosen) {
      setErrorMessage('Для старой памяти укажите дату, когда произошло событие.');
      setShowDatePicker(true);
      return;
    }
    if (!pending && !title.trim() && !body.trim() && assets.length === 0) {
      setErrorMessage('Добавьте текст или выберите фото либо видео.');
      return;
    }

    Keyboard.dismiss();
    busy.current = true;
    setShowDatePicker(false);
    setErrorMessage(null);
    setProgress(null);
    setLoading(true);
    try {
      // Clear a stale picker marker before any upload/RPC, never after a commit.
      // Pending RPC reconciliation has priority over this unrelated local marker.
      if (!pending) clearMediaPickerBeforeSave({ userId: session.user.id, familyId });
      await createFamilyMemory({
        userId: session.user.id,
        familyId,
        childIds,
        title,
        body,
        eventDate: !manualDate && captureDate.status === 'detected' ? captureDate.date : toDateIso(eventDate),
        assets,
        diaryCategory,
        onProgress: (next) => {
          if (mounted.current && scope.current && busy.current) setProgress(next);
        },
      });
      if (mounted.current && scope.current) setSaved(true);
    } catch (error) {
      if (!mounted.current || !scope.current) return;
      setPending((previous) => previous || (error instanceof MemoryWriteError && error.pending));
      setErrorMessage(error instanceof MemoryWriteError || error instanceof MediaPickerError
        ? error.message
        : 'Не удалось сохранить воспоминание. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      if (mounted.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Назад"
              disabled={loading}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/home');
              }}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <StoryIcon name="back" />
            </Pressable>
            <Text style={styles.headerTitle}>{diaryMode ? category?.title ?? 'Новая запись' : 'Новый момент'}</Text>
            <View style={styles.headerSpacer} />
          </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.familyLabel}>{family.family.name}</Text>
          <Text style={styles.subtitle}>
            {diaryMode ? 'Запишите то, что хочется запомнить. Сохраните настоящий голос, а к новому умению добавьте фото или видео.' : 'Фото и видео сохраняются в галерее. Заметки и достижения — во вкладке «Записи».'}
          </Text>
          {diaryMode ? <>
            <Text style={styles.label}>Что запомним?</Text>
            <DiaryCategories selected={diaryCategory} disabled={locked} onSelect={(next) => {
              if (!canEditChildren() || next === 'all') return;
              if (visualAssets.length && next !== 'skills') { setErrorMessage('Сначала уберите фото и видео или оставьте раздел «Новые умения».'); return; }
              setDiaryCategory(next); setErrorMessage(null);
            }} />
            {category?.presets.length ? <View style={styles.chips}>{category.presets.map((preset) =>
              <Pressable key={preset} accessibilityRole="button" accessibilityLabel={preset} disabled={locked}
                onPress={() => { if (canEditChildren()) setTitle(preset); }} style={styles.childChip}>
                <Text style={styles.childChipText}>{preset}</Text>
              </Pressable>)}</View> : null}
          </> : null}
          {!diaryMode || category ? <>
          {!diaryMode ? mediaSection : null}
          {diaryMode ? childPicker : null}
          <Text style={styles.label}>Название · необязательно</Text>
          <TextInput
            accessibilityLabel="Заголовок воспоминания"
            editable={!locked}
            maxLength={120}
            onChangeText={setTitle}
            placeholder={category?.placeholder ?? 'Например, первая прогулка'}
            placeholderTextColor={colors.muted}
            returnKeyType="next"
            style={styles.input}
            value={title}
          />

          <Text style={styles.label}>Ваши слова</Text>
          <TextInput
            accessibilityLabel="Текст воспоминания"
            editable={!locked}
            maxLength={4000}
            multiline
            onChangeText={setBody}
            placeholder={diaryCategory === 'words' ? 'Какое слово прозвучало? Когда и как это случилось?' : diaryCategory === 'quotes' ? 'Запишите фразу ребёнка и маленькую историю вокруг неё' : diaryCategory === 'skills' ? 'Как всё получилось? Расскажите о новом умении' : 'Расскажите об этом дне'}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.bodyInput]}
            textAlignVertical="top"
            value={body}
          />

          <Text style={styles.label}>Когда это было?</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Дата события: ${formatRuDate(toDateIso(eventDate))}`}
            disabled={locked}
            onPress={() => {
              Keyboard.dismiss();
              setShowDatePicker(true);
            }}
            style={({ pressed }) => [styles.dateButton, pressed && styles.pressed]}
          >
            <Text style={styles.dateText}>{dateChosen ? formatRuDate(toDateIso(eventDate)) : 'Выберите дату события'}</Text>
            <StoryIcon name="calendar" size={20} color={colors.primary} />
          </Pressable>

          {showDatePicker ? (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                accessibilityLabel="Выбрать дату события"
                display="default"
                maximumDate={new Date()}
                mode="date"
                onDismiss={() => setShowDatePicker(false)}
                onValueChange={(_event, selectedDate) => {
                  if (selectedDate) {
                    setEventDate(selectedDate);
                    setDateChosen(true);
                    setManualDate(true);
                  }
                  if (Platform.OS === 'android') setShowDatePicker(false);
                }}
                startOnYearSelection
                value={eventDate}
              />
              {Platform.OS === 'ios' ? (
                <Pressable accessibilityRole="button" style={styles.dateButton}
                  onPress={() => { setDateChosen(true); setManualDate(true); setShowDatePicker(false); }}>
                  <Text style={styles.dateText}>Использовать выбранную дату</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {visualAssets.length ? (
            <View style={styles.dateNotice}>
              <Text style={styles.dateNoticeText}>
                {manualDate ? 'Дата задана вами. Она относится ко всему воспоминанию.'
                  : captureDate.status === 'detected' ? 'Дата съёмки подставлена из фото автоматически. Её можно изменить.'
                    : captureDate.status === 'mixed' ? 'Фото сняты в разные дни. Их даты показаны ниже. Для одной записи выберите общую дату или добавьте дни по отдельности.'
                      : captureDate.status === 'future' ? 'Камера записала будущую дату. Проверьте её и задайте дату события вручную.'
                        : 'У одного или нескольких файлов нет даты съёмки. Для них нужно указать дату события вручную.'}
              </Text>
              {manualDate && captureDate.status === 'detected' && !locked ? (
                <Pressable accessibilityRole="button" onPress={() => setManualDate(false)} style={styles.dateResetButton}>
                  <Text style={styles.addMediaText}>Использовать дату из фото</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {!diaryMode ? childPicker : mediaSection}
          {diaryMode && diaryCategory && !pending ? <VoiceRecorder asset={voiceAsset} disabled={locked}
            canAdd={assets.length < MAX_SELECTED_FILES} onBusyChange={next => {
              if (mounted.current && scope.current) { voiceBusyRef.current = next; setVoiceBusy(next); }
            }} onChange={voice => {
              if (!mounted.current || !scope.current || !focusedRef.current || busy.current || pickerBusy.current) return;
              setAssets(current => {
                const others = current.filter(asset => !isVoiceAsset(asset));
                return voice && others.length < MAX_SELECTED_FILES ? [...others, voice] : others;
              });
            }} /> : null}
          {pending && restored.submission?.uploaded.some(file => file.media_type === 'audio')
            ? <Text style={styles.helperText}>Голос уже загружен. Проверим сохранение без повторной записи.</Text> : null}
          </> : null}

        </ScrollView>
        <View style={styles.footer}>
          {pickerError ? <View>
            <Text accessibilityLiveRegion="polite" style={styles.errorMessage}>{pickerError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Повторить восстановление выбора"
              disabled={recoveringMedia || pickingMedia || loading} onPress={() => void handleRecoverMedia()} style={styles.dateButton}>
              <Text style={styles.dateText}>{recoveringMedia ? 'Проверяем выбор…' : 'Повторить проверку выбора'}</Text>
            </Pressable>
          </View> : null}
          {errorMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.errorMessage}>
              {errorMessage}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={loading ? savingLabel : 'Сохранить воспоминание'}
            disabled={loading || saved || pickingMedia || recoveringMedia || Boolean(pickerError) || Boolean(restored.error) || (diaryMode && !category && !pending)}
            onPress={() => void handleSave()}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, loading && styles.disabled]}
          >
            {loading ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text accessibilityLiveRegion="polite" style={styles.saveButtonText}>
              {loading ? savingLabel : pending ? 'Проверить и повторить' : 'Сохранить воспоминание'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 24,
    paddingHorizontal: 22,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 22,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backText: {
    color: colors.primary,
    fontSize: 32,
    lineHeight: 38,
    marginTop: -4,
  },
  headerTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  headerSpacer: {
    width: 44,
  },
  familyLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
  },
  subtitle: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 12,
    marginTop: 6,
  },
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
    marginTop: 15,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  bodyInput: {
    minHeight: 110,
    paddingBottom: 12,
    paddingTop: 12,
  },
  dateButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  dateText: {
    color: colors.ink,
    fontSize: 15,
  },
  dateNotice: {
    backgroundColor: colors.lavender,
    borderRadius: 14,
    marginTop: 10,
    padding: 12,
  },
  dateNoticeText: {
    color: colors.lavenderInk,
    fontSize: 12,
    lineHeight: 18,
  },
  dateResetButton: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
  },
  calendarIcon: {
    color: colors.primary,
    fontSize: 21,
  },
  pickerWrap: {
    alignItems: 'center',
    marginTop: 10,
  },
  childrenHeading: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  optional: {
    color: colors.muted,
    fontSize: 11,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  childChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    minHeight: 44,
  },
  childChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  childChipText: {
    color: colors.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  childChipTextSelected: {
    color: colors.primary,
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
  addMediaButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoft,
    borderRadius: 22,
    borderStyle: 'solid',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    justifyContent: 'center',
    minHeight: 102,
  },
  addMediaIcon: {
    color: colors.primary,
    fontSize: 23,
    marginRight: 8,
  },
  addMediaText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  selectedList: {
    gap: 8,
    marginTop: 12,
  },
  selectedRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 8,
  },
  thumbnail: {
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    height: 72,
    width: 72,
  },
  videoThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailPlay: {
    color: colors.primary,
    fontSize: 17,
  },
  fileInfo: {
    flex: 1,
    marginLeft: 11,
  },
  fileType: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  fileSize: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  fileDate: {
    color: colors.lavenderInk,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  removeFileButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  removeFileText: {
    color: colors.primary,
    fontSize: 24,
  },
  errorMessage: {
    backgroundColor: colors.errorSoft,
    borderRadius: 13,
    color: colors.error,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
    padding: 12,
  },
  mediaIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mediaActionInfo: { flex: 1, gap: 5 },
  mediaActionHint: { color: colors.secondary, fontSize: 12, lineHeight: 18 },
  footer: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 22, paddingVertical: 12, backgroundColor: colors.background, borderTopWidth: 1, borderColor: colors.border },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 56,
    padding: 14,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.76,
  },
});
