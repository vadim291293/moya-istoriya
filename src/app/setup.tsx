import { colors } from '../lib/theme';
import { StoryIcon } from '../components/story-ui';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
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
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';

export default function SetupScreen() {
  const router = useRouter();
  const { refreshFamily, signOut, session } = useAuth();
  const submitting = useRef(false);

  const [familyName, setFamilyName] = useState('');
  const [childName, setChildName] = useState('');
  const [birthDate, setBirthDate] = useState(new Date());
  const familyInputRef = useRef<TextInput>(null);
  const childInputRef = useRef<TextInput>(null);
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleExitSetup() {
    const error = await signOut();
    if (error) {
      Alert.alert('Не удалось выйти', 'Проверьте подключение и попробуйте ещё раз.');
    }
  }

  async function handleCreateHistory() {
    if (submitting.current || loading || !session) return;
    const cleanFamilyName = familyName.trim();
    const cleanChildName = childName.trim();

    if (!cleanFamilyName || !cleanChildName) {
      Alert.alert(
        'Заполните данные',
        'Введите название семьи и имя ребёнка.',
      );
      return;
    }

    Keyboard.dismiss();
    submitting.current = true;
    setLoading(true);

    const birthDateString = [
      birthDate.getFullYear(),
      String(birthDate.getMonth() + 1).padStart(2, '0'),
      String(birthDate.getDate()).padStart(2, '0'),
    ].join('-');

    try {
      // Recheck membership before any write; a previous request may have committed.
      const { data: existing, error: membershipError } = await supabase
        .from('family_members').select('family_id').eq('user_id', session.user.id).limit(1);
      if (membershipError) throw membershipError;
      if (existing?.length) {
        await refreshFamily();
        return;
      }
      const { data, error } = await supabase.rpc(
        'create_family_with_child',
        {
          p_family_name: cleanFamilyName,
          p_child_name: cleanChildName,
          p_birth_date: birthDateString,
        },
      );

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('Сервер не вернул данные ребёнка.');
      }

      await refreshFamily();
    } catch {
      Alert.alert(
        'Не удалось подтвердить создание',
        'Проверим, появилась ли семья на сервере. При потере соединения не создавайте историю повторно, пока не проверен результат.',
      );
      await refreshFamily();
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function formatBirthDate(date: Date) {
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  function handleDateChange(
    _event: unknown,
    selectedDate?: Date,
  ) {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }

    if (selectedDate) {
      setBirthDate(selectedDate);
    }
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
              onPress={() => void handleExitSetup()}
              accessibilityRole="button"
              accessibilityLabel="Выйти из аккаунта"
              disabled={loading}
            >
              <StoryIcon name="close" />
            </Pressable>

            <View style={styles.mark}><StoryIcon name="book" size={30} color={colors.primary} /></View>

            <Text style={styles.title}>
              Создадим вашу
            </Text>

            <Text style={styles.titleAccent}>
              семейную историю
            </Text>

            <Text style={styles.subtitle}>
              Начните с вашей семьи и первого
              ребёнка
            </Text>

            <View style={styles.form}>
              <Pressable accessibilityRole="button" accessibilityLabel="Принять приглашение" disabled={loading}
                onPress={() => { if (!submitting.current && !loading && session) router.push('/family/join'); }} style={styles.dateInput}>
                <Text style={styles.dateText}>Меня пригласили в семью</Text>
              </Pressable>

              <Text style={styles.label}>
                Ваша семья
                </Text>

              <TextInput
                 ref={familyInputRef}
                    style={styles.input}
                    placeholder="Ивановы"
                    editable={!loading}
                    placeholderTextColor={colors.muted}
                    value={familyName}
                    onChangeText={setFamilyName}
                    returnKeyType="next"
                    onSubmitEditing={() => childInputRef.current?.focus()}
                    autoCapitalize="words"
                />

              <Text style={styles.label}>
                Имя ребёнка
              </Text>

             <TextInput
                ref={childInputRef}
                style={styles.input}
                placeholder="Имя ребёнка"
                editable={!loading}
                placeholderTextColor={colors.muted}
                value={childName}
                onChangeText={setChildName}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                autoCapitalize="words"
            />

              <Text style={styles.label}>
                Дата рождения
              </Text>

              <Pressable
                style={styles.dateInput}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowDatePicker(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Выбрать дату рождения"
                disabled={loading}
              >
                <Text style={styles.dateText}>
                  {formatBirthDate(birthDate)}
                </Text>

                <Text style={styles.calendarIcon}>
                  📅
                </Text>
              </Pressable>

              {showDatePicker && (
                <View style={styles.datePickerWrapper}>
                  <DateTimePicker
                    value={birthDate}
                    mode="date"
                    display="default"
                    maximumDate={new Date()}
                    startOnYearSelection={true}
                    onValueChange={handleDateChange}
                    onDismiss={() => setShowDatePicker(false)}
                 />
                </View>
              )}

            </View>

            <Pressable
              style={[
                styles.button,
                loading && styles.buttonDisabled,
              ]}
              onPress={handleCreateHistory}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={loading ? 'Создаём историю' : 'Создать семейную историю'}
            >
              <Text style={styles.buttonText}>
                {loading
                  ? 'Создаём историю...'
                  : 'Создать семейную историю'}
              </Text>

              {!loading && (
                <Text style={styles.arrow}>
                  →
                </Text>
              )}
            </Pressable>

            <Text style={styles.footer}>
              ♥ Ваша история останется только в вашей семье
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
    backgroundColor: colors.background,
  },

  keyboardContainer: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
  },

  page: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 24,
    alignItems: 'stretch',
    paddingBottom: 24,
  },

  back: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },

  backText: {
    fontSize: 34,
    lineHeight: 38,
    color: colors.ink,
    marginTop: -4,
  },

  mark: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 16 },
  heart: {
    fontSize: 42,
    color: '#D4777F',
    marginTop: 18,
  },

  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 10,
    textAlign: 'left',
  },

  titleAccent: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
    marginTop: -2,
    textAlign: 'left',
  },

  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.secondary,
    textAlign: 'left',
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
    color: colors.ink,
    marginBottom: 7,
    marginLeft: 4,
  },

  input: {
    width: '100%',
    minHeight: 56,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 17,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 16,
  },

  dateInput: {
    width: '100%',
    minHeight: 56,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dateText: {
    fontSize: 15,
    color: colors.ink,
  },

  calendarIcon: {
    fontSize: 20,
  },

  datePickerWrapper: {
    alignItems: 'center',
    marginBottom: 16,
  },

  button: {
    width: '100%',
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    flexDirection: 'row',
    paddingHorizontal: 18,
  },

  buttonDisabled: {
    opacity: 0.7,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'left',
  },

  arrow: {
    color: '#FFFFFF',
    fontSize: 24,
    marginLeft: 15,
    marginTop: -2,
  },

  footer: {
    marginTop: 28,
    marginBottom: 10,
    fontSize: 12,
    color: colors.secondary,
    textAlign: 'left',
  },
});
