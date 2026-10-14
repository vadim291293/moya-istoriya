import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StoryIcon } from './story-ui';
import { childBookChapters, type ChildBookChapter } from '../lib/child-book';
import { colors } from '../lib/theme';

function ChapterButton({ chapter, selected, onSelect }: {
  chapter: ChildBookChapter; selected: boolean; onSelect: (key: string) => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Открыть главу: ${chapter.title}`}
    accessibilityState={{ selected }} onPress={() => onSelect(chapter.key)}
    style={({ pressed }) => [styles.chapter, selected && styles.selected, pressed && styles.pressed]}>
    <Text style={[styles.chapterText, selected && styles.selectedText]}>{chapter.title}</Text>
  </Pressable>;
}

export function ChildBookChapters({ birthDate, today, selectedKey, onSelect }: {
  birthDate: string; today: string; selectedKey: string | null; onSelect: (key: string | null) => void;
}) {
  const [birthOpen, setBirthOpen] = useState(false);
  const chapters = childBookChapters(birthDate, today);
  if (!chapters) return <Text style={styles.hint}>Главы появятся после проверки даты рождения.</Text>;
  return <View style={styles.container}>
    <View style={styles.heading}>
      <Text style={styles.title}>Главы книги</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть всю книгу"
        accessibilityState={{ selected: selectedKey === null }} onPress={() => onSelect(null)} style={styles.allButton}>
        <Text style={styles.allText}>Вся книга</Text>
      </Pressable>
    </View>
    <View style={styles.birthCard}>
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть главу: Моё рождение"
        accessibilityState={{ selected: selectedKey === 'birth-chapter' }}
        onPress={() => { setBirthOpen(true); onSelect(chapters.birth.key); }}
        style={({ pressed }) => [styles.birthButton, selectedKey === 'birth-chapter' && styles.birthSelected, pressed && styles.pressed]}>
        <View style={styles.birthIcon}><StoryIcon name="book" color={colors.lavenderInk} /></View>
        <View style={styles.birthText}>
          <Text style={styles.birthTitle}>Моё рождение</Text>
          <Text style={styles.birthSubtitle}>Первые дни и недели жизни</Text>
        </View>
        <StoryIcon name="chevron" size={18} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={birthOpen ? 'Скрыть первые дни' : 'Показать первые дни'}
        accessibilityState={{ expanded: birthOpen }} onPress={() => setBirthOpen((value) => !value)} style={styles.expandButton}>
        <Text style={styles.allText}>{birthOpen ? 'Свернуть дни ↑' : 'Открыть по дням ↓'}</Text>
      </Pressable>
      {birthOpen ? <View style={styles.birthDays}>
        {chapters.days.map((chapter) => <ChapterButton key={chapter.key} chapter={chapter}
          selected={selectedKey === chapter.key} onSelect={onSelect} />)}
      </View> : null}
    </View>
    {chapters.months.length > 0 ? <>
      <Text style={styles.groupTitle}>Месяцы первого года</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grid}>{chapters.months.map((chapter) => <ChapterButton key={chapter.key}
        chapter={chapter} selected={selectedKey === chapter.key} onSelect={onSelect} />)}</ScrollView>
    </> : null}
    {chapters.years.length > 0 ? <>
      <Text style={styles.groupTitle}>Год за годом</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grid}>{chapters.years.map((chapter) => <ChapterButton key={chapter.key}
        chapter={chapter} selected={selectedKey === chapter.key} onSelect={onSelect} />)}</ScrollView>
    </> : null}
    <View style={styles.beforeBirth}>
      <ChapterButton chapter={chapters.beforeBirth} selected={selectedKey === 'before-birth'} onSelect={onSelect} />
    </View>
    <Text style={styles.hint}>Глава определяется возрастом на дату события.</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: 26 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '700', flex: 1 },
  allButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  allText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  birthCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 22, marginTop: 8, overflow: 'hidden' },
  birthButton: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  birthSelected: { backgroundColor: colors.primarySoft },
  birthIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  birthSymbol: { color: colors.primary, fontSize: 25 },
  birthText: { flex: 1 },
  birthTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  birthSubtitle: { color: colors.secondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  arrow: { color: colors.primary, fontSize: 30 },
  expandButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderTopColor: colors.border, borderTopWidth: 1 },
  birthDays: { padding: 12, paddingTop: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groupTitle: { color: colors.secondary, fontSize: 12, fontWeight: '600', marginTop: 18, marginBottom: 10 },
  grid: { gap: 8, paddingBottom: 4 },
  chapter: { minHeight: 44, borderRadius: 13, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chapterText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  selectedText: { color: '#FFFFFF' },
  beforeBirth: { alignSelf: 'flex-start', marginTop: 14 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 14 },
  pressed: { opacity: 0.75 },
});
