const test = require('node:test');
const assert = require('node:assert/strict');
const { screenHarness } = require('./ui-harness.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));

const props = { userId: 'user', familyId: 'family', familyName: 'Family' };
class ChildWriteError extends Error { constructor(message, pending = false) { super(message); this.pending = pending; } }

function form(options = {}) {
  const state = { calls: [], refreshes: 0, backs: 0, focused: true, preventing: false,
    auth: { session: { user: { id: 'user' } }, family: { status: 'ready', family: { id: 'family' } } } };
  const refreshFamily = async () => { state.refreshes++; };
  const screen = screenHarness('src/components/new-child-form.tsx', {
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    'expo-router': { useRouter: () => ({ canGoBack: () => true, back: () => { state.backs++; }, replace: () => { state.backs++; } }), useIsFocused: () => state.focused },
    'expo-router/react-navigation': { usePreventRemove: (value) => { state.preventing = value; } },
    '../lib/auth-context': { useAuth: () => ({ ...state.auth, refreshFamily }) },
    '../lib/child-service': { MAX_CHILD_NAME_LENGTH: 80, ChildWriteError,
      getPendingFamilyChild: () => {
        if (options.corrupt) throw new Error('broken');
        return options.pending ?? null;
      },
      createFamilyChild: async (input) => { state.calls.push(input); return options.save?.(input); } },
  }, 'NewChildForm');
  screen.render(props);
  return { screen, state };
}

function fill(screen) {
  screen.field('Имя ребёнка').onChangeText('Маша'); screen.render();
  screen.button('Выбрать дату рождения').onPress(); screen.render();
  screen.find((node) => node.props?.accessibilityLabel === 'Календарь даты рождения')
    .props.onValueChange({}, new Date('2024-01-31T12:00:00'));
  screen.render();
}

test('explicitly selected calendar day is submitted; missing date is never defaulted to today', async () => {
  const { screen, state } = form(); fill(screen);
  screen.button('Добавить ребёнка').onPress(); await flush(); screen.render();
  assert.equal(state.calls[0].birthDate, '2024-01-31'); assert.equal(state.refreshes, 1);
  const empty = form({ save: () => { throw new ChildWriteError('Укажите дату'); } });
  empty.screen.field('Имя ребёнка').onChangeText('Child'); empty.screen.render();
  empty.screen.button('Добавить ребёнка').onPress(); await flush();
  assert.equal(empty.state.calls[0].birthDate, ''); assert.equal(empty.state.refreshes, 0);
});

test('sync latch blocks double tap/back and disables form; success refreshes once without late navigation', async () => {
  let resolve;
  const { screen, state } = form({ save: () => new Promise((done) => { resolve = done; }) });
  fill(screen);
  const save = screen.button('Добавить ребёнка').onPress;
  const back = screen.button('Назад').onPress;
  save(); save(); back(); screen.render();
  assert.equal(state.calls.length, 1); assert.equal(state.backs, 0); assert.equal(state.preventing, true);
  assert.equal(screen.field('Имя ребёнка').editable, false);
  assert.equal(screen.button('Выбрать дату рождения').disabled, true);
  resolve(); await flush(); save(); screen.render(); screen.render();
  assert.equal(state.calls.length, 1); assert.equal(state.refreshes, 1);
  assert.equal(state.backs, 0); assert.equal(state.preventing, false);
});

test('unknown result locks original values and exposes exact-submission retry', async () => {
  const { screen, state } = form({ save: () => { throw new ChildWriteError('Unknown', true); } });
  fill(screen); screen.button('Добавить ребёнка').onPress(); await flush(); screen.render();
  assert.equal(screen.field('Имя ребёнка').editable, false);
  assert.equal(screen.button('Выбрать дату рождения').disabled, true);
  screen.button('Проверить добавление ребёнка').onPress(); await flush();
  assert.deepEqual(state.calls[1], state.calls[0]); assert.equal(state.refreshes, 0);
});

test('restored pending form is readonly; corrupt journal disables submission', async () => {
  const pending = form({ pending: { name: 'Existing', birthDate: '2023-02-03' } });
  assert.equal(pending.screen.field('Имя ребёнка').value, 'Existing');
  assert.equal(pending.screen.field('Имя ребёнка').editable, false);
  pending.screen.button('Проверить добавление ребёнка').onPress(); await flush();
  assert.equal(pending.state.calls[0].birthDate, '2023-02-03');
  const corrupt = form({ corrupt: true });
  assert.equal(corrupt.screen.button('Проверить добавление ребёнка').disabled, true);
  corrupt.screen.button('Проверить добавление ребёнка').onPress(); await flush();
  assert.equal(corrupt.state.calls.length, 0);
});

test('preflight failure during retry never unlocks an already pending original form', async () => {
  const { screen } = form({ pending: { name: 'Existing', birthDate: '2023-02-03' },
    save: () => { throw new ChildWriteError('Session unavailable'); } });
  screen.button('Проверить добавление ребёнка').onPress(); await flush(); screen.render();
  assert.equal(screen.field('Имя ребёнка').editable, false);
  assert.equal(screen.button('Выбрать дату рождения').disabled, true);
  assert.equal(screen.button('Проверить добавление ребёнка').disabled, false);
});

test('logout/account or family switch while saving does not refresh/navigate a new private scope', async () => {
  for (const mode of ['logout', 'account', 'family', 'recovery', 'status', 'unmount']) {
    let resolve;
    const { screen, state } = form({ save: () => new Promise((done) => { resolve = done; }) });
    fill(screen); screen.button('Добавить ребёнка').onPress(); screen.render();
    if (mode === 'logout') state.auth.session = null;
    if (mode === 'account') state.auth.session = { user: { id: 'other' } };
    if (mode === 'family') state.auth.family = { status: 'ready', family: { id: 'other' } };
    if (mode === 'recovery') state.auth.isPasswordRecovery = true;
    if (mode === 'status') state.auth.isInitializing = true;
    if (mode === 'unmount') screen.unmount(); else screen.render();
    if (mode !== 'unmount') assert.equal(state.preventing, false, 'auth shell removal must not be blocked');
    resolve(); await flush();
    if (mode !== 'unmount') screen.render();
    assert.equal(state.refreshes, 0); assert.equal(state.backs, 0);
  }
});

test('blur defers family refresh until return; stale save handlers cannot create another child', async () => {
  let resolve;
  const { screen, state } = form({ save: () => new Promise((done) => { resolve = done; }) });
  fill(screen); const save = screen.button('Добавить ребёнка').onPress; save();
  state.focused = false; screen.render(); resolve(); await flush(); screen.render();
  assert.equal(state.refreshes, 0); save(); assert.equal(state.calls.length, 1);
  state.focused = true; screen.render(); assert.equal(state.refreshes, 1);
});

test('child route keys the form by account/family; home button opens the exact protected route', () => {
  const auth = { session: { user: { id: 'user' } }, family: { status: 'ready', family: { id: 'family', name: 'Family' }, children: [] }, signOut: async () => null };
  const route = screenHarness('src/app/child/new.tsx', {
    '../../components/new-child-form': { NewChildForm: 'NewChildForm' },
    '../../lib/auth-context': { useAuth: () => auth },
  });
  assert.equal(route.render().key, 'user:family');
  const paths = [];
  const home = screenHarness('src/app/home.tsx', {
    'expo-router': { useRouter: () => ({ push: (path) => paths.push(path) }) },
    '../components/family-memory-feed': { FamilyMemoryFeed: 'FamilyMemoryFeed' },
    '../lib/auth-context': { useAuth: () => auth },
  }, 'FamilyHome');
  home.render(); home.button('Семья').onPress(); home.render();
  home.button('Добавить ребёнка').onPress(); assert.deepEqual(paths, ['/child/new']);
});
