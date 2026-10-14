import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StoryIcon, StoryIllustration } from '../components/story-ui';
import { colors } from '../lib/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.brandRow}><StoryIcon name="book" color={colors.primary} /><Text style={styles.brand}>Моя история</Text></View>
      <View style={styles.illustration}><StoryIllustration /></View>
      <Text style={styles.eyebrow}>МАЛЕНЬКИЕ МОМЕНТЫ. БОЛЬШАЯ ИСТОРИЯ.</Text>
      <Text accessibilityRole="header" style={styles.title}>Детство, которое{'\n'}всегда с вами</Text>
      <Text style={styles.subtitle}>Фотографии, первые открытия и ваши слова. Соберите их в семейную книгу жизни.</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Создать аккаунт" onPress={() => router.push('/register')}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Начать свою историю</Text><StoryIcon name="chevron" color="#FFFFFF" size={19} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="У меня уже есть аккаунт" onPress={() => router.push('/login')}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><Text style={styles.secondaryText}>У меня уже есть аккаунт</Text></Pressable>
      </View>
      <View style={styles.privacy}><StoryIcon name="lock" size={14} color={colors.secondary} /><Text style={styles.privacyText}>Только вы и ваша семья</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  brand: { color: colors.ink, fontWeight: '800', fontSize: 19, letterSpacing: -0.5 },
  illustration: { width: '100%', aspectRatio: 340 / 270, maxHeight: 280, marginTop: 18 },
  eyebrow: { color: colors.primary, fontSize: 9, lineHeight: 16, letterSpacing: 1.3, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 39, fontWeight: '800', letterSpacing: -1, textAlign: 'center', marginTop: 12 },
  subtitle: { color: colors.secondary, fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 14 },
  actions: { marginTop: 'auto', paddingTop: 28, gap: 10 },
  primary: { backgroundColor: colors.primary, borderRadius: 24, minHeight: 58, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  secondary: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 24, padding: 12 },
  secondaryText: { color: colors.ink, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  privacyText: { color: colors.secondary, fontSize: 11 },
  pressed: { opacity: 0.8 },
});
