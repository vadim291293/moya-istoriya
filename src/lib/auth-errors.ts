type AuthFailure = { code?: unknown; status?: unknown; message?: unknown; name?: unknown };

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function authErrorMessage(error: unknown) {
  const failure: AuthFailure = typeof error === 'object' && error !== null ? error : {};
  const code = failure.code;
  if (code === 'invalid_credentials' || failure.message === 'Invalid login credentials') {
    return 'Почта или пароль не совпадают. Проверьте раскладку, регистр и пробелы. Если пароль забыт, восстановите доступ ниже — создавать новый аккаунт не нужно.';
  }
  if (code === 'email_not_confirmed') return 'Сначала подтвердите почту по ссылке из письма регистрации, затем войдите.';
  if (code === 'email_exists' || code === 'user_already_exists') return 'Аккаунт с этой почтой уже существует. Войдите или восстановите пароль.';
  if (failure.status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'Слишком много попыток. Подождите несколько минут и попробуйте снова.';
  }
  if (code === 'email_address_not_authorized') return 'Supabase пока не разрешает отправлять письма на этот адрес. Требуется настройка почтового сервиса проекта.';
  if (code === 'weak_password') return 'Пароль не соответствует требованиям сервера. Используйте более длинный пароль с буквами и цифрами.';
  if (code === 'same_password') return 'Новый пароль должен отличаться от прежнего. Выберите другой пароль.';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'Проверьте адрес почты и заполненные поля.';
  if (failure.name === 'AuthRetryableFetchError' || failure.message === 'Network request failed' || failure.message === 'Failed to fetch') {
    return 'Не удалось связаться с сервером. Проверьте интернет и повторите попытку.';
  }
  if (typeof failure.status === 'number' && failure.status >= 500) return 'Сервис входа временно недоступен. Попробуйте позже.';
  return 'Не удалось завершить запрос. Проверьте интернет и повторите попытку.';
}

// Display only a safe diagnostic identifier, never email, password, token or raw response.
export function authErrorCode(error: unknown): string | null {
  const failure: AuthFailure = typeof error === 'object' && error !== null ? error : {};
  return typeof failure.code === 'string' && /^[a-z_]{3,64}$/.test(failure.code) ? failure.code : null;
}
