import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

export default function RegisterScreen() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const nameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  async function handleRegister() {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !password) {
      Alert.alert(
        'Заполните данные',
        'Введите имя, электронную почту и пароль.',
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert(
        'Слишком короткий пароль',
        'Пароль должен содержать не менее 6 символов.',
      );
      return;
    }

    Keyboard.dismiss();
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          name: cleanName,
        },
      },
    });

    setLoading(false);

    if (error) {
      Alert.alert(
        'Не удалось создать аккаунт',
        error.message,
      );
      return;
    }

    Alert.alert(
      'Аккаунт создан',
      'Регистрация прошла успешно.',
      [
        {
          text: 'Продолжить',
          onPress: () => router.replace('/setup'),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>

            <Pressable
              style={styles.back}
              onPress={() => router.back()}
            >
              <Text style={styles.backText}>‹</Text>
            </Pressable>

            <Text style={styles.heart}>♥</Text>

            <Text style={styles.title}>
              Создадим вашу
            </Text>

            <Text style={styles.titleAccent}>
              историю
            </Text>

            <Text style={styles.subtitle}>
              Начните создавать семейную книгу
              воспоминаний вместе
            </Text>

            <View style={styles.form}>

              <Text style={styles.label}>
                Ваше имя
              </Text>

              <TextInput
                ref={nameInputRef}
                style={styles.input}
                placeholder="Как вас зовут?"
                placeholderTextColor="#B9AAA5"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onSubmitEditing={() => emailInputRef.current?.focus()}
                blurOnSubmit={false}
                autoCapitalize="words"
              />

              <Text style={styles.label}>
                Электронная почта
              </Text>

              <TextInput
                ref={emailInputRef}
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor="#B9AAA5"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                blurOnSubmit={false}
              />

              <Text style={styles.label}>
                Пароль
              </Text>

              <View style={styles.passwordContainer}>
                <TextInput
                  ref={passwordInputRef}
                  style={styles.passwordInput}
                  placeholder="Не менее 6 символов"
                  placeholderTextColor="#B9AAA5"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword
                      ? 'Скрыть пароль'
                      : 'Показать пароль'
                  }
                >
                  <Text style={styles.eye}>
                    {showPassword ? '🙈' : '👁'}
                  </Text>
                </Pressable>
              </View>

            </View>

            <Pressable
              style={[
                styles.button,
                loading && styles.buttonDisabled,
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Создаём аккаунт...' : 'Создать аккаунт'}
              </Text>

              {!loading && (
                <Text style={styles.arrow}>
                  →
                </Text>
              )}
            </Pressable>

            <View style={styles.loginRow}>
              <Text style={styles.loginText}>
                Уже есть аккаунт?
              </Text>

              <Pressable onPress={() => router.replace('/login')}>
                <Text style={styles.loginLink}>
                  Войти
                </Text>
              </Pressable>
            </View>

            <Text style={styles.footer}>
              ♥ Только для вашей семьи
            </Text>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F2EC',
  },

  keyboardContainer: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
  },

  page: {
    flexGrow: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    paddingBottom: 16,
  },

  back: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFDF9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },

  backText: {
    fontSize: 34,
    lineHeight: 38,
    color: '#8F7069',
    marginTop: -4,
  },

  heart: {
    fontSize: 42,
    color: '#D4777F',
    marginTop: 18,
  },

  title: {
    fontSize: 29,
    fontWeight: '700',
    color: '#493C38',
    marginTop: 10,
  },

  titleAccent: {
    fontSize: 29,
    fontWeight: '700',
    color: '#B96870',
    marginTop: -2,
  },

  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#8D7D78',
    textAlign: 'center',
    marginTop: 9,
    maxWidth: 330,
  },

  form: {
    width: '100%',
    marginTop: 28,
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#665651',
    marginBottom: 7,
    marginLeft: 4,
  },

  input: {
    width: '100%',
    height: 52,
    borderRadius: 17,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E4C9C1',
    paddingHorizontal: 17,
    fontSize: 15,
    color: '#493C38',
    marginBottom: 16,
  },

  passwordContainer: {
    width: '100%',
    position: 'relative',
    marginBottom: 16,
  },

  passwordInput: {
    width: '100%',
    height: 52,
    borderRadius: 17,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E4C9C1',
    paddingLeft: 17,
    paddingRight: 55,
    fontSize: 15,
    color: '#493C38',
  },

  eyeButton: {
    position: 'absolute',
    right: 7,
    top: 5,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  eye: {
    fontSize: 20,
  },

  button: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: '#C8757D',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 7,
    flexDirection: 'row',
  },

  buttonDisabled: {
    opacity: 0.7,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  arrow: {
    color: '#FFFFFF',
    fontSize: 24,
    marginLeft: 15,
    marginTop: -2,
  },

  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },

  loginText: {
    fontSize: 13,
    color: '#91817B',
  },

  loginLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B96870',
    marginLeft: 5,
  },

  footer: {
    marginTop: 'auto',
    marginBottom: 10,
    fontSize: 12,
    color: '#AA9993',
  },
});