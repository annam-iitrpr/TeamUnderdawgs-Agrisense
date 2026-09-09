"use client";

/**
 * Firebase email/password session state.
 *
 * Rules this provider enforces, all from the build spec:
 *  - Passwords go to the Firebase SDK only. They are never sent to an
 *    application endpoint and never written to storage.
 *  - The API client's bearer token comes from `getIdToken()` on demand, so a
 *    refreshed or revoked token is picked up rather than cached indefinitely.
 *  - Role and tenant come from the server's `/me` response, never from a
 *    client-side claim. There is no local role switch that can grant
 *    agronomist access.
 *  - Signing out clears per-user cached state, so the next account cannot read
 *    the previous one's data from memory or localStorage.
 */
import { setTokenProvider } from "@/lib/api/client";
import { authErrorKey, configState, firebaseAuth, type AuthErrorKey } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthStatus = "initialising" | "signed-out" | "signed-in" | "misconfigured";

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  /** Absent required NEXT_PUBLIC_FIREBASE_* variables, when misconfigured. */
  missingConfig: string[];
  usingEmulator: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
};

/** Thrown with a translation key rather than a provider message, so the text
 *  the farmer sees is localised and does not leak provider internals. */
export class AuthError extends Error {
  readonly key: AuthErrorKey;
  constructor(key: AuthErrorKey) {
    super(key);
    this.name = "AuthError";
    this.key = key;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

/** Per-user keys cleared on sign-out and on identity change. The language
 *  preference is deliberately not cleared: it is a device preference, not
 *  private data, and losing it mid-demo is worse than keeping it. */
const PER_USER_STORAGE_PREFIXES = ["agrisense.activeField", "agrisense.draft."];

function clearPerUserState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && PER_USER_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    for (const key of keys) window.localStorage.removeItem(key);
    window.sessionStorage.clear();
  } catch {
    // Nothing to clear if storage is unavailable.
  }

  // Belt and braces. The service worker is written never to cache an
  // authenticated response, but if that ever regresses, sign-out still purges
  // whatever it holds rather than leaving it for the next person on the device.
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "AGRISENSE_PURGE_CACHES" });
  } catch {
    // No worker, or messaging unavailable.
  }
}

function wrap(error: unknown): AuthError {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return new AuthError(authErrorKey(code));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("initialising");
  const [user, setUser] = useState<User | null>(null);
  const [missingConfig, setMissingConfig] = useState<string[]>([]);
  const [usingEmulator, setUsingEmulator] = useState(false);

  useEffect(() => {
    const state = configState();
    if (!state.ok) {
      setMissingConfig(state.missing);
      setStatus("misconfigured");
      return;
    }
    setUsingEmulator(state.usingEmulator);

    const auth = firebaseAuth();
    if (!auth) {
      setStatus("misconfigured");
      return;
    }

    // The API client asks for a token per request. Returning it from the live
    // SDK (rather than a captured string) means a refresh or revocation is
    // reflected immediately.
    setTokenProvider(async () => {
      const current = firebaseAuth()?.currentUser;
      if (!current) return null;
      try {
        return await current.getIdToken();
      } catch {
        return null;
      }
    });

    let previousUid: string | null = null;
    // onIdTokenChanged rather than onAuthStateChanged: it also fires on token
    // refresh and revocation, which is what a long-lived session needs.
    const unsubscribe = onIdTokenChanged(auth, (next) => {
      if (previousUid && next?.uid !== previousUid) clearPerUserState();
      previousUid = next?.uid ?? null;
      setUser(next);
      setStatus(next ? "signed-in" : "signed-out");
    });

    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = firebaseAuth();
    if (!auth) throw new AuthError("errorTitle");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      throw wrap(error);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const auth = firebaseAuth();
    if (!auth) throw new AuthError("errorTitle");
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      // Best effort: a failure to send the verification mail must not undo a
      // successfully created account.
      try {
        await sendEmailVerification(credential.user);
      } catch {
        /* surfaced later by the verification banner's resend action */
      }
    } catch (error) {
      throw wrap(error);
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = firebaseAuth();
    clearPerUserState();
    if (!auth) return;
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      throw wrap(error);
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const auth = firebaseAuth();
    if (!auth) throw new AuthError("errorTitle");
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error) {
      // auth/user-not-found is deliberately swallowed: reporting it would
      // confirm which addresses are registered. The UI shows the same
      // "if an account exists" message either way.
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === "auth/user-not-found") return;
      throw wrap(error);
    }
  }, []);

  const resendVerification = useCallback(async () => {
    const current = firebaseAuth()?.currentUser;
    if (!current) throw new AuthError("errorTitle");
    try {
      await sendEmailVerification(current);
    } catch (error) {
      throw wrap(error);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      missingConfig,
      usingEmulator,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      resendVerification,
    }),
    [
      status,
      user,
      missingConfig,
      usingEmulator,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      resendVerification,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
