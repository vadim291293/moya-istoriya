import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FamilyMemoryFeed } from '../../components/family-memory-feed';
import { StoryIcon } from '../../components/story-ui';
import { useAuth } from '../../lib/auth-context';
import { currentLocalDateIso, formatAgeAtDate } from '../../lib/date-utils';
import { colors } from '../../lib/theme';

export default function ChildHistoryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { family, session } = useAuth();
  const bookScope = `${session?.user.id}:${family.status === 'ready' ? family.family.id : ''}:${id}`;
  const currentScope = useRef(bookScope); currentScope.current = bookScope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function live() { return mounted.current && currentScope.current === bookScope; }
  const [selection, setSelection] = useState<{ scope: string; allFamily: boolean } | null>(null);
  if (family.status !== 'ready' || !session) return null;
  const child = family.children.find((item) => item.id === id);
  if (!child) return <SafeAreaView style={styles.safeArea}><View style={styles.centered}>
    <Text style={styles.title}>История не найдена</Text>
    <Text style={styles.hint}>Возможно, ребёнок больше не входит в эту семейную историю.</Text>
    <Pressable accessibilityRole="button" onPress={() => { if (live()) router.replace('/home'); }} style={styles.addButton}>
      <Text style={styles.addText}>К семейной галерее</Text>
    </Pressable>
  </View></SafeAreaView>;
  const allFamily = selection?.scope === bookScope && selection.allFamily;
  const filters = <View style={styles.filterArea}>
    <View style={styles.filters}>
      <Pressable accessibilityRole="tab" accessibilityLabel={`Все воспоминания ребёнка ${child.name}`} accessibilityState={{ selected: !allFamily }}
        onPress={() => { if (live()) setSelection({ scope: bookScope, allFamily: false }); }}
        style={[styles.filter, !allFamily && styles.activeFilter]}><Text style={[styles.filterText, !allFamily && styles.activeFilterText]}>{child.name}</Text></Pressable>
      <Pressable accessibilityRole="tab" accessibilityLabel="Показать всю семейную галерею" accessibilityState={{ selected: Boolean(allFamily) }}
        onPress={() => { if (live()) setSelection({ scope: bookScope, allFamily: true }); }}
        style={[styles.filter, allFamily && styles.activeFilter]}><Text style={[styles.filterText, allFamily && styles.activeFilterText]}>Вся семья</Text></Pressable>
    </View>
    <Text style={styles.hint}>{allFamily ? 'Все семейные моменты, включая записи без отметки ребёнка.' : 'Моменты с отметкой ребёнка. Остальные — во «Вся семья».'}</Text>
  </View>;
  return <SafeAreaView style={styles.safeArea}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к семье" onPress={() => {
        if (!live()) return;
        if (router.canGoBack()) router.back(); else router.replace('/home');
      }} style={styles.backButton}><StoryIcon name="back" /></Pressable>
      <View style={styles.heading}><Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{child.name}</Text>
        <Text style={styles.childAge}>{formatAgeAtDate(child.birth_date, currentLocalDateIso()) ?? 'Возраст не указан'}</Text></View>
    </View>
    <FamilyMemoryFeed key={`${bookScope}:${allFamily ? 'family' : 'child'}`}
      familyId={family.family.id} childId={allFamily ? undefined : child.id} children={family.children}
      editorUserId={session.user.id} isFamilyOwner={family.family.role === 'owner'}
      initialView="gallery" showAddButton={false} showDateFilter={false} mediaOrder="added" header={filters} />
    <View style={styles.footer}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Добавить воспоминание для ${child.name}`}
        onPress={() => { if (live()) router.push({ pathname: '/memory/new', params: { childId: child.id } }); }}
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><StoryIcon name="add" color="#FFFFFF" /><Text style={styles.addText}>Добавить для {child.name}</Text></Pressable>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { width: '100%', maxWidth: 720, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  heading: { flex: 1 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  childAge: { color: colors.secondary, fontSize: 13, marginTop: 3 },
  filterArea: { paddingTop: 6, paddingBottom: 6 },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filter: { minHeight: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 16 },
  activeFilter: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  filterText: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
  activeFilterText: { color: colors.primary },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  footer: { width: '92%', maxWidth: 680, alignSelf: 'center', padding: 6, marginTop: 4, marginBottom: 8, backgroundColor: colors.surface, borderRadius: 28, boxShadow: '0 4px 20px rgba(55,46,87,0.10)' },
  addButton: { minHeight: 56, borderRadius: 22, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary },
  addText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  centered: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  pressed: { opacity: 0.75 },
});
