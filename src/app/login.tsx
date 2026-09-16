import { useRouter } from 'expo-router';
import {
    ImageBackground,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ImageBackground
          source={require('../../assets/login.png')}
          style={styles.screen}
          resizeMode="stretch"
        >
          {/* Назад */}
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityLabel="Назад"
          />

          {/* Email */}
          <TextInput
            style={[styles.input, styles.emailInput]}
            placeholder="your@email.com"
            placeholderTextColor="#B9AAA5"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
          />

          {/* Пароль */}
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="Ваш пароль"
            placeholderTextColor="#B9AAA5"
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
          />

          {/* Забыли пароль? */}
          <Pressable
            style={styles.forgotButton}
            onPress={() => {}}
            accessibilityLabel="Забыли пароль"
          />

          {/* Войти */}
          <Pressable
            style={({ pressed }) => [
              styles.loginButton,
              pressed && styles.pressed,
            ]}
            onPress={() => {}}
            accessibilityLabel="Войти"
          />

          {/* Создать аккаунт */}
          <Pressable
            style={({ pressed }) => [
              styles.registerButton,
              pressed && styles.pressed,
            ]}
            onPress={() => router.replace('/register')}
            accessibilityLabel="Создать аккаунт"
          />
        </ImageBackground>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  container: {
    flex: 1,
    backgroundColor: '#F9F2EC',
  },

  screen: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  /*
   * Все координаты ниже заданы в процентах.
   * Поэтому расположение элементов масштабируется
   * вместе с экраном телефона.
   */

  backButton: {
    position: 'absolute',
    left: '4%',
    top: '2%',
    width: '12%',
    height: '6%',
  },

  input: {
    position: 'absolute',
    left: '11%',
    width: '78%',
    height: '7%',
    borderRadius: 14,
    paddingHorizontal: '8%',
    backgroundColor: '#FFFDFC',
    borderWidth: 1,
    borderColor: '#E1D4CC',
    color: '#514743',
    fontSize: 16,
  },

  emailInput: {
    top: '35.8%',
  },

  passwordInput: {
    top: '46.5%',
  },

  forgotButton: {
    position: 'absolute',
    right: '11%',
    top: '54.2%',
    width: '25%',
    height: '5%',
  },

  loginButton: {
    position: 'absolute',
    left: '11%',
    width: '78%',
    top: '59.2%',
    height: '7%',
    borderRadius: 18,
  },

  registerButton: {
    position: 'absolute',
    left: '54%',
    top: '67.5%',
    width: '20%',
    height: '5%',
  },

  pressed: {
    opacity: 0.65,
  },
});