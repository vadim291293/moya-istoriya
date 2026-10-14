import { agePartsAtDate, childTimelinePeriod, dateDaysAfter, dateMonthsAfter, isValidDateIso } from './date-utils';

export type MemoryDateRange = { fromInclusive?: string; toExclusive?: string };
export type ChildBookChapter = { key: string; title: string; range: MemoryDateRange };

export function childBookChapter(birthDate: string, key: string): ChildBookChapter | null {
  if (!isValidDateIso(birthDate)) return null;
  if (key === 'before-birth') return { key, title: 'До рождения', range: { toExclusive: birthDate } };
  let from: string | null;
  let to: string | null;
  let title: string | undefined;
  switch (key) {
    case 'birth-chapter': from = birthDate; to = dateMonthsAfter(birthDate, 1); title = 'Моё рождение'; break;
    case 'birth': from = birthDate; to = dateDaysAfter(birthDate, 1); title = 'Первый день'; break;
    case 'second-day': from = dateDaysAfter(birthDate, 1); to = dateDaysAfter(birthDate, 2); break;
    case 'first-week': from = dateDaysAfter(birthDate, 2); to = dateDaysAfter(birthDate, 7); break;
    case 'first-month': from = dateDaysAfter(birthDate, 7); to = dateMonthsAfter(birthDate, 1); break;
    default: {
      const month = /^month-([1-9]|10|11)$/.exec(key);
      const year = /^year-([1-9]\d*)$/.exec(key);
      if (!month && !year) return null;
      const startMonths = month ? Number(month[1]) : Number(year![1]) * 12;
      from = dateMonthsAfter(birthDate, startMonths);
      to = dateMonthsAfter(birthDate, startMonths + (month ? 1 : 12));
    }
  }
  if (!from || !to || from >= to) return null;
  return { key, title: title ?? childTimelinePeriod(birthDate, from).label,
    range: { fromInclusive: from, toExclusive: to } };
}

export function childBookChapters(birthDate: string, today: string) {
  const age = agePartsAtDate(birthDate, today);
  const birth = childBookChapter(birthDate, 'birth-chapter');
  const beforeBirth = childBookChapter(birthDate, 'before-birth');
  if (!age || !birth || !beforeBirth) return null;
  const started = (chapter: ChildBookChapter | null): chapter is ChildBookChapter =>
    Boolean(chapter && (!chapter.range.fromInclusive || chapter.range.fromInclusive <= today));
  const days = ['birth', 'second-day', 'first-week', 'first-month']
    .map((key) => childBookChapter(birthDate, key)).filter(started);
  const months = Array.from({ length: Math.min(age.fullMonths, 11) }, (_, index) =>
    childBookChapter(birthDate, `month-${index + 1}`)).filter(started);
  const years = Array.from({ length: age.years }, (_, index) =>
    childBookChapter(birthDate, `year-${index + 1}`)).filter(started);
  return { birth, days, months, years, beforeBirth };
}
