import type { CapsuleBioScope, CapsuleBioStatus } from './capsule-biometry-types';
export { CapsuleBiometryError } from './capsule-biometry-types';
export type { CapsuleBioStatus } from './capsule-biometry-types';
// Web never persists a capsule password or substitutes a browser flag for OS auth.
export async function getCapsuleBiometry(_scope: CapsuleBioScope): Promise<CapsuleBioStatus> {
  return { available: false, enabled: false, label: 'Биометрия', reason: 'В браузере используйте пароль. Биометрия доступна в мобильном приложении.' };
}
export async function enableCapsuleBiometry(_scope: CapsuleBioScope, _password: string, _active: () => boolean): Promise<void> { throw new Error('Биометрия доступна только на телефоне.'); }
export async function readCapsuleBiometry(_scope: CapsuleBioScope, _active: () => boolean): Promise<string | null> { return null; }
export async function disableCapsuleBiometry(_scope: CapsuleBioScope): Promise<void> {}
export async function clearCapsuleBiometryUser(_userId: string): Promise<void> {}
