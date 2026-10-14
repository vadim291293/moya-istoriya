import type { FamilyMemory, MemoryMedia } from './memory-service';

export type GalleryItem = { key: string; memory: FamilyMemory; media: MemoryMedia };
export type GallerySection = { key: string; title: string; items: GalleryItem[] };
export type GalleryRow = { kind: 'tiles'; key: string; items: GalleryItem[] };
export const galleryMonths = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Half-open calendar bounds are applied by Supabase before pagination, not to a loaded page.
export function galleryDateRange(year: number, month: number | null) {
  if (!Number.isInteger(year) || year < 1 || year > 9998 ||
    (month !== null && (!Number.isInteger(month) || month < 1 || month > 12))) {
    throw new Error('Некорректный календарный период');
  }
  const date = (y: number, m: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  return {
    fromInclusive: date(year, month ?? 1),
    toExclusive: month === null || month === 12 ? date(year + 1, 1) : date(year, month + 1),
  };
}

export function gallerySections(memories: FamilyMemory[], mediaKind?: MemoryMedia['media_type']): GallerySection[] {
  const groups = new Map<string, GallerySection>();
  for (const memory of memories) {
    const files = memory.media.filter(media => mediaKind ? media.media_type === mediaKind : media.media_type !== 'audio');
    if (!files.length) continue;
    const key = memory.event_date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, { key,
      title: `${monthNames[Number(key.slice(5, 7)) - 1] ?? 'Без месяца'} ${key.slice(0, 4)}`, items: [] });
    for (const media of files) groups.get(key)!.items.push({ key: `${memory.id}:${media.id}`, memory, media });
  }
  return [...groups.values()];
}

// One continuous gallery in query order. Never regroup files by their event date;
// every virtualized row holds at most two files, even in very large albums.
export function galleryRows(memories: FamilyMemory[], mediaKind?: MemoryMedia['media_type']): GalleryRow[] {
  const files = memories.flatMap((memory) => memory.media
    .filter((media) => mediaKind ? media.media_type === mediaKind : media.media_type !== 'audio')
    .map((media) => ({ key: `${memory.id}:${media.id}`, memory, media })));
  const rows: GalleryRow[] = [];
  for (let start = 0; start < files.length; start += 2) {
    const items = files.slice(start, start + 2);
    rows.push({ kind: 'tiles', key: `tiles:${items[0].key}`, items });
  }
  return rows;
}
