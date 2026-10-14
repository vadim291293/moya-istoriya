import { colors } from '../../lib/theme';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { AuthScreen, authStyles as styles } from '../../components/auth-screen';
import { createAuthTaskQueue, readAuthCallback, redeemAuthCallback } from '../../lib/auth-callback';
import { useAuth } from '../../lib/auth-context';
import { authErrorCode, authErrorMessage } from '../../lib/auth-errors';
import { supabase } from '../../lib/supabase';

type ScreenState = 'checking' | 'ready' | 'confirmed' | 'error' | 'done' | 'uncertain';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const linkUrl = Linking.useURL();
  const { beginPasswordRecovery, finishPasswordRecovery, signOut } = useAuth();
  const [screenState, setScreenState] = useState<ScreenState>('checking');
  const [viewRevision, setViewRevision] = useState(0);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [action, setAction] = useState<'saving' | 'leaving' | null>(null);
  const [message, setMessage] = useState('Проверяем ссылку из письма.');
  const lastProcessedUrl = useRef<string | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const recoveryUserId = useRef<string | null>(null);
  const activeScreen = useRef<ScreenState>('checking');
  const leaving = useRef<{ request: number; userId: string } | null>(null);
  const busy = useRef(false);
  const enqueue = useRef(createAuthTaskQueue()).current;
  const changeScreen = useCallback((next: ScreenState) => {
    // Invalidate held UI handlers immediately, before React renders again.
    activeScreen.current = next;
    setScreenState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // A recovery form belongs only to the account whose link we redeemed.
      if (mounted.current && recoveryUserId.current && nextSession?.user.id !== recoveryUserId.current) {
        // Ignore only this screen's own logout, not a sign-in as another user.
        if (event === 'SIGNED_OUT' && !nextSession && leaving.current?.request === revision.current
          && leaving.current.userId === recoveryUserId.current) return;
        recoveryUserId.current = null;
        setViewRevision(++revision.current);
        finishPasswordRecovery();
        setPassword('');
        setPasswordConfirmation('');
        changeScreen('error');
        setMessage('Аккаунт изменился. Запросите новую ссылку восстановления.');
      }
    });
    return () => {
      mounted.current = false;
      revision.current += 1;
      recoveryUserId.current = null;
      lastProcessedUrl.current = null;
      subscription.unsubscribe();
    };
  }, [changeScreen, finishPasswordRecovery]);

  const processLink = useCallback((url: string) => {
    if (!mounted.current || lastProcessedUrl.current === url) return;
    lastProcessedUrl.current = url;
    const request = ++revision.current;
    setViewRevision(request);
    recoveryUserId.current = null;
    setPassword('');
    setPasswordConfirmation('');
    setShowPassword(false);
    changeScreen('checking');
    setMessage('Проверяем ссылку из письма.');
    const current = () => mounted.current && request === revision.current;

    void enqueue(async () => {
      if (!current()) return;
      try {
        const link = readAuthCallback(url);
        if (link.recovery) beginPasswordRecovery();
        const result = await redeemAuthCallback(supabase.auth, link);
        if (!current()) return;
        if (result.recovery) {
          recoveryUserId.current = result.userId;
          beginPasswordRecovery();
          changeScreen('ready');
          setMessage('Задайте новый пароль. Сохранённая семейная история останется в вашем аккаунте.');
        } else {
          finishPasswordRecovery();
          changeScreen('confirmed');
          setMessage('Почта подтверждена. Можно продолжить семейную историю.');
        }
      } catch {
        if (!current()) return;
        finishPasswordRecovery();
        changeScreen('error');
        setMessage('Ссылка недействительна или устарела. Запросите новую и откройте последнее письмо на этом устройстве.');
      }
    });
  }, [beginPasswordRecovery, changeScreen, enqueue, finishPasswordRecovery]);

  useEffect(() => { if (linkUrl) processLink(linkUrl); }, [linkUrl, processLink]);

  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      if (!active || lastProcessedUrl.current) return;
      if (url) processLink(url);
      else {
        changeScreen('error');
        setMessage('Ссылка не найдена. Откройте письмо на этом устройстве или запросите новое.');
      }
    }).catch(() => {
      if (!active || lastProcessedUrl.current) return;
      changeScreen('error');
      setMessage('Не удалось прочитать ссылку. Откройте письмо ещё раз.');
    });
    return () => { active = false; };
  }, [changeScreen, processLink]);

  const currentView = () => mounted.current && viewRevision === revision.current
    && screenState === activeScreen.current;

  function handleSavePassword() {
    if (!currentView() || busy.current || screenState !== 'ready' || !recoveryUserId.current) return;
    if (password.length < 6) {
      setMessage('Пароль должен содержать не менее 6 символов.');
      return;
    }
    if (password !== password.trim()) {
      setMessage('Уберите пробелы в начале и конце нового пароля, чтобы не ошибиться при следующем входе.');
      return;
    }
    if (password !== passwordConfirmation) {
      setMessage('Пароли не совпадают. Проверьте оба поля.');
      return;
    }
    Keyboard.dismiss();
    busy.current = true;
    setAction('saving');
    const request = revision.current;
    const expectedUserId = recoveryUserId.current;
    const current = () => mounted.current && request === revision.current;

    void enqueue(async () => {
      let updateStarted = false;
      try {
        if (!current()) return;
        const { data, error } = await supabase.auth.getSession();
        if (!current()) return;
        if (error) {
          setMessage('Не удалось проверить сессию. Проверьте интернет и попробуйте ещё раз.');
          return;
        }
        if (data.session?.user.id !== expectedUserId) {
          recoveryUserId.current = null;
          finishPasswordRecovery();
          setPassword('');
          setPasswordConfirmation('');
          changeScreen('error');
          setMessage('Сессия восстановления закончилась или аккаунт изменился. Запросите новую ссылку.');
          return;
        }
        updateStarted = true;
        const result = await supabase.auth.updateUser({ password });
        if (!current()) return;
        if (result.error) throw result.error;
        if (result.data.user?.id !== expectedUserId) throw new Error('Unconfirmed password update');
        setPassword('');
        setPasswordConfirmation('');
        changeScreen('done');
        setMessage('Пароль обновлён. Войдите с новым паролем — ваша семейная история останется в аккаунте.');
      } catch (error) {
        if (!current()) return;
        const code = authErrorCode(error);
        if (!updateStarted || code === 'weak_password' || code === 'same_password'
          || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
          setMessage(authErrorMessage(error));
        } else {
          // The request may have succeeded before the connection was lost.
          // Do not offer a blind second mutation or persist the password.
          setPassword('');
          setPasswordConfirmation('');
          changeScreen('uncertain');
          setMessage('Сервер не подтвердил результат: пароль мог измениться. Проверьте вход с новым паролем. Если он не подходит, запросите новую ссылку восстановления.');
        }
      } finally {
        busy.current = false;
        if (mounted.current) setAction(null);
      }
    });
  }

  function leaveRecovery() {
    if (!currentView() || busy.current || !recoveryUserId.current
      || !['ready', 'done', 'uncertain'].includes(screenState)) return;
    busy.current = true;
    setAction('leaving');
    const request = revision.current;
    const expectedUserId = recoveryUserId.current;
    const current = () => mounted.current && request === revision.current;
    void enqueue(async () => {
      try {
        if (!current()) return;
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!current()) return;
        if (sessionError) throw sessionError;
        if (data.session && data.session.user.id !== expectedUserId) {
          recoveryUserId.current = null;
          finishPasswordRecovery();
          setPassword('');
          setPasswordConfirmation('');
          changeScreen('error');
          setMessage('Аккаунт изменился. Запросите новую ссылку восстановления.');
          return;
        }
        leaving.current = { request, userId: expectedUserId };
        const logoutError = data.session ? await signOut() : null;
        if (!current()) return;
        if (logoutError) {
          setMessage('Не удалось выйти. Проверьте интернет и попробуйте ещё раз.');
        }
        else {
          recoveryUserId.current = null;
          setViewRevision(++revision.current);
          setPassword('');
          setPasswordConfirmation('');
          finishPasswordRecovery();
          router.replace('/login');
        }
      } catch {
        if (current()) {
          setMessage('Не удалось выйти. Проверьте интернет и попробуйте ещё раз.');
        }
      } finally {
        if (leaving.current?.request === request) leaving.current = null;
        busy.current = false;
        if (mounted.current) setAction(null);
      }
    });
  }

  const loading = action !== null;
  const isPasswordForm = screenState === 'ready';
  const needsFreshLogin = screenState === 'done' || screenState === 'uncertain';
  const continueLabel = screenState === 'done' ? 'Войти с новым паролем'
    : screenState === 'uncertain' ? 'Проверить вход' : 'Продолжить';
  function continueToApp() {
    if (!currentView() || busy.current || (screenState !== 'confirmed' && screenState !== 'error')) return;
    setViewRevision(++revision.current);
    recoveryUserId.current = null;
    finishPasswordRecovery();
    router.replace('/');
  }

  return <AuthScreen
    title={screenState === 'confirmed' ? 'Почта подтверждена' : screenState === 'done' ? 'Всё готово'
      : screenState === 'uncertain' ? 'Проверьте вход' : 'Новый пароль'}
    subtitle={message} busy={loading || screenState === 'checking'}
    onBack={isPasswordForm || needsFreshLogin ? leaveRecovery : continueToApp}>
    {isPasswordForm ? <>
      <Text style={styles.label}>Новый пароль</Text>
      <View style={styles.passwordRow}>
        <TextInput accessibilityLabel="Новый пароль" style={styles.passwordInput}
          placeholder="Не менее 6 символов" placeholderTextColor={colors.muted} editable={!loading}
          value={password} onChangeText={(value) => { if (currentView() && !busy.current) setPassword(value); }} secureTextEntry={!showPassword}
          autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
        <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          disabled={loading} onPress={() => { if (currentView() && !busy.current) setShowPassword((value) => !value); }} style={styles.eyeButton}>
          <Text style={styles.eyeText}>{showPassword ? 'Скрыть' : 'Показать'}</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>Повторите пароль</Text>
      <TextInput accessibilityLabel="Повторите пароль" style={styles.input}
        placeholder="Точно такой же пароль" placeholderTextColor={colors.muted} editable={!loading}
        value={passwordConfirmation} onChangeText={(value) => { if (currentView() && !busy.current) setPasswordConfirmation(value); }} secureTextEntry={!showPassword}
        autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
        returnKeyType="done" onSubmitEditing={handleSavePassword} />
      <Pressable accessibilityRole="button" accessibilityLabel="Сохранить пароль" disabled={loading}
        onPress={handleSavePassword} style={({ pressed }) => [styles.button, pressed && styles.pressed, loading && styles.disabled]}>
        {loading ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.buttonText}>{action === 'saving' ? 'Сохраняем…' : 'Сохранить пароль'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Отменить и выйти" disabled={loading}
        onPress={leaveRecovery} style={styles.link}>
        <Text style={styles.linkText}>{action === 'leaving' ? 'Выходим…' : 'Отменить и выйти'}</Text>
      </Pressable>
    </> : screenState === 'checking' ? <ActivityIndicator color={colors.primary} accessibilityLabel="Проверка ссылки" />
      : <Pressable accessibilityRole="button" accessibilityLabel={continueLabel} disabled={loading}
        onPress={needsFreshLogin ? leaveRecovery : continueToApp} style={[styles.button, loading && styles.disabled]}>
        {loading ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.buttonText}>{action === 'leaving' ? 'Выходим…' : continueLabel}</Text>
      </Pressable>}
  </AuthScreen>;
}
