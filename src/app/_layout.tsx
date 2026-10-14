import { Stack } from 'expo-router';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { navigationStage } from '../lib/navigation-state';
import { colors } from '../lib/theme';

function AppNavigator() {
  // A stable navigator keeps the email callback mounted during session updates.
  const stage = navigationStage(useAuth());

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={stage === 'status'}>
        <Stack.Screen name="session-status" />
      </Stack.Protected>
      <Stack.Protected guard={stage === 'guest'}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack.Protected>

      <Stack.Protected guard={stage === 'setup'}>
        <Stack.Screen name="setup" />
      </Stack.Protected>

      <Stack.Protected guard={stage === 'family'}>
        <Stack.Screen name="home" />
        <Stack.Screen name="child/new" />
        <Stack.Screen name="child/[id]" />
        <Stack.Screen name="memory/new" />
        <Stack.Screen name="memory/[id]" />
        <Stack.Screen name="family/members" />
        <Stack.Screen name="family/trash" />
        <Stack.Screen name="family/capsules" />
      </Stack.Protected>

      <Stack.Protected guard={stage === 'picker'}>
        <Stack.Screen name="family-picker" />
      </Stack.Protected>

      <Stack.Screen name="auth/reset-password" />
      <Stack.Screen name="family/join" />

      <Stack.Protected guard={false}>
        <Stack.Screen name="explore" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
