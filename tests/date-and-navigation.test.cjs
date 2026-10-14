const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { formatAgeAtDate, childTimelinePeriod } = loadTypescript('src/lib/date-utils.ts', {}, { Intl: {} });
const { navigationStage } = loadTypescript('src/lib/navigation-state.ts');

test('age module works without Intl.PluralRules (Android/Hermes regression)', () => {
  const cases = [
    ['2023-01-31', '2023-02-28', '1 месяц'],
    ['2024-01-31', '2024-02-28', '28 дней'],
    ['2024-01-31', '2024-02-29', '1 месяц'],
    ['2020-02-29', '2021-02-28', '1 год'],
    ['2023-01-15', '2024-03-20', '1 год 2 месяца 5 дней'],
    ['2024-01-01', '2024-01-01', '0 дней'],
    ['2024-01-01', '2024-01-02', '1 день'],
    ['2024-01-01', '2024-01-03', '2 дня'],
    ['2024-01-01', '2024-01-12', '11 дней'],
    ['2024-01-01', '2024-01-23', '22 дня'],
  ];
  for (const [birth, event, expected] of cases) assert.equal(formatAgeAtDate(birth, event), expected);
  assert.equal(formatAgeAtDate('2024-02-30', '2024-03-15'), null);
  assert.equal(formatAgeAtDate('2024-01-01', '2023-12-31'), null);
});

test('auth-shell stages do not treat unreadable family data as no family', () => {
  const base = { isPasswordRecovery: false, isInitializing: false, authError: null,
    session: {}, family: { status: 'ready' } };
  const expected = { idle: 'status', loading: 'status', error: 'status',
    none: 'setup', multiple: 'picker', ready: 'family' };
  for (const [status, stage] of Object.entries(expected)) {
    assert.equal(navigationStage({ ...base, family: { status } }), stage);
    assert.equal(navigationStage({ ...base, family: { status }, isPasswordRecovery: true }), 'recovery');
  }
  assert.equal(navigationStage({ ...base, session: null }), 'guest');
  assert.equal(navigationStage({ ...base, isInitializing: true }), 'status');
  assert.equal(navigationStage({ ...base, authError: 'offline' }), 'status');
});

test('book sections are derived from event dates, including leap-year anniversaries', () => {
  const cases = [
    ['2024-01-01', '2024-01-01', 'birth'],
    ['2024-01-01', '2024-01-02', 'second-day'],
    ['2024-01-01', '2024-01-07', 'first-week'],
    ['2024-01-01', '2024-01-08', 'first-month'],
    ['2024-01-01', '2024-02-01', 'month-1'],
    ['2024-01-01', '2024-12-31', 'month-11'],
    ['2024-01-01', '2025-01-01', 'year-1'],
    ['2020-02-29', '2021-02-28', 'year-1'],
    ['2024-01-01', '2023-12-31', 'before-birth'],
  ];
  for (const [birth, event, key] of cases) assert.equal(childTimelinePeriod(birth, event).key, key);
});
