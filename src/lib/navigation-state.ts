type NavigationInput = {
  isPasswordRecovery: boolean;
  isInitializing: boolean;
  authError: string | null;
  session: unknown | null;
  family: { status: string };
};

export function navigationStage(auth: NavigationInput) {
  if (auth.isPasswordRecovery) return 'recovery';
  if (auth.isInitializing || auth.authError) return 'status';
  if (!auth.session) return 'guest';
  if (auth.family.status === 'none') return 'setup';
  if (auth.family.status === 'ready') return 'family';
  if (auth.family.status === 'multiple') return 'picker';
  return 'status';
}
