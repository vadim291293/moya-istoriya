import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/welcome.png')}
        style={styles.image}
        resizeMode="cover"
      />

      {/* Кнопка "Создать аккаунт" */}
      <Pressable
        style={styles.createButton}
        onPress={() => router.push('/register')}
      />

      {/* Кнопка "У меня уже есть аккаунт" */}
      <Pressable
        style={styles.loginButton}
        onPress={() => router.push('/login')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F2EC',
  },

  image: {
    width: '100%',
    height: '100%',
  },

  createButton: {
    position: 'absolute',
    left: '9%',
    right: '9%',
    bottom: '21%',
    height: 58,
  },

  loginButton: {
    position: 'absolute',
    left: '9%',
    right: '9%',
    bottom: '12%',
    height: 58,
  },
});