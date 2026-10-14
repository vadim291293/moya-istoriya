import type { SupabaseClient } from '@supabase/supabase-js';

type EmailLinkType = 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change' | 'email';
type AuthCallback =
  | { kind: 'code'; code: string; flowId?: string; recovery: boolean }
  | { kind: 'tokens'; accessToken: string; refreshToken: string; recovery: boolean }
  | { kind: 'hash'; tokenHash: string; type: EmailLinkType; recovery: boolean }
  | { kind: 'otp'; token: string; email: string; type: EmailLinkType; recovery: boolean };

export class InvalidAuthLinkError extends Error {
  constructor() { super('Invalid or expired authentication link'); }
}

export function readAuthCallback(value: string): AuthCallback {
  let url: URL;
  try { url = new URL(value); } catch { throw new InvalidAuthLinkError(); }
  const params = new URLSearchParams(url.search);
  for (const [key, item] of new URLSearchParams(url.hash.replace(/^#\??/, ''))) {
    params.set(key, item);
  }
  if (params.has('error') || params.has('error_description') || params.has('error_code')) {
    throw new InvalidAuthLinkError();
  }
  const type = params.get('type');
  const recovery = type === 'recovery';
  const code = params.get('code');
  if (code) {
    // Native apps cannot read window.location for the SDK's PKCE verifier slot.
    // Preserve even an invalid/empty explicit ID: reject it instead of falling back.
    return { kind: 'code', code, recovery,
      ...(params.has('sb_flow_id') ? { flowId: params.get('sb_flow_id') ?? '' } : {}) };
  }
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken, recovery };
  if (!type || !['signup', 'recovery', 'invite', 'magiclink', 'email_change', 'email'].includes(type)) {
    throw new InvalidAuthLinkError();
  }
  const emailType = type as EmailLinkType;
  const tokenHash = params.get('token_hash');
  if (tokenHash) return { kind: 'hash', tokenHash, type: emailType, recovery };
  const token = params.get('token');
  const email = params.get('email');
  if (token && email) return { kind: 'otp', token, email, type: emailType, recovery };
  throw new InvalidAuthLinkError();
}

export async function redeemAuthCallback(auth: SupabaseClient['auth'], link: AuthCallback) {
  let recovery = link.recovery;
  let listening = true;
  const { data: { subscription } } = auth.onAuthStateChange((event) => {
    // PKCE recovery may have no type parameter. Use SDK verifier metadata/event.
    if (listening && event === 'PASSWORD_RECOVERY') recovery = true;
  });
  try {
    const result = link.kind === 'code'
      ? await auth.exchangeCodeForSession(link.code, link.flowId !== undefined ? { flowId: link.flowId } : undefined)
      : link.kind === 'tokens'
        ? await auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        : link.kind === 'hash'
          ? await auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
          : await auth.verifyOtp({ token: link.token, email: link.email, type: link.type });
    if (result.error) throw result.error;
    const userId = result.data.session?.user.id;
    if (!userId || (result.data.user && result.data.user.id !== userId)) throw new InvalidAuthLinkError();
    return { userId, recovery };
  } finally {
    listening = false;
    subscription.unsubscribe();
  }
}

// Auth mutations cannot be cancelled once sent. New links wait for earlier
// exchanges/password actions, then supersede their UI results instead of racing.
export function createAuthTaskQueue() {
  let tail = Promise.resolve();
  return (task: () => Promise<void>) => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}
