import { useRouter } from 'expo-router';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require('../../assets/welcome-phone.png')}
        style={styles.screen}
        resizeMode="cover"
      >
        {/* НАСТОЯЩАЯ кнопка «Создать аккаунт» */}
        <Pressable
          style={({ pressed }) => [
            styles.createButton,
            pressed && styles.pressed,
          ]}
          onPress={() => router.push('/register')}
        >
          <Text style={styles.createButtonText}>
            Создать аккаунт
          </Text>
          <Text style={styles.arrow}>→</Text>
        </Pressable>

        {/* НАСТОЯЩАЯ кнопка «У меня уже есть аккаунт» */}
        <Pressable
          style={({ pressed }) => [
            styles.loginButton,
            pressed && styles.pressed,
          ]}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.loginButtonText}>
            У меня уже есть аккаунт
          </Text>
        </Pressable>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F2EC',
  },

  screen: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  createButton: {
    position: 'absolute',
    left: '9%',
    right: '9%',
    bottom: '17%',
    height: 58,
    borderRadius: 20,

    backgroundColor: '#C98282',

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',

    elevation: 4,
    shadowColor: '#8E5C5C',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },

  createButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },

  arrow: {
    marginLeft: 12,
    color: '#FFFFFF',
    fontSize: 23,
  },

  loginButton: {
    position: 'absolute',
    left: '9%',
    right: '9%',
    bottom: '8%',
    height: 58,
    borderRadius: 20,

    backgroundColor: 'rgba(255, 253, 250, 0.96)',

    borderWidth: 1.5,
    borderColor: '#C98282',

    alignItems: 'center',
    justifyContent: 'center',

    elevation: 3,
    shadowColor: '#8E5C5C',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.12,
    shadowRadius: 5,
  },

  loginButtonText: {
    color: '#B97878',
    fontSize: 16,
    fontWeight: '600',
  },

  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
});