import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';
import { StoryIcon } from './story-ui';

export function FamilyFormScreen({ title, onBack, children, scroll = true }: PropsWithChildren<{ title: string; onBack: () => void; scroll?: boolean }>) {
  return <SafeAreaView style={familyFormStyles.safe}>
    <View style={familyFormStyles.header}><Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={onBack} style={familyFormStyles.back}><StoryIcon name="back" /></Pressable><Text accessibilityRole="header" style={familyFormStyles.title}>{title}</Text></View>
    {scroll ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={familyFormStyles.content}>{children}</ScrollView>
      : <View style={{ flex: 1 }}>{children}</View>}
  </SafeAreaView>;
}
export function FormButton({ label, onPress, disabled = false, danger = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    style={({ pressed }) => [familyFormStyles.button, primary && familyFormStyles.primaryButton, danger && familyFormStyles.dangerButton, (pressed || disabled) && { opacity: 0.5 }]} onPress={onPress}>
    <Text style={[familyFormStyles.buttonText, primary && { color: colors.onPrimary }, danger && { color: colors.error }]}>{label}</Text>
  </Pressable>;
}
export const familyFormStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
  back: { width: 44, height: 44, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 21, fontWeight: '700', color: colors.ink },
  content: { padding: 20, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40 },
  label: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  input: { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, minHeight: 56, padding: 16, fontSize: 16 },
  hint: { color: colors.secondary, fontSize: 14, lineHeight: 21 },
  error: { color: colors.error, fontSize: 14, lineHeight: 21 },
  card: { padding: 18, gap: 10, backgroundColor: colors.surface, borderRadius: 24 },
  button: { minHeight: 52, padding: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderRadius: 20 },
  primaryButton: { backgroundColor: colors.primary },
  dangerButton: { backgroundColor: colors.errorSoft },
  buttonText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
