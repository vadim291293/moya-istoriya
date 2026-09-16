import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RegisterScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
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
            style={styles.input}
            placeholder="Как вас зовут?"
            placeholderTextColor="#B9AAA5"
          />

          <Text style={styles.label}>
            Электронная почта
          </Text>

          <TextInput
            style={styles.input}
            placeholder="your@email.com"
            placeholderTextColor="#B9AAA5"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>
            Пароль
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Не менее 6 символов"
            placeholderTextColor="#B9AAA5"
            secureTextEntry
          />

        </View>

        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>
            Создать аккаунт
          </Text>

          <Text style={styles.arrow}>
            →
          </Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F2EC',
  },

  page: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
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