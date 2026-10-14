import { colors } from '../lib/theme';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ChildSummary } from '../lib/auth-context';
import type { MemoryDateRange } from '../lib/child-book';
import { formatAgeAtDate } from '../lib/date-utils';
import { galleryDateRange, galleryMonths } from '../lib/memory-gallery';
import {
  type FamilyMemory,
  type MemoryCursor,
  getFamilyMemories,
  MemoryWriteError,
  MEMORY_PAGE_SIZE,
} from '../lib/memory-service';
import type { MemoryListChrome } from './memory-list';
import { StoryIcon } from './story-ui';
import { MemoryGallery } from './memory-gallery';
import { MemoryVideoList } from './memory-video-list';
import { MemoryDiaryList } from './memory-diary-list';
import { DiaryCategories } from './diary-categories';
import type { DiaryFilter } from '../lib/diary';

function memoryContext(memory: FamilyMemory, children: ChildSummary[]) {
  const linked = children.filter((child) => memory.child_ids.includes(child.id));
  if (linked.length === 0) return undefined;

  const captions = linked.map((child) => {
    const age = formatAgeAtDate(child.birth_date, memory.event_date);
    if (linked.length === 1) return age ? `Нам ${age}` : child.name;
    return age ? `${child.name} · ${age}` : child.name;
  });

  return captions.join('  •  ');
}

export function FamilyMemoryFeed({
  familyId,
  children,
  childId,
  dateRange,
  chapterTitle,
  chronological = false,
  showAddButton = true,
  showViewSwitch = true,
  showDateFilter = true,
  mediaOrder,
  initialView = 'list',
  onOpenRecords,
  header,
  editorUserId,
  isFamilyOwner = false,
}: {
  familyId: string;
  children: ChildSummary[];
  childId?: string;
  dateRange?: MemoryDateRange;
  chapterTitle?: string;
  chronological?: boolean;
  showAddButton?: boolean;
  showViewSwitch?: boolean;
  showDateFilter?: boolean;
  mediaOrder?: 'event' | 'added';
  initialView?: 'gallery' | 'video' | 'list';
  onOpenRecords?: () => void;
  header?: ReactNode;
  editorUserId?: string;
  isFamilyOwner?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [diaryCategory, setDiaryCategory] = useState<DiaryFilter>('all');
  const diary = view === 'list' ? diaryCategory : undefined;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [period, setPeriod] = useState<{ owner: string; year: number; month: number | null } | null>(null);
  const [memories, setMemories] = useState<FamilyMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const moreBusy = useRef(false);
  const firstBusy = useRef(false);
  const child = children.find((item) => item.id === childId);
  const owner = JSON.stringify([familyId, childId, dateRange]);
  const selectedPeriod = showDateFilter && period?.owner === owner ? period : null;
  const selectedRange = !dateRange && selectedPeriod ? galleryDateRange(selectedPeriod.year, selectedPeriod.month) : dateRange;
  const fromInclusive = selectedRange?.fromInclusive;
  const toExclusive = selectedRange?.toExclusive;
  const orderBy = mediaOrder ?? (view !== 'list' ? 'event' : undefined);
  const scope = JSON.stringify([familyId, childId, fromInclusive, toExclusive, chronological, view, orderBy, showDateFilter, diary]);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const loadedScope = useRef(scope);
  const continuation = useRef<{ scope: string; hasMore: boolean; cursor: MemoryCursor | null }>({ scope, hasMore: false, cursor: null });
  const visibleMemories = loadedScope.current === scope ? memories : [];
  const latestMemories = useRef(visibleMemories); latestMemories.current = visibleMemories;
  const editingScope = useRef({ editorUserId, isFamilyOwner }); editingScope.current = { editorUserId, isFamilyOwner };
  const canEditMemory = (memory: FamilyMemory) => Boolean(editingScope.current.editorUserId
    && (editingScope.current.isFamilyOwner || memory.author_id === editingScope.current.editorUserId));
  function editMemory(memory: FamilyMemory) {
    if (!active.current || latestScope.current !== scope || !canEditMemory(memory)
      || !latestMemories.current.includes(memory)) return;
    router.push({ pathname: '/memory/[id]', params: { id: memory.id } });
  }
  const displayYear = selectedPeriod?.year ?? (Number(visibleMemories[0]?.event_date.slice(0, 4)) || new Date().getFullYear());

  function selectPeriod(year: number, month: number | null) {
    if (!active.current || latestScope.current !== scope || year < 1 || year > 9998) return;
    setPeriod({ owner, year, month });
  }

  const loadFirstPage = useCallback(async () => {
    if (!active.current || latestScope.current !== scope) return;
    const request = ++generation.current;
    const isActive = () => active.current && latestScope.current === scope && request === generation.current;
    firstBusy.current = true;
    moreBusy.current = false;
    setLoadingMore(false);
    setLoading(true);
    setErrorMessage(null);
    setMoreError(null);
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      setMemories([]);
      setHasMore(false);
      continuation.current = { scope, hasMore: false, cursor: null };
    }
    try {
      const page = await getFamilyMemories({
        familyId,
        childId,
        dateRange: { fromInclusive, toExclusive },
        ascending: chronological,
        orderBy,
        diary,
        limit: MEMORY_PAGE_SIZE,
      });
      if (!isActive()) return;
      if (page.hasMore && !page.nextCursor) throw new MemoryWriteError('Не удалось определить следующую страницу. Обновите альбом.');
      continuation.current = { scope, hasMore: page.hasMore, cursor: page.nextCursor };
      setMemories(page.items);
      setHasMore(page.hasMore);
    } catch (error) {
      if (!isActive()) return;
      setErrorMessage(error instanceof MemoryWriteError
        ? error.message
        : 'Не удалось загрузить ленту. Проверьте соединение и попробуйте снова.');
    } finally {
      if (isActive()) {
        firstBusy.current = false;
        setLoading(false);
      }
    }
  }, [childId, familyId, fromInclusive, toExclusive, chronological, scope, orderBy]);

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void loadFirstPage();
      const resume = AppState.addEventListener('change', (state) => {
        if (state === 'active') void loadFirstPage();
      });
      // Renew one-hour signed URLs while the screen remains open.
      const renew = setInterval(() => void loadFirstPage(), 45 * 60 * 1000);
      return () => {
        active.current = false;
        generation.current += 1;
        resume.remove();
        clearInterval(renew);
      };
    }, [loadFirstPage]),
  );

  async function handleLoadMore() {
    const next = continuation.current;
    if (!active.current || latestScope.current !== scope || moreBusy.current || firstBusy.current
      || next.scope !== scope || !next.hasMore || !next.cursor) return;
    moreBusy.current = true;
    const request = generation.current;
    const isActive = () => active.current && latestScope.current === scope && request === generation.current;
    setMoreError(null);
    setLoadingMore(true);
    try {
      const page = await getFamilyMemories({
        familyId,
        childId,
        dateRange: { fromInclusive, toExclusive },
        ascending: chronological,
        orderBy,
        diary,
        limit: MEMORY_PAGE_SIZE,
        after: next.cursor,
      });
      if (!isActive()) return;
      if (page.hasMore && !page.nextCursor) throw new MemoryWriteError('Не удалось определить следующую страницу. Обновите альбом.');
      continuation.current = { scope, hasMore: page.hasMore, cursor: page.nextCursor };
      setMemories((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setHasMore(page.hasMore);
    } catch (error) {
      if (!isActive()) return;
      setMoreError(error instanceof MemoryWriteError
        ? error.message
        : 'Не удалось загрузить следующие воспоминания.');
    } finally {
      if (isActive()) {
        moreBusy.current = false;
        setLoadingMore(false);
      }
    }
  }

  function handleAddMemory(archived = false) {
    if (!active.current || latestScope.current !== scope) return;
    router.push({
      pathname: '/memory/new',
      params: { ...(childId ? { childId } : {}), ...(archived ? { archived: '1' } : {}),
        ...(diary ? { diary: '1', ...(diary !== 'all' ? { category: diary } : {}) } : {}) },
    });
  }

  const listHeader = (
    <>
      {header}
      {view === 'list' ? <View>
        <Text style={styles.collectionTitle}>Дневник</Text>
        <Text style={[styles.subtitle, { marginBottom: 10 }]}>Слова, открытия и тёплые истории о ребёнке.</Text>
        <DiaryCategories showAll selected={diaryCategory} onSelect={(category) => {
          if (active.current && latestScope.current === scope) setDiaryCategory(category);
        }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Добавить запись в дневник" onPress={() => handleAddMemory()}
          style={[styles.primaryButton, { alignSelf: 'flex-start', marginTop: 0, marginBottom: 16 }]}>
          <Text style={styles.primaryButtonText}>+ Записать момент</Text>
        </Pressable>
      </View> : null}
      {showViewSwitch ? <View style={styles.viewSwitch}>
        <Pressable accessibilityRole="tab" accessibilityLabel="Фото" accessibilityState={{ selected: view === 'gallery' }}
          onPress={() => { if (active.current && latestScope.current === scope) setView('gallery'); }} style={[styles.viewTab, view === 'gallery' && styles.selectedView]}>
          <StoryIcon name="photo" size={17} color={view === 'gallery' ? colors.primary : colors.secondary} /><Text style={[styles.viewText, view === 'gallery' && styles.selectedViewText]}>Фото</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityLabel="Видео" accessibilityState={{ selected: view === 'video' }}
          onPress={() => { if (active.current && latestScope.current === scope) setView('video'); }} style={[styles.viewTab, view === 'video' && styles.selectedView]}>
          <StoryIcon name="video" size={17} color={view === 'video' ? colors.primary : colors.secondary} /><Text style={[styles.viewText, view === 'video' && styles.selectedViewText]}>Видео</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityLabel="Все записи" accessibilityState={{ selected: view === 'list' }}
          onPress={() => { if (active.current && latestScope.current === scope) setView('list'); }} style={[styles.viewTab, view === 'list' && styles.selectedView]}>
          <StoryIcon name="history" size={17} color={view === 'list' ? colors.primary : colors.secondary} /><Text style={[styles.viewText, view === 'list' && styles.selectedViewText]}>Записи</Text>
        </Pressable>
      </View> : null}
      {!dateRange && (view !== 'list' || showDateFilter) ? <View style={styles.dateToolbar}>
        {view !== 'list' ? <Text accessibilityRole="header" style={styles.collectionTitle}>{view === 'gallery' ? 'Фото' : 'Видео'}</Text> : null}
        {showDateFilter ? <Pressable accessibilityRole="button" accessibilityLabel="Выбрать даты" accessibilityState={{ expanded: calendarOpen }}
          onPress={() => { if (active.current && latestScope.current === scope) setCalendarOpen((open) => !open); }}
          style={[styles.dateToggle, selectedPeriod && styles.dateToggleActive]}>
          <StoryIcon name="calendar" size={17} color={colors.primary} />
          <Text style={styles.dateToggleText}>{selectedPeriod ? selectedPeriod.month ? `${galleryMonths[selectedPeriod.month - 1]} ${selectedPeriod.year}` : String(selectedPeriod.year) : 'Все даты'}</Text>
        </Pressable> : null}
      </View> : null}
      {showDateFilter && !dateRange && calendarOpen ? <View style={styles.calendar}>
        <View style={styles.yearRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий год" disabled={displayYear <= 1}
            onPress={() => selectPeriod(displayYear - 1, null)} style={styles.yearArrow}><Text style={styles.arrowText}>‹</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Показать весь ${displayYear} год`}
            onPress={() => selectPeriod(displayYear, null)} style={styles.yearButton}>
            <Text style={styles.yearText}>{displayYear}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Следующий год" disabled={displayYear >= 9998}
            onPress={() => selectPeriod(displayYear + 1, null)} style={styles.yearArrow}><Text style={styles.arrowText}>›</Text></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.months}>
          <Pressable accessibilityRole="tab" accessibilityLabel="Все даты" accessibilityState={{ selected: !selectedPeriod }}
            onPress={() => { if (active.current && latestScope.current === scope) setPeriod(null); }}
            style={[styles.monthTab, !selectedPeriod && styles.activeMonth]}><Text style={[styles.monthText, !selectedPeriod && styles.activeMonthText]}>Все</Text></Pressable>
          {galleryMonths.map((_, index) => 12 - index).map((month) => <Pressable key={month}
            accessibilityRole="tab" accessibilityLabel={`${galleryMonths[month - 1]} ${displayYear}`}
            accessibilityState={{ selected: selectedPeriod?.month === month }}
            onPress={() => selectPeriod(displayYear, month)} style={[styles.monthTab, selectedPeriod?.month === month && styles.activeMonth]}>
            <Text style={[styles.monthText, selectedPeriod?.month === month && styles.activeMonthText]}>{galleryMonths[month - 1]}</Text>
          </Pressable>)}
        </ScrollView>
        {selectedPeriod ? <View style={styles.filterRow}>
          <Text style={styles.filterText}>{selectedPeriod.month ? `${galleryMonths[selectedPeriod.month - 1]} ${selectedPeriod.year}` : `Весь ${selectedPeriod.year} год`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Сбросить фильтр даты"
            onPress={() => { if (active.current && latestScope.current === scope) setPeriod(null); }} style={styles.clearFilter}><Text style={styles.clearText}>Все даты</Text></Pressable>
        </View> : null}
      </View> : null}
      {chapterTitle || showAddButton ? <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{chapterTitle ?? (child ? 'Вся книга' : 'Воспоминания')}</Text>
          <Text style={styles.subtitle}>
            {child ? chronological ? 'По дате события, с самого начала' : `Моменты из книги ${child.name}` : 'Новое в вашей семейной книге'}
          </Text>
        </View>
        {showAddButton ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={child ? `Добавить воспоминание для ${child.name}` : 'Добавить семейное воспоминание'}
          onPress={() => handleAddMemory(Boolean(dateRange))}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <StoryIcon name="add" color="#FFFFFF" />
        </Pressable> : null}
      </View> : null}

      {errorMessage && visibleMemories.length > 0 ? (
        <Text style={styles.stateBody}>{errorMessage} Показаны ранее загруженные воспоминания.</Text>
      ) : null}
    </>
  );

  const emptyState = loading && visibleMemories.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : errorMessage && visibleMemories.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Лента пока недоступна</Text>
          <Text style={styles.stateBody}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Повторить загрузку воспоминаний"
            onPress={() => void loadFirstPage()}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : visibleMemories.length === 0 ? (
        <View style={styles.stateCard}>
          <View style={styles.emptyMark}><StoryIcon name="photo" size={30} color={colors.primary} /></View>
          <Text style={styles.stateTitle}>{diary ? 'Здесь пока нет заметок' : selectedPeriod ? 'В этом периоде пока нет записей' : chapterTitle ? 'В этой главе пока нет воспоминаний' : 'Сохраним первый момент?'}</Text>
          <Text style={styles.stateBody}>
            {diary ? 'Запишите первое слово, новое умение или историю, которую хочется сохранить.' : selectedPeriod ? 'Выберите другой месяц или нажмите «Все даты», чтобы увидеть весь альбом.' : chapterTitle ? 'Добавьте фото, видео или текст с датой события этого периода. Доступная дата фото подставится сама.' : 'Добавьте фото, видео или несколько строк о важном семейном дне.'}
          </Text>
          {showAddButton ? <Pressable
            accessibilityRole="button"
            accessibilityLabel="Добавить воспоминание"
            onPress={() => handleAddMemory(Boolean(dateRange))}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Добавить воспоминание</Text>
          </Pressable> : <Text style={styles.stateBody}>Нажмите «Добавить» внизу экрана.</Text>}
        </View>
      ) : (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{hasMore
                ? `В загруженной части пока нет ${view === 'video' ? 'видео' : 'фото'}`
                : view === 'video' ? 'Пока нет видео' : 'Пока нет фото'}</Text>
              <Text style={styles.stateBody}>{hasMore ? 'Нажмите «Показать ещё», чтобы проверить более ранние моменты. ' : ''}Текстовые заметки и достижения находятся во вкладке «Записи».</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Посмотреть текстовые записи" onPress={() => { if (active.current && latestScope.current === scope) { if (onOpenRecords) onOpenRecords(); else setView('list'); } }} style={styles.retryButton}><Text style={styles.retryText}>Открыть записи</Text></Pressable>
            </View>
      );

  const listFooter = visibleMemories.length > 0 ? (
        <View>
          {hasMore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Загрузить следующие воспоминания"
              disabled={loadingMore}
              onPress={() => void handleLoadMore()}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
            >
              {loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
              <Text style={styles.moreText}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</Text>
            </Pressable>
          ) : null}
          {moreError ? <Text style={styles.stateBody}>{moreError} Нажмите «Показать ещё» для повтора.</Text> : null}
        </View>
      ) : null;

  const chrome: MemoryListChrome = {
    style: styles.scroll,
    contentContainerStyle: styles.container,
    ListHeaderComponent: listHeader,
    ListEmptyComponent: emptyState,
    ListFooterComponent: listFooter,
    refreshControl: <RefreshControl refreshing={loading && visibleMemories.length > 0}
      onRefresh={() => void loadFirstPage()} tintColor={colors.primary} colors={[colors.primary]} />,
    onEndReached: () => void handleLoadMore(),
    onEndReachedThreshold: 0.5,
  };

  // Only the active collection scrolls vertically; the month strip is horizontal.
  return view === 'gallery' ? (
    <MemoryGallery key={scope} memories={visibleMemories} mediaKind="image" chrome={chrome} onEditMemory={editMemory} canEditMemory={canEditMemory} captionFor={(memory) => child
      ? formatAgeAtDate(child.birth_date, memory.event_date) ?? undefined : memoryContext(memory, children)} />
  ) : view === 'video' ? (
    <MemoryVideoList key={scope} memories={visibleMemories} chrome={chrome} onEditMemory={editMemory} canEditMemory={canEditMemory} captionFor={(memory) => child
      ? formatAgeAtDate(child.birth_date, memory.event_date) ?? undefined : memoryContext(memory, children)} />
  ) : (
    <MemoryDiaryList key={scope} memories={visibleMemories} chrome={chrome}
      onEditMemory={editMemory} canEditMemory={canEditMemory}
      captionFor={(memory) => children.filter((entry) => memory.child_ids.includes(entry.id)).map((entry) =>
        [entry.name, formatAgeAtDate(entry.birth_date, memory.event_date)].filter(Boolean).join(' · ')).join('  •  ') || undefined} />
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 20,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  scroll: { flex: 1 },
  viewSwitch: { flexDirection: 'row', gap: 4, backgroundColor: colors.primarySoft, borderRadius: 22, padding: 5, marginTop: 8, marginBottom: 6 },
  dateToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4, marginBottom: 14 },
  collectionTitle: { color: colors.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
  dateToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, paddingHorizontal: 13, borderRadius: 16, backgroundColor: colors.surface },
  dateToggleActive: { backgroundColor: colors.primarySoft },
  dateToggleText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  calendar: { marginBottom: 16, padding: 10, borderRadius: 24, backgroundColor: colors.surface },
  yearRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  yearArrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.secondary, fontSize: 27 },
  yearButton: { minHeight: 44, minWidth: 86, alignItems: 'center', justifyContent: 'center' },
  yearText: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  months: { gap: 5, paddingBottom: 2 },
  monthTab: { minWidth: 44, minHeight: 44, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  activeMonth: { backgroundColor: colors.primarySoft },
  monthText: { color: colors.secondary, fontSize: 13, fontWeight: '500' },
  activeMonthText: { color: colors.primary, fontWeight: '700' },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  filterText: { color: colors.secondary, fontSize: 12 },
  clearFilter: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  clearText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  viewTab: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 18, paddingHorizontal: 6 },
  selectedView: { backgroundColor: colors.surface },
  viewText: { fontSize: 13, fontWeight: '600', color: colors.secondary },
  selectedViewText: { color: colors.primary },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  headerText: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.secondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 28,
  },
  loader: {
    padding: 26,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  periodHeading: {
    color: colors.primary,
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 12,
  },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  emptyMark: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyIcon: {
    color: colors.primary,
    fontSize: 23,
  },
  stateTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  stateBody: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  retryButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  moreButton: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 2,
    minHeight: 46,
    paddingHorizontal: 18,
  },
  moreText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
