export const diaryCategories = [
  { id: 'words', title: 'Первые слова', hint: '«Мама», «папа» и новые словечки', placeholder: 'Например, первое «мама»', presets: ['Первое слово', 'Новое словечко'] },
  { id: 'skills', title: 'Новые умения', hint: 'Маленькие шаги и большие открытия', placeholder: 'Например, первые шаги', presets: ['Первые шаги', 'Ест самостоятельно', 'Научилась кататься'] },
  { id: 'quotes', title: 'Смешные фразы', hint: 'То, что хочется запомнить дословно', placeholder: 'Как это прозвучало?', presets: [] },
  { id: 'moments', title: 'Тёплые моменты', hint: 'Ваши чувства и истории на память', placeholder: 'Назовите этот момент', presets: [] },
] as const;

export type DiaryCategory = typeof diaryCategories[number]['id'];
export type DiaryFilter = 'all' | DiaryCategory;

export function isDiaryCategory(value: unknown): value is DiaryCategory {
  return diaryCategories.some((category) => category.id === value);
}

export function diaryCategoryFor(memory: { diary_category?: DiaryCategory | null; memory_type: string }) {
  // Old text-only notes remain available. Old media is not silently retagged.
  return memory.diary_category ?? (memory.memory_type === 'note' ? 'moments' : null);
}

export function diaryFilterExpression(filter: DiaryFilter) {
  if (filter === 'all') return 'diary_category.not.is.null,memory_type.eq.note';
  if (!isDiaryCategory(filter)) throw new Error('Неизвестный раздел дневника.');
  return filter === 'moments'
    ? 'diary_category.eq.moments,and(diary_category.is.null,memory_type.eq.note)'
    : `diary_category.eq.${filter}`;
}
