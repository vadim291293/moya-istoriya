import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FamilyMemoryFeed } from '../components/family-memory-feed';
import { StoryIcon, type IconName } from '../components/story-ui';
import type { ChildSummary } from '../lib/auth-context';
import { useAuth } from '../lib/auth-context';
import { currentLocalDateIso, formatAgeAtDate } from '../lib/date-utils';
import { bookColors, colors } from '../lib/theme';

function ChildBook({ child, index, compact, selected, onPress }: { child: ChildSummary; index: number; compact?: boolean; selected?: boolean; onPress: () => void }) {
  const age = formatAgeAtDate(child.birth_date, currentLocalDateIso());
  return <Pressable accessibilityRole={compact ? 'tab' : 'button'} accessibilityLabel={`${compact ? 'Показать альбом' : 'Открыть историю'} ребёнка ${child.name}`}
    accessibilityState={compact ? { selected: Boolean(selected) } : undefined}
    onPress={onPress} style={({ pressed }) => [compact ? styles.childChip : styles.childCard, selected && styles.selectedChild, pressed && styles.pressed]}>
    <View style={[styles.avatar, compact && styles.smallAvatar, { backgroundColor: bookColors[index % bookColors.length] }]}>
      <Text style={[styles.initial, compact && styles.smallInitial]}>{child.name.trim().charAt(0).toLocaleUpperCase('ru-RU')}</Text>
    </View>
    <View style={!compact ? styles.childInfo : undefined}>
      <Text numberOfLines={2} style={compact ? styles.chipName : styles.childName}>{child.name}</Text>
      <Text style={compact ? styles.chipAge : styles.childAge}>{age ?? 'Возраст не указан'}</Text>
    </View>
    {!compact ? <StoryIcon name="chevron" size={18} color={colors.secondary} /> : null}
  </Pressable>;
}

function FamilyAction({ icon, title, hint, onPress }: { icon: IconName; title: string; hint: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
    <View style={styles.actionIcon}><StoryIcon name={icon} color={colors.primary} /></View>
    <View style={styles.actionText}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionHint}>{hint}</Text></View>
    <StoryIcon name="chevron" size={18} color={colors.secondary} />
  </Pressable>;
}

export default function HomeScreen() {
  const { family, session } = useAuth();
  if (family.status !== 'ready' || !session) return null;
  return <FamilyHome key={`${session.user.id}:${family.family.id}`} />;
}

export function FamilyHome() {
  const router = useRouter();
  const { family, session, signOut } = useAuth();
  const [tab, setTab] = useState<'gallery' | 'video' | 'records' | 'children'>('gallery');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const mounted = useRef(true);
  const signOutBusy = useRef(false);
  const initialScope = useRef(`${session?.user.id}:${family.status === 'ready' ? family.family.id : ''}`);
  const validScope = useRef(false);
  validScope.current = Boolean(session && family.status === 'ready'
    && initialScope.current === `${session.user.id}:${family.family.id}`);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (family.status !== 'ready' || !validScope.current) return null;
  const selectedChild = family.children.find((child) => child.id === selectedChildId);
  function live() { return mounted.current && validScope.current && !signOutBusy.current; }
  function openChild(child: ChildSummary) {
    if (live()) router.push({ pathname: '/child/[id]', params: { id: child.id } });
  }
  function openFamilyPage(path: '/family/members' | '/family/trash' | '/family/join' | '/family/capsules') {
    if (!live()) return;
    setAccountOpen(false);
    router.push(path);
  }
  async function handleSignOut() {
    if (!live()) return;
    signOutBusy.current = true;
    setLoggingOut(true);
    try {
      const error = await signOut();
      if (mounted.current && validScope.current && error) Alert.alert('Не удалось выйти', 'Проверьте подключение и попробуйте ещё раз.');
    } catch {
      if (mounted.current && validScope.current) Alert.alert('Не удалось выйти', 'Проверьте подключение и попробуйте ещё раз.');
    } finally {
      signOutBusy.current = false;
      if (mounted.current) setLoggingOut(false);
    }
  }

  const filters = <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
    <Pressable accessibilityRole="tab" accessibilityLabel="Вся семья" accessibilityState={{ selected: !selectedChild }}
      onPress={() => { if (live()) setSelectedChildId(null); }} style={[styles.familyChip, selectedChild && styles.inactiveFamilyChip]}><StoryIcon name="family" size={20} color={selectedChild ? colors.primary : colors.onPrimary} /><Text style={[styles.familyChipText, !selectedChild && styles.activeChipText]}>Все</Text></Pressable>
    {family.children.map((child, index) => <ChildBook key={child.id} child={child} index={index} compact selected={selectedChild?.id === child.id}
      onPress={() => { if (live()) setSelectedChildId(child.id); }} />)}
  </ScrollView>;

  return <SafeAreaView style={styles.safeArea}>
    <View style={styles.topBar}>
      <View style={styles.brandMark}><StoryIcon name="book" color={colors.primary} size={26} /></View>
      <View style={styles.heading}><Text style={styles.brand}>Моя история</Text><Text numberOfLines={1} style={styles.familyName}>{family.family.name} · семейный альбом</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть аккаунт" onPress={() => { if (live()) setAccountOpen(true); }} style={styles.accountButton}><StoryIcon name="user" size={21} /></Pressable>
    </View>
    {tab !== 'children' ? <FamilyMemoryFeed key={`${initialScope.current}:${tab}:${selectedChild?.id ?? 'family'}`} familyId={family.family.id}
      childId={selectedChild?.id} children={family.children} editorUserId={session?.user.id}
      isFamilyOwner={family.family.role === 'owner'} showAddButton={false} showViewSwitch={false} showDateFilter={false} mediaOrder="added"
      initialView={tab === 'records' ? 'list' : tab === 'video' ? 'video' : 'gallery'} onOpenRecords={() => { if (live()) setTab('records'); }} header={filters} /> :
      <ScrollView contentContainerStyle={styles.childrenContent} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Семья</Text>
        <Text style={styles.sectionHint}>Дети, близкие и всё, что вы сохраняете вместе.</Text>
        <Text style={styles.groupTitle}>Дети</Text>
        <View style={styles.childList}>{family.children.map((child, index) => <ChildBook key={child.id} child={child} index={index} onPress={() => openChild(child)} />)}</View>
        {family.children.length === 0 ? <Text style={styles.sectionHint}>Добавьте ребёнка, чтобы собирать его историю. Общие записи останутся в семейной галерее.</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Добавить ребёнка" onPress={() => { if (live()) router.push('/child/new'); }}
          style={({ pressed }) => [styles.newChild, pressed && styles.pressed]}><StoryIcon name="add" color={colors.primary} /><Text style={styles.newChildText}>Добавить ребёнка</Text></Pressable>
        <Text style={styles.groupTitle}>Близкие и доступ</Text>
        <FamilyAction icon="family" title="Участники и приглашения" hint={family.family.role === 'owner' ? 'Пригласить близких и управлять доступом' : 'Посмотреть, кто собирает историю вместе с вами'} onPress={() => openFamilyPage('/family/members')} />
        <FamilyAction icon="add" title="Принять приглашение" hint="Присоединиться к альбому другой семьи" onPress={() => openFamilyPage('/family/join')} />
        <Text style={styles.groupTitle}>Ваш архив</Text>
        {family.family.role === 'owner' ? <FamilyAction icon="lock" title="Капсула времени" hint="Личные послания под паролем — доступны только вам" onPress={() => openFamilyPage('/family/capsules')} /> : null}
        <FamilyAction icon="trash" title="Корзина воспоминаний" hint="Вернуть случайно удалённые записи в альбом" onPress={() => openFamilyPage('/family/trash')} />
        <FamilyAction icon="user" title="Мой аккаунт" hint="Почта и выход из приложения" onPress={() => { if (live()) setAccountOpen(true); }} />
        <View style={styles.privacy}><StoryIcon name="lock" size={13} color={colors.secondary} /><Text style={styles.privacyText}>Только для вашей семьи</Text></View>
      </ScrollView>}
    <View style={styles.bottomBar}>
      <Pressable accessibilityRole="tab" accessibilityLabel="Семейная галерея" accessibilityState={{ selected: tab === 'gallery' }} onPress={() => { if (live()) setTab('gallery'); }} style={[styles.tab, tab === 'gallery' && styles.selectedTab]}>
        <StoryIcon name="photo" color={tab === 'gallery' ? colors.primary : colors.secondary} /><Text style={[styles.tabText, tab === 'gallery' && styles.activeTab]}>Фото</Text>
      </Pressable>
      <Pressable accessibilityRole="tab" accessibilityLabel="Семейные видео" accessibilityState={{ selected: tab === 'video' }} onPress={() => { if (live()) setTab('video'); }} style={[styles.tab, tab === 'video' && styles.selectedTab]}>
        <StoryIcon name="video" color={tab === 'video' ? colors.primary : colors.secondary} /><Text style={[styles.tabText, tab === 'video' && styles.activeTab]}>Видео</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Добавить воспоминание" onPress={() => {
        if (!live()) return;
        if (tab === 'records') router.push({ pathname: '/memory/new', params: { diary: '1', ...(selectedChild ? { childId: selectedChild.id } : {}) } });
        else router.push(tab !== 'children' && selectedChild ? { pathname: '/memory/new', params: { childId: selectedChild.id } } : '/memory/new');
      }}
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><StoryIcon name="add" color="#FFFFFF" /><Text style={styles.addText}>Добавить</Text></Pressable>
      <Pressable accessibilityRole="tab" accessibilityLabel="Все записи" accessibilityState={{ selected: tab === 'records' }} onPress={() => { if (live()) setTab('records'); }} style={[styles.tab, tab === 'records' && styles.selectedTab]}>
        <StoryIcon name="note" color={tab === 'records' ? colors.primary : colors.secondary} /><Text style={[styles.tabText, tab === 'records' && styles.activeTab]}>Записи</Text>
      </Pressable>
      <Pressable accessibilityRole="tab" accessibilityLabel="Семья" accessibilityState={{ selected: tab === 'children' }} onPress={() => { if (live()) setTab('children'); }} style={[styles.tab, tab === 'children' && styles.selectedTab]}>
        <StoryIcon name="family" color={tab === 'children' ? colors.primary : colors.secondary} /><Text style={[styles.tabText, tab === 'children' && styles.activeTab]}>Семья</Text>
      </Pressable>
    </View>
    <Modal visible={accountOpen} transparent animationType="slide" onRequestClose={() => { if (!loggingOut) setAccountOpen(false); }}>
      <View style={styles.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть аккаунт" disabled={loggingOut} style={styles.backdrop} onPress={() => setAccountOpen(false)} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHeading}><Text style={styles.sheetTitle}>Ваш аккаунт</Text><Pressable accessibilityRole="button" accessibilityLabel="Закрыть аккаунт" disabled={loggingOut} onPress={() => setAccountOpen(false)} style={styles.accountButton}><StoryIcon name="close" /></Pressable></View>
          <Text style={styles.email}>{session?.user.email}</Text><Text style={styles.sheetFamily}>{family.family.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Участники семьи" disabled={loggingOut} onPress={() => openFamilyPage('/family/members')} style={styles.newChild}><Text style={styles.newChildText}>Участники и приглашения</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Корзина воспоминаний" disabled={loggingOut} onPress={() => openFamilyPage('/family/trash')} style={styles.newChild}><Text style={styles.newChildText}>Корзина воспоминаний</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Принять приглашение" disabled={loggingOut} onPress={() => openFamilyPage('/family/join')} style={styles.newChild}><Text style={styles.newChildText}>Принять приглашение</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Выйти из аккаунта" disabled={loggingOut} onPress={() => void handleSignOut()} style={styles.signOut}><StoryIcon name="logout" color={colors.error} /><Text style={styles.signOutText}>{loggingOut ? 'Выходим…' : 'Выйти из аккаунта'}</Text></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  topBar: { width: '100%', maxWidth: 720, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 18, paddingVertical: 12 },
  brandMark: { width: 48, height: 48, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, paddingRight: 12 },
  brand: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  familyName: { color: colors.secondary, fontSize: 12, marginTop: 2 },
  accountButton: { width: 44, height: 44, backgroundColor: colors.surface, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 8, paddingVertical: 12, alignItems: 'center' },
  familyChip: { minHeight: 52, borderRadius: 22, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  inactiveFamilyChip: { backgroundColor: colors.surface },
  selectedChild: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  activeChipText: { color: colors.onPrimary },
  familyChipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  childChip: { minHeight: 56, borderRadius: 22, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  smallAvatar: { width: 34, height: 34, borderRadius: 14 },
  initial: { fontSize: 22, fontWeight: '700', color: colors.ink },
  smallInitial: { fontSize: 13 },
  chipName: { color: colors.ink, fontSize: 13, fontWeight: '600', maxWidth: 120 },
  chipAge: { color: colors.secondary, fontSize: 10, lineHeight: 15, marginTop: 2, maxWidth: 140 },
  childrenContent: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18 },
  sectionTitle: { color: colors.ink, fontSize: 26, fontWeight: '700' },
  sectionHint: { color: colors.secondary, fontSize: 13, lineHeight: 20, marginTop: 6 },
  groupTitle: { color: colors.secondary, fontSize: 13, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  childList: { gap: 10 },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 24, padding: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 22, padding: 14, marginBottom: 8, minHeight: 76 },
  actionIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1 },
  actionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  actionHint: { color: colors.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  childInfo: { flex: 1 },
  childName: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  childAge: { color: colors.secondary, fontSize: 12, marginTop: 5 },
  newChild: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, minHeight: 52, marginTop: 16, padding: 12 },
  newChildText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  privacy: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24 },
  privacyText: { color: colors.secondary, fontSize: 11 },
  bottomBar: { width: '96%', maxWidth: 680, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 24, padding: 4, gap: 2, marginTop: 4, marginBottom: 8, boxShadow: '0 4px 20px rgba(55,46,87,0.10)' },
  tab: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 20 },
  selectedTab: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.secondary, fontSize: 10, fontWeight: '600' },
  activeTab: { color: colors.primary },
  addButton: { flex: 1.12, minHeight: 60, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, gap: 5 },
  addText: { color: colors.onPrimary, fontSize: 10, fontWeight: '700' },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  backdrop: { flex: 1 },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, width: '100%', maxWidth: 720, alignSelf: 'center' },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sheetTitle: { color: colors.ink, fontSize: 24, fontWeight: '700', flexShrink: 1 },
  email: { color: colors.secondary, fontSize: 14, marginTop: 14 },
  sheetFamily: { color: colors.ink, fontSize: 16, fontWeight: '600', marginTop: 6 },
  signOut: { minHeight: 54, borderRadius: 16, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 24, padding: 12 },
  signOutText: { color: colors.error, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
