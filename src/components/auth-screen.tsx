import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';
import { StoryIcon } from './story-ui';

export function AuthScreen({ title, subtitle, onBack, busy, children }: PropsWithChildren<{
  title: string; subtitle: string; onBack: () => void; busy: boolean;
}>) {
  return <SafeAreaView style={authStyles.screen}>
    <KeyboardAvoidingView style={authStyles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={authStyles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={authStyles.page}>
          <Pressable accessibilityRole="button" accessibilityLabel="Назад" disabled={busy} onPress={onBack} style={authStyles.back}>
            <StoryIcon name="back" />
          </Pressable>
          <View style={authStyles.brandMark}><StoryIcon name="book" size={30} color={colors.primary} /></View>
          <Text style={authStyles.brand}>МОЯ ИСТОРИЯ</Text>
          <Text style={authStyles.title}>{title}</Text>
          <Text style={authStyles.subtitle}>{subtitle}</Text>
          <View style={authStyles.form}>{children}</View>
          <View style={authStyles.privacyRow}><StoryIcon name="lock" size={13} color={colors.secondary} /><Text style={authStyles.privacy}>Только вы и ваша семья</Text></View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function AuthFeedback({ message, code, success = false }: { message: string; code?: string | null; success?: boolean }) {
  return <View accessibilityLiveRegion="polite" style={[authStyles.feedback, success && authStyles.success]}>
    <Text style={[authStyles.feedbackText, success && authStyles.successText]}>{message}</Text>
    {code ? <Text style={authStyles.errorCode}>Код: {code}</Text> : null}
  </View>;
}

export const authStyles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: 24 },
  page: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 32, lineHeight: 36, color: colors.ink },
  brandMark: { width: 64, height: 64, backgroundColor: colors.primarySoft, borderRadius: 22, marginTop: 28, justifyContent: 'center', alignItems: 'center' },
  brandLetter: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', lineHeight: 44 },
  brand: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 16 },
  title: { color: colors.ink, fontSize: 34, fontWeight: '800', lineHeight: 41, letterSpacing: -1, marginTop: 12 },
  subtitle: { color: colors.secondary, fontSize: 15, lineHeight: 23, marginTop: 10 },
  form: { marginTop: 28 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, minHeight: 56, paddingHorizontal: 16, fontSize: 16, color: colors.ink, marginBottom: 18 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: 16, backgroundColor: colors.surface, marginBottom: 18 },
  passwordInput: { flex: 1, minHeight: 56, paddingLeft: 16, fontSize: 16, color: colors.ink, paddingRight: 8 },
  eyeButton: { minWidth: 76, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingRight: 10 },
  eyeText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  button: { minHeight: 56, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 10 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  forgot: { alignSelf: 'flex-end', paddingHorizontal: 4, marginTop: -8, marginBottom: 4 },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  switchRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 18 },
  switchText: { color: colors.secondary, fontSize: 14 },
  privacyRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 30, marginBottom: 12 },
  privacy: { textAlign: 'center', color: colors.secondary, fontSize: 12, lineHeight: 18 },
  feedback: { borderRadius: 14, backgroundColor: colors.errorSoft, padding: 14, marginBottom: 12 },
  feedbackText: { color: colors.error, fontSize: 13, lineHeight: 20 },
  errorCode: { color: colors.secondary, fontSize: 11, marginTop: 8 },
  success: { backgroundColor: colors.successSoft },
  successText: { color: colors.success },
  hint: { color: colors.secondary, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
});
