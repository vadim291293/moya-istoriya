import DateTimePicker from '@react-native-community/datetimepicker';
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

export default function SetupScreen() {
  const router = useRouter();

  const [familyName, setFamilyName] = useState('');
  const [childName, setChildName] = useState('');
  const [birthDate, setBirthDate] = useState(new Date());
  const familyInputRef = useRef<TextInput>(null);
  const childInputRef = useRef<TextInput>(null);
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleCreateHistory() {
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
    setLoading(true);

    const birthDateString = [
      birthDate.getFullYear(),
      String(birthDate.getMonth() + 1).padStart(2, '0'),
      String(birthDate.getDate()).padStart(2, '0'),
    ].join('-');

    const { data, error } = await supabase.rpc(
      'create_family_with_child',
      {
        p_family_name: cleanFamilyName,
        p_child_name: cleanChildName,
        p_birth_date: birthDateString,
      },
    );

    setLoading(false);

    if (error) {
      Alert.alert(
        'Не удалось создать историю',
        error.message,
      );
      return;
    }

    if (!data) {
      Alert.alert(
        'Не удалось создать историю',
        'Сервер не вернул данные ребёнка.',
      );
      return;
    }

    router.replace('/');
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
              onPress={() => router.back()}
            >
              <Text style={styles.backText}>‹</Text>
            </Pressable>

            <Text style={styles.heart}>♥</Text>

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

              <Text style={styles.label}>
                Ваша семья
                </Text>

              <TextInput
                 ref={familyInputRef}
                    style={styles.input}
                    placeholder="Ивановы"
                    placeholderTextColor="#B9AAA5"
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
                placeholderTextColor="#B9AAA5"
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
    paddingBottom: 20,
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
    textAlign: 'center',
  },

  titleAccent: {
    fontSize: 29,
    fontWeight: '700',
    color: '#B96870',
    marginTop: -2,
    textAlign: 'center',
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

  dateInput: {
    width: '100%',
    height: 52,
    borderRadius: 17,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E4C9C1',
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dateText: {
    fontSize: 15,
    color: '#493C38',
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
    borderRadius: 27,
    backgroundColor: '#C8757D',
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
    textAlign: 'center',
  },

  arrow: {
    color: '#FFFFFF',
    fontSize: 24,
    marginLeft: 15,
    marginTop: -2,
  },

  footer: {
    marginTop: 'auto',
    marginBottom: 10,
    fontSize: 12,
    color: '#AA9993',
    textAlign: 'center',
  },
});