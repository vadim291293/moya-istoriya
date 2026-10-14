import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { CapsuleBiometryError, type CapsuleBioScope, type CapsuleBioStatus } from './capsule-biometry-types';
export { CapsuleBiometryError } from './capsule-biometry-types';
export type { CapsuleBioStatus } from './capsule-biometry-types';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const revisions = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
const secretOptions = { requireAuthentication: true, keychainService: 'moya.capsule.biometry.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, authenticationPrompt: 'Откройте капсулу времени по биометрии' };
const markerOptions = { keychainService: 'moya.capsule.biometry.metadata.v1', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
function keys(scope: CapsuleBioScope) {
  if (!UUID.test(scope.userId) || !UUID.test(scope.familyId)) throw new CapsuleBiometryError('Аккаунт или семья изменились.');
  return { secret: `capsule.secret.${scope.userId}.${scope.familyId}`, marker: `capsule.enabled.${scope.userId}.${scope.familyId}`, index: `capsule.index.${scope.userId}` };
}
function revision(user: string) { return revisions.get(user) ?? 0; }
function serialize<T>(user: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(user) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(user, next);
  void next.finally(() => { if (queues.get(user) === next) queues.delete(user); }).catch(() => {});
  return next;
}
async function index(user: string): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(`capsule.index.${user}`, markerOptions);
  if (!raw) return [];
  try { const items = JSON.parse(raw); return Array.isArray(items) ? items.filter((f): f is string => typeof f === 'string' && UUID.test(f)) : []; }
  catch { return []; }
}
async function remove(scope: CapsuleBioScope) {
  const k = keys(scope);
  // Remove the opt-in marker first; failures never expose an unauthenticated secret.
  await SecureStore.deleteItemAsync(k.marker, markerOptions);
  await SecureStore.deleteItemAsync(k.secret, secretOptions);
}
export async function getCapsuleBiometry(scope: CapsuleBioScope): Promise<CapsuleBioStatus> {
  const status: CapsuleBioStatus = { available: false, enabled: false, label: 'Биометрия', reason: null };
  try {
    const k = keys(scope);
    if (Platform.OS === 'ios' && Constants.executionEnvironment === 'storeClient') {
      return { ...status, reason: 'Для защищённой биометрии на iPhone нужна отдельная сборка приложения. В Expo Go используйте пароль.' };
    }
    if (!await SecureStore.isAvailableAsync() || !SecureStore.canUseBiometricAuthentication()
      || !await LocalAuthentication.hasHardwareAsync() || !await LocalAuthentication.isEnrolledAsync()
      || await LocalAuthentication.getEnrolledLevelAsync() !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG)
      return { ...status, reason: 'Настройте отпечаток пальца или защищённое распознавание лица в настройках телефона. Пароль доступен всегда.' };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const label = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? 'Отпечаток пальца' : 'Биометрия';
    return { available: true, label, reason: null, enabled: await SecureStore.getItemAsync(k.marker, markerOptions) === '1' };
  } catch { return { ...status, reason: 'Биометрия сейчас недоступна. Используйте пароль капсулы.' }; }
}
// Caller must first validate this exact password through the existing owner-only
// server unlock. No capsule key, Supabase JWT, or account password is stored here.
export async function enableCapsuleBiometry(scope: CapsuleBioScope, password: string, active: () => boolean): Promise<void> {
  const k = keys(scope), start = revision(scope.userId);
  const guard = () => { if (!active() || revision(scope.userId) !== start) throw new CapsuleBiometryError('Включение биометрии отменено.'); };
  return serialize(scope.userId, async () => {
    guard();
    if (!(await getCapsuleBiometry(scope)).available) throw new CapsuleBiometryError('Защищённая биометрия недоступна. Используйте пароль.');
    if (password.length < 8 || password.length > 64 || new TextEncoder().encode(password).length > 72) throw new CapsuleBiometryError('Некорректный пароль раздела.');
    guard();
    // Record the scope before a native prompt/write, so logout can clean a late
    // operation too. The index/marker contain no password or content.
    const families = await index(scope.userId); guard();
    await SecureStore.setItemAsync(k.index, JSON.stringify([...new Set([...families, scope.familyId])]), markerOptions); guard();
    try {
      await SecureStore.setItemAsync(k.secret, JSON.stringify({ version: 1, ...scope, password }), secretOptions);
      guard(); await SecureStore.setItemAsync(k.marker, '1', markerOptions); guard();
    } catch (error) { await remove(scope).catch(() => {}); throw error; }
  });
}
export async function readCapsuleBiometry(scope: CapsuleBioScope, active: () => boolean): Promise<string | null> {
  const k = keys(scope), start = revision(scope.userId);
  const guard = () => { if (!active() || revision(scope.userId) !== start) throw new CapsuleBiometryError('Биометрический вход отменён.'); };
  return serialize(scope.userId, async () => {
    guard(); const status = await getCapsuleBiometry(scope); guard();
    if (!status.available || !status.enabled) return null;
    let raw: string | null;
    try { raw = await SecureStore.getItemAsync(k.secret, secretOptions); }
    catch { throw new CapsuleBiometryError('Проверка отменена или недоступна. Попробуйте ещё раз либо введите пароль.'); }
    guard();
    if (!raw) { await remove(scope); return null; }
    try {
      const value = JSON.parse(raw);
      if (value.version !== 1 || value.userId !== scope.userId || value.familyId !== scope.familyId
        || typeof value.password !== 'string' || value.password.length < 8 || value.password.length > 64
        || new TextEncoder().encode(value.password).length > 72) throw new Error('Invalid scoped credential');
      guard(); return value.password;
    } catch { await remove(scope); throw new CapsuleBiometryError('Вход по биометрии нужно включить заново после пароля.'); }
  });
}
export async function disableCapsuleBiometry(scope: CapsuleBioScope): Promise<void> {
  keys(scope); revisions.set(scope.userId, revision(scope.userId) + 1);
  return serialize(scope.userId, () => remove(scope));
}
export async function clearCapsuleBiometryUser(userId: string): Promise<void> {
  if (!UUID.test(userId)) return;
  // Synchronous invalidation prevents an outstanding native write from opting
  // back in after logout. Cleanup is queued without holding up Auth sign-out.
  revisions.set(userId, revision(userId) + 1);
  return serialize(userId, async () => {
    const families = await index(userId);
    for (const familyId of families) await remove({ userId, familyId });
    await SecureStore.deleteItemAsync(`capsule.index.${userId}`, markerOptions);
  });
}
