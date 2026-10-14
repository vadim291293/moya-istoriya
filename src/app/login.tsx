import { colors } from '../lib/theme';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { AuthFeedback, AuthScreen, authStyles as styles } from '../components/auth-screen';
import { authErrorCode, authErrorMessage, normalizeEmail, validEmail } from '../lib/auth-errors';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [action, setAction] = useState<'login' | 'reset' | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; code?: string | null; success?: boolean } | null>(null);
  const passwordInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(nextAction: 'login' | 'reset') {
    if (!mounted.current || busy.current) return;
    const cleanEmail = normalizeEmail(email);
    if (!validEmail(cleanEmail) || (nextAction === 'login' && !password)) {
      setFeedback({ message: nextAction === 'reset' ? 'Введите корректную почту аккаунта.' : 'Введите корректную почту и пароль аккаунта.' });
      if (!validEmail(cleanEmail)) emailInput.current?.focus();
      else passwordInput.current?.focus();
      return;
    }
    Keyboard.dismiss();
    busy.current = true;
    setAction(nextAction);
    setFeedback(null);
    try {
      if (nextAction === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: Linking.createURL('auth/reset-password'),
        });
        if (error) throw error;
        if (mounted.current) setFeedback({ success: true,
          message: 'Запрос принят. Если аккаунт существует, вы получите ссылку на эту почту. Откройте последнее письмо на этом телефоне и задайте новый пароль. Если письма нет, проверьте «Спам» и подождите несколько минут.' });
      } else {
        // Never trim or case-normalize passwords: old accounts may include spaces.
        const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        if (!data.session) throw new Error('No session returned');
        // AuthProvider owns session changes and protected navigation.
      }
    } catch (error) {
      if (mounted.current) setFeedback({ message: authErrorMessage(error), code: authErrorCode(error) });
    } finally {
      busy.current = false;
      if (mounted.current) setAction(null);
    }
  }

  const loading = action !== null;
  return <AuthScreen title="С возвращением" subtitle="Войдите, чтобы продолжить историю своей семьи." onBack={() => router.replace('/')} busy={loading}>
    <Text style={styles.label}>Электронная почта</Text>
    <TextInput ref={emailInput} accessibilityLabel="Электронная почта" style={styles.input}
      placeholder="you@example.com" placeholderTextColor={colors.muted} keyboardType="email-address"
      autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
      editable={!loading} value={email} onChangeText={(value) => { setEmail(value); setFeedback(null); }}
      returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
    <Text style={styles.label}>Пароль</Text>
    <View style={styles.passwordRow}>
      <TextInput ref={passwordInput} accessibilityLabel="Пароль" style={styles.passwordInput}
        placeholder="Пароль вашего аккаунта" placeholderTextColor={colors.muted} secureTextEntry={!showPassword}
        autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password"
        editable={!loading} value={password} onChangeText={(value) => { setPassword(value); setFeedback(null); }}
        returnKeyType="done" onSubmitEditing={() => void submit('login')} />
      <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
        onPress={() => setShowPassword((value) => !value)} style={styles.eyeButton}>
        <Text style={styles.eyeText}>{showPassword ? 'Скрыть' : 'Показать'}</Text>
      </Pressable>
    </View>
    {password !== password.trim() ? <Text style={styles.hint}>В начале или конце пароля есть пробел. Он будет отправлен как часть пароля.</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Забыли пароль?" disabled={loading} onPress={() => void submit('reset')} style={[styles.link, styles.forgot]}>
      <Text style={styles.linkText}>{action === 'reset' ? 'Отправляем письмо…' : 'Забыли пароль?'}</Text>
    </Pressable>
    {feedback ? <AuthFeedback {...feedback} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Войти" disabled={loading} onPress={() => void submit('login')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, loading && styles.disabled]}>
      {loading ? <ActivityIndicator color="#FFFFFF" /> : null}
      <Text style={styles.buttonText}>{action === 'login' ? 'Входим…' : 'Войти'}</Text>
    </Pressable>
    <View style={styles.switchRow}>
      <Text style={styles.switchText}>Ещё нет аккаунта?</Text>
      <Pressable accessibilityRole="button" disabled={loading} onPress={() => router.replace('/register')} style={styles.link}>
        <Text style={styles.linkText}>Создать аккаунт</Text>
      </Pressable>
    </View>
  </AuthScreen>;
}
