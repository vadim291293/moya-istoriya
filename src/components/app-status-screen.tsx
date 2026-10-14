import { colors } from '../lib/theme';
import { StoryIcon } from './story-ui';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type AppStatusScreenProps = {
  title: string;
  message?: string;
  loading?: boolean;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
};

export function AppStatusScreen({
  title,
  message,
  loading = false,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
}: AppStatusScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.mark}><StoryIcon name="book" color={colors.primary} size={32} /></View>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {loading ? (
          <ActivityIndicator
            accessibilityLabel="Загрузка"
            color={colors.primary}
            size="large"
            style={styles.indicator}
          />
        ) : null}

        {primaryLabel && onPrimaryPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onPrimaryPress}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </Pressable>
        ) : null}

        {secondaryLabel && onSecondaryPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSecondaryPress}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>{secondaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  mark: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  heart: {
    color: '#D4777F',
    fontSize: 42,
    marginBottom: 12,
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: colors.secondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 360,
    textAlign: 'center',
  },
  indicator: {
    marginTop: 24,
  },
  primaryButton: {
    minHeight: 52,
    minWidth: 220,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    marginTop: 24,
    paddingHorizontal: 24,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
});
