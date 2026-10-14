import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearCapsuleBiometryUser } from './capsule-biometry';

export type FamilyChoice = {
  id: string;
  name: string;
  role: string;
};

export type ChildSummary = {
  id: string;
  name: string;
  birth_date: string;
  photo: string | null;
};

export type FamilyState =
  | { status: 'idle' | 'loading' }
  | { status: 'none' }
  | { status: 'multiple'; choices: FamilyChoice[] }
  | {
      status: 'ready';
      family: FamilyChoice;
      choices: FamilyChoice[];
      children: ChildSummary[];
    }
  | { status: 'error'; message: string };

type AuthContextValue = {
  session: Session | null;
  isInitializing: boolean;
  authError: string | null;
  isPasswordRecovery: boolean;
  family: FamilyState;
  refreshFamily: () => Promise<void>;
  selectFamily: (familyId: string) => Promise<void>;
  signOut: () => Promise<string | null>;
  retrySession: () => Promise<void>;
  beginPasswordRecovery: () => void;
  finishPasswordRecovery: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function familyErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';

  if (code === '42501' || /permission denied/i.test(message)) {
    return 'Приложению пока не разрешено читать семейные данные. Нужно проверить доступы проекта.';
  }

  return 'Не удалось загрузить семейную историю. Проверьте подключение и попробуйте ещё раз.';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [family, setFamily] = useState<FamilyState>({ status: 'idle' });
  const currentUserId = useRef<string | null>(null);
  const familyRequestId = useRef(0);
  const sessionRevision = useRef(0);
  const providerMounted = useRef(true);
  const signOutRequest = useRef<{ userId: string; promise: Promise<string | null> } | null>(null);

  const isFamilyRequestCurrent = useCallback((requestId: number, userId: string) => {
    return providerMounted.current && requestId === familyRequestId.current
      && userId === currentUserId.current;
  }, []);

  const acceptSession = useCallback((nextSession: Session | null) => {
    if (!providerMounted.current) return;
    sessionRevision.current += 1;
    const nextUserId = nextSession?.user.id ?? null;

    if (currentUserId.current !== nextUserId) {
      const previousUserId = currentUserId.current;
      if (previousUserId) void clearCapsuleBiometryUser(previousUserId).catch(() => {});
      currentUserId.current = nextUserId;
      familyRequestId.current += 1;
      setFamily({ status: nextUserId ? 'loading' : 'idle' });
    }

    setSession(nextSession);
    setAuthError(null);
    if (!nextSession) {
      setIsPasswordRecovery(false);
    }
    setIsInitializing(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    providerMounted.current = true;
    let authEventCount = 0;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      authEventCount += 1;
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      acceptSession(nextSession);
    });

    const initialEventCount = authEventCount;
    const initialRevision = sessionRevision.current;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || authEventCount !== initialEventCount || sessionRevision.current !== initialRevision) {
          return;
        }

        if (error) {
          setAuthError('Не удалось восстановить вход. Попробуйте ещё раз.');
          setIsInitializing(false);
          return;
        }

        acceptSession(data.session);
      })
      .catch((error: unknown) => {
        if (!mounted || authEventCount !== initialEventCount || sessionRevision.current !== initialRevision) {
          return;
        }

        setAuthError('Не удалось восстановить вход. Попробуйте ещё раз.');
        setIsInitializing(false);
      });

    return () => {
      mounted = false;
      providerMounted.current = false;
      familyRequestId.current += 1;
      subscription.unsubscribe();
    };
  }, [acceptSession]);

  const loadSelectedFamily = useCallback(
    async (
      choice: FamilyChoice,
      choices: FamilyChoice[],
      requestId: number,
      userId: string,
    ) => {
      if (!isFamilyRequestCurrent(requestId, userId)) return;
      const { data: children, error } = await supabase
        .from('children')
        .select('id, name, birth_date, photo')
        .eq('family_id', choice.id)
        .order('birth_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (!isFamilyRequestCurrent(requestId, userId)) return;
      if (error) {
        throw error;
      }

      if (isFamilyRequestCurrent(requestId, userId)) {
        setFamily({
          status: 'ready',
          family: choice,
          choices,
          children: children ?? [],
        });
      }
    },
    [isFamilyRequestCurrent],
  );

  const refreshFamily = useCallback(async () => {
    const userId = session?.user.id ?? null;
    // An old screen/effect can invoke a retained callback after an auth event,
    // before React has rendered the new account. Do not advance its request ID.
    if (!providerMounted.current || userId !== currentUserId.current) return;
    if (!userId) {
      setFamily({ status: 'idle' });
      return;
    }

    const requestId = ++familyRequestId.current;
    setFamily({ status: 'loading' });

    try {
      const { data: memberships, error: membershipError } = await supabase
        .from('family_members')
        .select('family_id, role, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (!isFamilyRequestCurrent(requestId, userId)) return;
      if (membershipError) {
        throw membershipError;
      }

      const membershipByFamily = new Map<string, string>();
      for (const membership of memberships ?? []) {
        if (!membershipByFamily.has(membership.family_id)) {
          membershipByFamily.set(membership.family_id, membership.role);
        }
      }

      const familyIds = [...membershipByFamily.keys()];
      if (familyIds.length === 0) {
        if (isFamilyRequestCurrent(requestId, userId)) {
          setFamily({ status: 'none' });
        }
        return;
      }

      const { data: families, error: familiesError } = await supabase
        .from('families')
        .select('id, name')
        .in('id', familyIds);

      if (!isFamilyRequestCurrent(requestId, userId)) return;
      if (familiesError) {
        throw familiesError;
      }

      const familyById = new Map(
        (families ?? []).map((item) => [item.id, item.name]),
      );
      const choices: FamilyChoice[] = familyIds.map((id) => {
        const name = familyById.get(id);
        if (!name) {
          throw new Error('A family membership has no readable family row.');
        }

        return {
          id,
          name,
          role: membershipByFamily.get(id) ?? 'member',
        };
      });

      if (!isFamilyRequestCurrent(requestId, userId)) {
        return;
      }

      if (choices.length > 1) {
        setFamily({ status: 'multiple', choices });
        return;
      }

      await loadSelectedFamily(choices[0], choices, requestId, userId);
    } catch (error) {
      if (isFamilyRequestCurrent(requestId, userId)) {
        setFamily({ status: 'error', message: familyErrorMessage(error) });
      }
    }
  }, [isFamilyRequestCurrent, loadSelectedFamily, session?.user.id]);

  const selectFamily = useCallback(
    async (familyId: string) => {
      const userId = session?.user.id;
      if (!providerMounted.current || !userId || userId !== currentUserId.current || family.status !== 'multiple') {
        return;
      }

      const choice = family.choices.find((item) => item.id === familyId);
      if (!choice) {
        return;
      }

      const requestId = ++familyRequestId.current;
      setFamily({ status: 'loading' });

      try {
        await loadSelectedFamily(choice, family.choices, requestId, userId);
      } catch (error) {
        if (isFamilyRequestCurrent(requestId, userId)) {
          setFamily({ status: 'error', message: familyErrorMessage(error) });
        }
      }
    },
    [family, isFamilyRequestCurrent, loadSelectedFamily, session?.user.id],
  );

  useEffect(() => {
    void refreshFamily();
  }, [refreshFamily]);

  const signOut = useCallback(async () => {
    const userId = session?.user.id ?? null;
    if (!providerMounted.current || userId !== currentUserId.current) {
      return 'Вход изменился. Повторите действие на текущем экране.';
    }
    if (!userId) return null;
    if (signOutRequest.current?.userId === userId) return signOutRequest.current.promise;

    const promise = (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!providerMounted.current || currentUserId.current !== userId) {
          return 'Вход изменился. Повторите действие на текущем экране.';
        }
        if (sessionError) return 'Не удалось проверить вход. Попробуйте ещё раз.';
        if (data.session?.user.id !== userId) return 'Вход изменился. Повторите действие на текущем экране.';
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        return error ? 'Не удалось выйти из аккаунта. Попробуйте ещё раз.' : null;
      } catch {
        return 'Не удалось выйти из аккаунта. Попробуйте ещё раз.';
      }
    })();
    signOutRequest.current = { userId, promise };
    try {
      return await promise;
    } finally {
      if (signOutRequest.current?.promise === promise) signOutRequest.current = null;
    }
  }, [session?.user.id]);

  const beginPasswordRecovery = useCallback(() => {
    if (!providerMounted.current) return;
    setIsPasswordRecovery(true);
  }, []);

  const finishPasswordRecovery = useCallback(() => {
    if (!providerMounted.current) return;
    setIsPasswordRecovery(false);
  }, []);

  const retrySession = useCallback(async () => {
    if (!providerMounted.current) return;
    // Starting a newer retry invalidates both previous retries and initial restore.
    const revision = ++sessionRevision.current;
    setIsInitializing(true);
    setAuthError(null);

    try {
      const { data, error } = await supabase.auth.getSession();
      if (!providerMounted.current || revision !== sessionRevision.current) return;
      if (error) {
        throw error;
      }

      acceptSession(data.session);
    } catch {
      if (!providerMounted.current || revision !== sessionRevision.current) return;
      setAuthError('Не удалось восстановить вход. Попробуйте ещё раз.');
      setIsInitializing(false);
    }
  }, [acceptSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isInitializing,
      authError,
      isPasswordRecovery,
      family,
      refreshFamily,
      selectFamily,
      signOut,
      retrySession,
      beginPasswordRecovery,
      finishPasswordRecovery,
    }),
    [
      session,
      isInitializing,
      authError,
      isPasswordRecovery,
      family,
      refreshFamily,
      selectFamily,
      signOut,
      retrySession,
      beginPasswordRecovery,
      finishPasswordRecovery,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return context;
}
