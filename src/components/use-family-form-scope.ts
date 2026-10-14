import { useEffect, useRef } from 'react';
import { useIsFocused } from 'expo-router';
import { useAuth } from '../lib/auth-context';

export function useFamilyFormScope() {
  const auth = useAuth();
  const focused = useIsFocused();
  const mounted = useRef(true);
  const current = `${auth.session?.user.id}:${auth.family.status === 'ready' ? auth.family.family.id : ''}`;
  const initial = useRef(current);
  const valid = useRef(false);
  valid.current = initial.current === current && !auth.isPasswordRecovery && auth.family.status === 'ready' && Boolean(auth.session);
  const focus = useRef(focused); focus.current = focused;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return { auth, live: () => mounted.current && valid.current && focus.current, valid: valid.current, focused };
}
