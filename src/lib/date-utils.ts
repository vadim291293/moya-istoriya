type DateParts = {
  year: number;
  month: number;
  day: number;
};

function parseDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDateIso(value: string) {
  return parseDate(value) !== null;
}

function dateIso(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Calculate anniversaries from the original day, not a previously clamped date.
// Jan 31 + 2 months is Mar 31; Feb 29 + 12 months is Feb 28.
export function dateMonthsAfter(value: string, months: number) {
  const parts = parseDate(value);
  if (!parts || !Number.isSafeInteger(months)) return null;
  const monthIndex = parts.year * 12 + parts.month - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  if (year < 100 || year > 9999) return null;
  return dateIso(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

export function dateDaysAfter(value: string, days: number) {
  if (!parseDate(value) || !Number.isSafeInteger(days)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year) || year < 100 || year > 9999) return null;
  return dateIso(year, date.getUTCMonth() + 1, date.getUTCDate());
}

function pluralize(value: number, forms: [string, string, string]) {
  const lastTwoDigits = Math.abs(value) % 100;
  const lastDigit = Math.abs(value) % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${value} ${forms[2]}`;
  }
  if (lastDigit === 1) {
    return `${value} ${forms[0]}`;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${value} ${forms[1]}`;
  }

  return `${value} ${forms[2]}`;
}

export function formatRuDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function currentLocalDateIso() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
}

export function agePartsAtDate(birthDate: string, eventDate: string) {
  const birth = parseDate(birthDate);
  const event = parseDate(eventDate);
  if (!birth || !event) {
    return null;
  }

  const birthTime = Date.UTC(birth.year, birth.month - 1, birth.day);
  const eventTime = Date.UTC(event.year, event.month - 1, event.day);
  if (eventTime < birthTime) {
    return null;
  }

  let fullMonths = (event.year - birth.year) * 12 + event.month - birth.month;
  const monthlyAnniversaryDay = Math.min(
    birth.day,
    daysInMonth(event.year, event.month),
  );

  if (event.day < monthlyAnniversaryDay) {
    fullMonths -= 1;
  }

  const anniversaryMonthIndex = birth.month - 1 + fullMonths;
  const anniversaryYear = birth.year + Math.floor(anniversaryMonthIndex / 12);
  const anniversaryMonth = (anniversaryMonthIndex % 12) + 1;
  const anniversaryDay = Math.min(
    birth.day,
    daysInMonth(anniversaryYear, anniversaryMonth),
  );
  const anniversaryTime = Date.UTC(
    anniversaryYear,
    anniversaryMonth - 1,
    anniversaryDay,
  );
  const days = Math.floor((eventTime - anniversaryTime) / 86_400_000);
  const years = Math.floor(fullMonths / 12);
  const months = fullMonths % 12;

  return { years, months, days, fullMonths, totalDays: Math.floor((eventTime - birthTime) / 86_400_000) };
}

export function formatAgeAtDate(birthDate: string, eventDate: string) {
  const age = agePartsAtDate(birthDate, eventDate);
  if (!age) return null;
  const { years, months, days } = age;

  const parts: string[] = [];
  if (years > 0) {
    parts.push(pluralize(years, ['год', 'года', 'лет']));
  }
  if (months > 0) {
    parts.push(pluralize(months, ['месяц', 'месяца', 'месяцев']));
  }
  if (days > 0 || parts.length === 0) {
    parts.push(pluralize(days, ['день', 'дня', 'дней']));
  }

  return parts.join(' ');
}

export function childTimelinePeriod(birthDate: string, eventDate: string) {
  const age = agePartsAtDate(birthDate, eventDate);
  if (!age) return { key: 'before-birth', label: 'До рождения' };
  if (age.totalDays === 0) return { key: 'birth', label: 'Моё рождение · первый день' };
  if (age.totalDays === 1) return { key: 'second-day', label: 'Второй день' };
  if (age.totalDays < 7) return { key: 'first-week', label: 'Первая неделя' };
  if (age.fullMonths === 0) return { key: 'first-month', label: 'Первый месяц' };
  if (age.years === 0) {
    return { key: `month-${age.fullMonths}`, label: pluralize(age.fullMonths, ['месяц', 'месяца', 'месяцев']) };
  }
  return { key: `year-${age.years}`, label: pluralize(age.years, ['год', 'года', 'лет']) };
}
