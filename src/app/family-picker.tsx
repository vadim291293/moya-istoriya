import { colors } from '../lib/theme';
import { StoryIcon } from '../components/story-ui';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth-context';

function roleLabel(role: string) {
  if (role === 'owner') return 'Владелец';
  if (role === 'admin') return 'Администратор';
  return 'Участник семьи';
}

export default function FamilyPickerScreen() {
  const router = useRouter();
  const { family, selectFamily, signOut } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  if (family.status !== 'multiple') {
    return null;
  }

  async function handleSelect(familyId: string) {
    setSelectedId(familyId);
    await selectFamily(familyId);
    setSelectedId(null);
  }

  async function handleSignOut() {
    setLoggingOut(true);
    const error = await signOut();
    setLoggingOut(false);
    if (error) {
      Alert.alert('Не удалось выйти', 'Проверьте подключение и попробуйте ещё раз.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.mark}><StoryIcon name="book" color={colors.primary} size={32} /></View>
        <Text style={styles.title}>Выберите семейную историю</Text>
        <Text style={styles.subtitle}>
          В вашем аккаунте больше одной семьи. Выберите, какую открыть сейчас.
        </Text>

        <View style={styles.list}>
          {family.choices.map((choice) => {
            const isSelected = selectedId === choice.id;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Открыть семью ${choice.name}`}
                disabled={selectedId !== null}
                key={choice.id}
                onPress={() => void handleSelect(choice.id)}
                style={({ pressed }) => [
                  styles.familyCard,
                  pressed && styles.pressed,
                  isSelected && styles.selectedCard,
                ]}
              >
                <View style={styles.familyIcon}>
                  <Text style={styles.familyIconText}>
                    {choice.name.trim().charAt(0).toLocaleUpperCase('ru-RU') || '♥'}
                  </Text>
                </View>
                <View style={styles.familyInfo}>
                  <Text style={styles.familyName}>{choice.name}</Text>
                  <Text style={styles.role}>{roleLabel(choice.role)}</Text>
                </View>
                {isSelected ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.arrow}>›</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Принять приглашение" disabled={loggingOut || selectedId !== null}
          onPress={() => { if (!loggingOut && selectedId === null) router.push('/family/join'); }} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Принять приглашение в семью</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={loggingOut || selectedId !== null}
          onPress={() => void handleSignOut()}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
        >
          <Text style={styles.signOutText}>
            {loggingOut ? 'Выходим…' : 'Выйти из аккаунта'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 54,
    paddingBottom: 28,
  },
  mark: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  heart: {
    color: '#D4777F',
    fontSize: 40,
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    maxWidth: 360,
    textAlign: 'center',
  },
  list: {
    width: '100%',
    gap: 12,
    marginTop: 30,
  },
  familyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 14,
    minHeight: 76,
  },
  selectedCard: {
    borderColor: colors.primary,
  },
  familyIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  familyIconText: {
    color: colors.lavenderInk,
    fontSize: 20,
    fontWeight: '700',
  },
  familyInfo: {
    flex: 1,
    marginLeft: 13,
  },
  familyName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  role: {
    color: colors.secondary,
    fontSize: 12,
    marginTop: 4,
  },
  arrow: {
    color: colors.primary,
    fontSize: 26,
  },
  signOutButton: {
    marginTop: 'auto',
    padding: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  signOutText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
