import { Pressable, StyleSheet, Text, View } from 'react-native';
import { diaryCategories, type DiaryCategory, type DiaryFilter } from '../lib/diary';
import { colors } from '../lib/theme';

export function DiaryCategories({ selected, onSelect, disabled, showAll = false }: {
  selected: DiaryFilter | null; onSelect: (category: DiaryCategory | 'all') => void;
  disabled?: boolean; showAll?: boolean;
}) {
  return <View style={styles.container}>
    {showAll ? <Pressable accessibilityRole="tab" accessibilityLabel="Все заметки"
      accessibilityState={{ selected: selected === 'all' }} disabled={disabled} onPress={() => onSelect('all')}
      style={styles.all}><Text style={[styles.allText, selected === 'all' && styles.activeText]}>Все заметки</Text></Pressable> : null}
    <View style={styles.grid}>{diaryCategories.map((category) => <Pressable key={category.id}
      accessibilityRole="tab" accessibilityLabel={category.title} accessibilityState={{ selected: selected === category.id }}
      disabled={disabled} onPress={() => onSelect(category.id)}
      style={[styles.category, selected === category.id && styles.selected]}>
      <Text style={[styles.title, selected === category.id && styles.activeText]}>{category.title}</Text>
      <Text style={styles.hint}>{category.hint}</Text>
    </Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { flexBasis: '47%', flexGrow: 1, padding: 13, minHeight: 85, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  selected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  title: { color: colors.ink, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  hint: { color: colors.secondary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  activeText: { color: colors.primary },
  all: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 10 },
  allText: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
});
