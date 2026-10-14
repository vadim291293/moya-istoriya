import type { ImagePickerAsset } from 'expo-image-picker';
import { isValidDateIso } from './date-utils';

// Keep the camera's calendar day, not a UTC-converted day. File/cache modification
// time, EXIF DateTime (editing) and DateTimeDigitized (scanning) are not capture dates.
export function parseCaptureDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isValidDateIso(date)) return null;
  if (match[4] && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)) return null;
  return date;
}

export function photoCaptureDate(asset: Pick<ImagePickerAsset, 'type' | 'exif'>): string | null {
  if (asset.type !== 'image' || !asset.exif) return null;
  const exif = asset.exif as Record<string, unknown>;
  const nested = exif['{Exif}'] ?? exif.Exif;
  const nestedExif = typeof nested === 'object' && nested !== null
    ? nested as Record<string, unknown> : {};
  return parseCaptureDate(exif.DateTimeOriginal) ?? parseCaptureDate(nestedExif.DateTimeOriginal);
}

export type SelectionDate =
  | { status: 'empty' | 'missing' | 'mixed' | 'future'; date: null }
  | { status: 'detected'; date: string };

export function selectionCaptureDate(
  assets: Array<Pick<ImagePickerAsset, 'type' | 'exif'>>,
  today: string,
): SelectionDate {
  if (!assets.length) return { status: 'empty', date: null };
  const dates = assets.map(photoCaptureDate);
  const known = new Set(dates.filter((date): date is string => date !== null));
  if ([...known].some((date) => date > today)) return { status: 'future', date: null };
  if (known.size > 1) return { status: 'mixed', date: null };
  if (dates.some((date) => date === null)) return { status: 'missing', date: null };
  return { status: 'detected', date: dates[0]! };
}
