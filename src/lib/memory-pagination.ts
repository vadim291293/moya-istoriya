import type { MemoryDateRange } from './child-book';
import { isValidDateIso } from './date-utils';
import type { DiaryFilter } from './diary';

type MemoryReadScope = {
  familyId: string;
  childId?: string;
  dateRange?: MemoryDateRange;
  ascending?: boolean;
  orderBy?: 'event' | 'added';
  diary?: DiaryFilter;
};

export type MemoryCursor = Readonly<{
  version: 1;
  scope: string;
  eventDate: string;
  createdAt: string;
  id: string;
}>;

export function memoryPageOrder(input: MemoryReadScope) {
  const eventOrder = input.orderBy === 'event' || (!input.orderBy && Boolean(input.childId));
  return {
    primary: eventOrder ? 'event_date' : 'created_at',
    secondary: eventOrder ? 'created_at' : 'event_date',
    ascending: input.ascending ?? false,
  } as const;
}

function scopeFor(input: MemoryReadScope) {
  const order = memoryPageOrder(input);
  return JSON.stringify([input.familyId, input.childId ?? null,
    input.dateRange?.fromInclusive ?? null, input.dateRange?.toExclusive ?? null,
    order.primary, order.ascending, ...(input.diary ? ['diary', input.diary] : [])]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function validateCursor(cursor: unknown, input: MemoryReadScope): asserts cursor is MemoryCursor {
  const value = cursor as Partial<MemoryCursor> | null;
  // .or() accepts raw PostgREST syntax. Only strictly validated literals may
  // reach it; scope binding is a correctness guard, not an alternative to RLS.
  if (!value || typeof value !== 'object' || value.version !== 1 || value.scope !== scopeFor(input)
    || typeof value.id !== 'string' || !UUID.test(value.id)
    || typeof value.eventDate !== 'string' || !isValidDateIso(value.eventDate)
    || typeof value.createdAt !== 'string' || !TIMESTAMP.test(value.createdAt)
    || !isValidDateIso(value.createdAt.slice(0, 10)) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Не удалось определить страницу воспоминаний. Обновите альбом.');
  }
}

export function createMemoryCursor(row: { id: string; event_date: string; created_at: string }, input: MemoryReadScope): MemoryCursor {
  const cursor = { version: 1, scope: scopeFor(input), id: row.id,
    eventDate: row.event_date, createdAt: row.created_at } as const;
  validateCursor(cursor, input);
  return cursor;
}

export function memoryCursorFilter(cursor: MemoryCursor, input: MemoryReadScope) {
  validateCursor(cursor, input);
  const { primary, secondary, ascending } = memoryPageOrder(input);
  const primaryValue = primary === 'event_date' ? cursor.eventDate : cursor.createdAt;
  const secondaryValue = secondary === 'event_date' ? cursor.eventDate : cursor.createdAt;
  const comparison = ascending ? 'gt' : 'lt';
  // Preserve the server timestamp, including microseconds. A JS Date roundtrip
  // would truncate precision and could skip rows that share a millisecond.
  return `${primary}.${comparison}.${primaryValue},`
    + `and(${primary}.eq.${primaryValue},${secondary}.${comparison}.${secondaryValue}),`
    + `and(${primary}.eq.${primaryValue},${secondary}.eq.${secondaryValue},id.${comparison}.${cursor.id})`;
}
