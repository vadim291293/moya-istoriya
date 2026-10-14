export type CapsuleBioScope = { userId: string; familyId: string };
export type CapsuleBioStatus = { available: boolean; enabled: boolean; label: string; reason: string | null };
export class CapsuleBiometryError extends Error {
  constructor(message: string) { super(message); this.name = 'CapsuleBiometryError'; }
}
