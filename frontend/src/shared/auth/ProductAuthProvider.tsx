import {
  ClerkProvider,
  SignInButton,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  authenticatedFetch,
  prepareAccountStorage,
  resetAuthTokenProvider,
  setAuthTokenProvider,
} from './sessionClient';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';
const AUTH_MODE = import.meta.env.PUBLIC_AUTH_MODE?.trim() || 'fake';
const CLERK_PUBLISHABLE_KEY = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

type ProductSession = {
  label: string;
  mode: 'fake' | 'clerk';
  sessionKey: string;
  signOut?: () => Promise<void>;
};

const SessionContext = createContext<ProductSession>({
  label: 'Sesión local',
  mode: 'fake',
  sessionKey: 'user_development',
});

export function ProductAuthProvider({ children }: { children: ReactNode }) {
  if (AUTH_MODE !== 'clerk') {
    return (
      <SessionContext.Provider
        value={{ label: 'Sesión local', mode: 'fake', sessionKey: 'user_development' }}
      >
        {children}
      </SessionContext.Provider>
    );
  }
  if (!CLERK_PUBLISHABLE_KEY) {
    return <AuthConfigurationError />;
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ClerkSession>{children}</ClerkSession>
    </ClerkProvider>
  );
}

export function useProductSession(): ProductSession {
  return useContext(SessionContext);
}

function ClerkSession({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [preparedUserId, setPreparedUserId] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      setAuthTokenProvider(async () => null);
      return resetAuthTokenProvider;
    }
    setAuthTokenProvider(() => getToken());
    return resetAuthTokenProvider;
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (!user?.id) return;
    prepareAccountStorage(user.id);
    setPreparedUserId(user.id);
  }, [user?.id]);

  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn) return <SignInGate />;
  const sessionKey = user?.id;
  if (!sessionKey) return <AuthLoading />;
  if (preparedUserId !== sessionKey) return <AuthLoading />;

  const label = user?.primaryEmailAddress?.emailAddress ?? user?.firstName ?? 'Tu cuenta';
  const closeSession = async () => {
    setIsSigningOut(true);
    try {
      await authenticatedFetch(fetch, `${API_BASE_URL.replace(/\/$/, '')}/api/session/logout`, {
        method: 'POST',
      });
      await signOut({ redirectUrl: '/' });
    } catch (error) {
      setIsSigningOut(false);
      throw error;
    }
  };

  if (isSigningOut) return <AuthLoading />;

  return (
    <SessionContext.Provider
      value={{ label, mode: 'clerk', sessionKey, signOut: closeSession }}
    >
      {children}
    </SessionContext.Provider>
  );
}

function SignInGate() {
  return (
    <main className="auth-gate">
      <span aria-hidden="true" className="auth-gate-mark">IA</span>
      <p className="auth-gate-kicker">Inglés al Grano</p>
      <h1>Tu práctica continúa aquí.</h1>
      <p>Inicia sesión para guardar tus preferencias y mantener cada práctica separada.</p>
      <SignInButton mode="modal">
        <button className="primary-action" type="button">Iniciar sesión</button>
      </SignInButton>
    </main>
  );
}

function AuthLoading() {
  return <main aria-live="polite" className="auth-gate">Preparando tu sesión…</main>;
}

function AuthConfigurationError() {
  return (
    <main className="auth-gate" role="alert">
      <h1>Falta configurar el acceso.</h1>
      <p>Añade la clave pública de Clerk para activar el inicio de sesión.</p>
    </main>
  );
}
