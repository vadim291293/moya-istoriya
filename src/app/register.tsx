import { colors } from '../lib/theme';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { AuthFeedback, AuthScreen, authStyles as styles } from '../components/auth-screen';
import { authErrorCode, authErrorMessage, normalizeEmail, validEmail } from '../lib/auth-errors';
import { supabase } from '../lib/supabase';

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; code?: string | null; success?: boolean } | null>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmationInput = useRef<TextInput>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function register() {
    if (busy.current || awaitingEmail) return;
    const cleanEmail = normalizeEmail(email);
    if (!name.trim() || !validEmail(cleanEmail)) {
      setFeedback({ message: 'Введите имя и корректный адрес электронной почты.' }); return;
    }
    if (password.length < 6) {
      setFeedback({ message: 'Пароль должен содержать не менее 6 символов.' }); return;
    }
    if (password !== password.trim()) {
      setFeedback({ message: 'Уберите случайные пробелы в начале и конце нового пароля.' }); return;
    }
    if (password !== confirmation) {
      setFeedback({ message: 'Пароли не совпадают. Введите один и тот же пароль в оба поля.' }); return;
    }
    Keyboard.dismiss(); busy.current = true; setLoading(true); setFeedback(null);
    try {
      const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password,
        options: { emailRedirectTo: Linking.createURL('auth/reset-password'), data: { name: name.trim() } } });
      if (error) throw error;
      if (!data.session && mounted.current) {
        setAwaitingEmail(true);
        setPassword(''); setConfirmation('');
        setFeedback({ success: true, message: 'Проверьте почту и откройте ссылку подтверждения на этом телефоне. Если аккаунт уже был создан, войдите в него или восстановите пароль.' });
      }
      // With a session, AuthProvider opens setup or the existing family itself.
    } catch (error) {
      if (mounted.current) setFeedback({ message: authErrorMessage(error), code: authErrorCode(error) });
    } finally {
      busy.current = false; if (mounted.current) setLoading(false);
    }
  }

  const locked = loading || awaitingEmail;
  return <AuthScreen title="Начнём вашу историю" subtitle="Место для фотографий, важных дней и воспоминаний, которые хочется сохранить." busy={loading} onBack={() => router.replace('/')}>
    <Text style={styles.label}>Ваше имя</Text>
    <TextInput accessibilityLabel="Ваше имя" style={styles.input} placeholder="Как вас зовут?" placeholderTextColor={colors.muted}
      value={name} onChangeText={setName} editable={!locked} autoComplete="name" textContentType="name" autoCapitalize="words"
      returnKeyType="next" onSubmitEditing={() => emailInput.current?.focus()} />
    <Text style={styles.label}>Электронная почта</Text>
    <TextInput ref={emailInput} accessibilityLabel="Электронная почта" style={styles.input} placeholder="you@example.com" placeholderTextColor={colors.muted}
      value={email} onChangeText={setEmail} editable={!locked} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
      autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
    {!awaitingEmail ? <>
      <Text style={styles.label}>Придумайте пароль</Text>
      <View style={styles.passwordRow}>
        <TextInput ref={passwordInput} accessibilityLabel="Пароль" style={styles.passwordInput} placeholder="Не менее 6 символов" placeholderTextColor={colors.muted}
          value={password} onChangeText={setPassword} editable={!locked} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false}
          autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => confirmationInput.current?.focus()} />
        <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'} style={styles.eyeButton} onPress={() => setShowPassword((value) => !value)}>
          <Text style={styles.eyeText}>{showPassword ? 'Скрыть' : 'Показать'}</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>Повторите пароль</Text>
      <TextInput ref={confirmationInput} accessibilityLabel="Повторите пароль" style={styles.input} placeholder="Тот же пароль ещё раз" placeholderTextColor={colors.muted}
        value={confirmation} onChangeText={setConfirmation} editable={!locked} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false}
        autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={() => void register()} />
    </> : null}
    {feedback ? <AuthFeedback {...feedback} /> : null}
    {!awaitingEmail ? <Pressable accessibilityRole="button" accessibilityLabel="Создать аккаунт" disabled={loading} onPress={() => void register()}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, loading && styles.disabled]}>
      {loading ? <ActivityIndicator color="#FFFFFF" /> : null}
      <Text style={styles.buttonText}>{loading ? 'Создаём аккаунт…' : 'Создать аккаунт'}</Text>
    </Pressable> : null}
    <View style={styles.switchRow}>
      <Text style={styles.switchText}>Уже есть аккаунт?</Text>
      <Pressable accessibilityRole="button" disabled={loading} onPress={() => router.replace('/login')} style={styles.link}>
        <Text style={styles.linkText}>Войти</Text>
      </Pressable>
    </View>
  </AuthScreen>;
}
