// Same local storage already used for Supabase sessions. No token is logged.
// Draft text/invitation codes are not additionally encrypted; scoped keys never
// permit an operation to be sent under a different account or family.
export function operationKey(kind: 'edit' | 'invite' | 'lifecycle' | 'join', userId: string, familyId: string, memoryId = '') {
  return `moya-istoriya:operation:v1:${kind}:${userId}:${familyId}:${memoryId}`;
}
export function readOperation(key: string): unknown {
  if (typeof localStorage === 'undefined') throw new Error('Локальное хранилище недоступно. Не отправляйте действие до его восстановления.');
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
export function writeOperation(key: string, value: unknown) {
  if (typeof localStorage === 'undefined') throw new Error('Не удалось сохранить отправку на устройстве. Запрос не отправлен.');
  localStorage.setItem(key, JSON.stringify(value));
}
export function clearOperation(key: string) { localStorage.removeItem(key); }
