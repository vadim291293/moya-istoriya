import { StoryIcon } from './story-ui';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useIsFocused, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';
import { useAuth } from '../lib/auth-context';
import { navigationStage } from '../lib/navigation-state';
import { formatRuDate, isValidDateIso } from '../lib/date-utils';
import {
  ChildWriteError, createFamilyChild, getPendingFamilyChild, MAX_CHILD_NAME_LENGTH,
} from '../lib/child-service';

function localDateIso(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export function NewChildForm({ userId, familyId, familyName }: {
  userId: string;
  familyId: string;
  familyName: string;
}) {
  const router = useRouter();
  const auth = useAuth();
  const isFocused = useIsFocused();
  const mounted = useRef(true);
  const focused = useRef(isFocused);
  focused.current = isFocused;
  const busy = useRef(false);
  const completed = useRef(false);
  const refreshed = useRef(false);
  const currentScope = navigationStage(auth) === 'family'
    && auth.session?.user.id === userId && auth.family.status === 'ready'
    && auth.family.family.id === familyId;
  const scope = useRef(currentScope);
  scope.current = currentScope;
  const [restored] = useState(() => {
    try { return { submission: getPendingFamilyChild(userId, familyId), error: null }; }
    catch { return { submission: null, error: 'Не удалось прочитать незавершённое добавление. Не создавайте дубликат: требуется проверка локального хранилища.' }; }
  });
  const [name, setName] = useState(restored.submission?.name ?? '');
  const [birthDate, setBirthDate] = useState(restored.submission?.birthDate ?? '');
  const [pending, setPending] = useState(Boolean(restored.submission || restored.error));
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(restored.submission
    ? new Date(`${restored.submission.birthDate}T12:00:00`) : new Date());
  const [errorMessage, setErrorMessage] = useState<string | null>(restored.error
    ?? (restored.submission ? 'Есть незавершённое добавление. Проверим прежнюю запись без создания дубликата.' : null));
  const locked = loading || pending || saved;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Do not block the auth shell when logout/recovery removes this private route.
  usePreventRemove(loading && currentScope, () => {
    setErrorMessage('Дождитесь результата добавления ребёнка.');
  });
  useEffect(() => {
    if (!saved || loading || !isFocused || !currentScope || refreshed.current) return;
    refreshed.current = true;
    // The auth shell owns the redirect after reloading family data. Do not navigate
    // from a late promise: this screen can unmount as soon as refresh starts.
    void auth.refreshFamily();
  }, [saved, loading, isFocused, currentScope, auth.refreshFamily]);

  async function handleSave() {
    if (busy.current || completed.current || restored.error || !scope.current || !focused.current) return;
    busy.current = true;
    Keyboard.dismiss();
    setShowDatePicker(false);
    setErrorMessage(null);
    setLoading(true);
    try {
      await createFamilyChild({ userId, familyId, name, birthDate });
      completed.current = true;
      if (mounted.current && scope.current) setSaved(true);
    } catch (error) {
      if (!mounted.current || !scope.current) return;
      // Once a request is unresolved, an auth/preflight failure on a later retry
      // must not unlock its original payload while the journal still exists.
      setPending((previous) => previous || (error instanceof ChildWriteError && error.pending));
      setErrorMessage(error instanceof ChildWriteError ? error.message
        : 'Не удалось добавить ребёнка. Проверьте подключение и повторите попытку.');
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  function goBack() {
    if (busy.current || completed.current || !scope.current) return;
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Назад" disabled={loading || saved}
              onPress={goBack} style={styles.backButton}>
              <StoryIcon name="back" />
            </Pressable>
            <Text style={styles.headerTitle}>Новая книга жизни</Text>
            <View style={styles.spacer} />
          </View>
          <View style={styles.mark}><StoryIcon name="book" size={28} color={colors.lavenderInk} /></View><Text style={styles.familyLabel}>{familyName}</Text>
          <Text style={styles.title}>Добавим ребёнка</Text>
          <Text style={styles.subtitle}>У каждого ребёнка — своя история. Семья и её воспоминания останутся общими.</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Имя ребёнка</Text>
            <TextInput accessibilityLabel="Имя ребёнка" value={name} onChangeText={setName}
              editable={!locked} maxLength={MAX_CHILD_NAME_LENGTH} autoCapitalize="words"
              placeholder="Например, Маша" placeholderTextColor={colors.muted} style={styles.input}
              returnKeyType="done" onSubmitEditing={() => { if (!busy.current) Keyboard.dismiss(); }} />
            <Text style={styles.label}>Дата рождения</Text>
            {Platform.OS === 'web' ? (
              <TextInput accessibilityLabel="Дата рождения" value={birthDate} onChangeText={setBirthDate}
                editable={!locked} placeholder="ГГГГ-ММ-ДД" maxLength={10} autoCapitalize="none"
                placeholderTextColor={colors.muted} style={styles.input} />
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Выбрать дату рождения" disabled={locked}
                onPress={() => {
                  if (busy.current) return;
                  Keyboard.dismiss();
                  setPickerDate(isValidDateIso(birthDate) ? new Date(`${birthDate}T12:00:00`) : new Date());
                  setShowDatePicker(true);
                }} style={styles.dateButton}>
                <Text style={styles.dateText}>{birthDate ? formatRuDate(birthDate) : 'Выберите дату рождения'}</Text>
                <StoryIcon name="calendar" size={20} color={colors.primary} />
              </Pressable>
            )}
            {showDatePicker ? (
              <View>
                <DateTimePicker accessibilityLabel="Календарь даты рождения" value={pickerDate}
                  mode="date" display="default" maximumDate={new Date()} startOnYearSelection
                  onValueChange={(_event, date) => {
                    if (busy.current) return;
                    if (date) { setPickerDate(date); setBirthDate(localDateIso(date)); }
                    if (Platform.OS === 'android') setShowDatePicker(false);
                  }} onDismiss={() => setShowDatePicker(false)} />
                {Platform.OS === 'ios' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Подтвердить дату рождения"
                    onPress={() => { if (!busy.current) { setBirthDate(localDateIso(pickerDate)); setShowDatePicker(false); } }}
                    style={styles.dateButton}><Text style={styles.dateText}>Использовать выбранную дату</Text></Pressable>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.helper}>По этой дате книга рассчитает возраст и главы. Укажите дату рождения, а не дату добавления.</Text>
          </View>
          {errorMessage ? <Text accessibilityLiveRegion="polite" style={styles.error}>{errorMessage}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={pending ? 'Проверить добавление ребёнка' : 'Добавить ребёнка'}
            disabled={loading || saved || Boolean(restored.error)} onPress={() => void handleSave()}
            style={({ pressed }) => [styles.saveButton, (pressed || loading || saved) && styles.dimmed]}>
            {loading ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.saveText}>{loading ? 'Проверяем и сохраняем…' : pending ? 'Проверить и повторить' : 'Создать книгу ребёнка'}</Text>
          </Pressable>
          <Text style={styles.privacy}>♥ Новая книга будет доступна только вашей семье</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 32, color: colors.primary, lineHeight: 38 },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.ink, fontWeight: '700', fontSize: 16, paddingHorizontal: 8 },
  spacer: { width: 44 },
  mark: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  familyLabel: { color: colors.primary, fontWeight: '700', fontSize: 12, marginTop: 16 },
  title: { color: colors.ink, fontWeight: '800', fontSize: 32, letterSpacing: -0.5, marginTop: 8 },
  subtitle: { color: colors.secondary, fontSize: 14, lineHeight: 22, marginTop: 10 },
  card: { marginTop: 22 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: colors.surface, minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, color: colors.ink, fontSize: 15 },
  dateButton: { backgroundColor: colors.surface, minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateText: { flex: 1, color: colors.ink, fontSize: 15 },
  calendar: { color: colors.primary, fontSize: 21, marginLeft: 8 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 12 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, borderRadius: 14, padding: 12, marginTop: 16, fontSize: 13, lineHeight: 20 },
  saveButton: { minHeight: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 24, padding: 12 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  privacy: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 22 },
  dimmed: { opacity: 0.7 },
});
