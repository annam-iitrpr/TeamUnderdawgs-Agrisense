/**
 * Firebase client initialisation.
 *
 * Initialised lazily inside a function, never at module scope: this file is
 * imported by components that Next.js renders on the server, where `window`
 * does not exist and the SDK must not be constructed.
 *
 * Everything here is public browser configuration. No private credential
 * belongs in a NEXT_PUBLIC_* variable — those are inlined into the client
 * bundle at build time and are readable by anyone.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  type Auth,
} from "firebase/auth";

export type FirebaseConfigState =
  | { ok: true; usingEmulator: boolean }
  | { ok: false; missing: string[] };

function readConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}

const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"] as const;

/** Which required values are absent. Surfaced in the UI as a setup problem
 *  rather than crashing with an opaque SDK error. */
export function configState(): FirebaseConfigState {
  const config = readConfig();
  const missing = REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return typeof value !== "string" || value.trim() === "";
  }).map((key) => `NEXT_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, usingEmulator: emulatorUrl() !== null };
}

function emulatorUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  return url && url.trim() !== "" ? url : null;
}

let cachedAuth: Auth | null = null;

function firebaseApp(): FirebaseApp {
  const config = readConfig();
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: config.apiKey ?? "",
    authDomain: config.authDomain ?? "",
    projectId: config.projectId ?? "",
    appId: config.appId ?? "",
    messagingSenderId: config.messagingSenderId ?? "",
  });
}

/**
 * The Auth instance, or null when running on the server or when required
 * configuration is absent.
 *
 * The emulator connection is attached once, immediately after construction, as
 * the SDK requires. It is driven purely by an explicit local variable, so a
 * deployed build with that variable unset can never talk to an emulator.
 */
export function firebaseAuth(): Auth | null {
  if (typeof window === "undefined") return null;
  if (cachedAuth) return cachedAuth;
  if (!configState().ok) return null;

  const auth = getAuth(firebaseApp());
  const emulator = emulatorUrl();
  if (emulator) {
    connectAuthEmulator(auth, emulator, { disableWarnings: true });
  }
  cachedAuth = auth;
  return auth;
}

/** Test seam: clears the memoised instance between test cases. */
export function resetFirebaseAuthForTests(): void {
  cachedAuth = null;
}

/**
 * Maps a Firebase error code onto one of our own translation keys.
 *
 * Phone verification failures are reduced to stable translation keys so the UI
 * never exposes provider internals or raw Firebase messages.
 */
export type AuthErrorKey =
  | "authInvalidPhone"
  | "authInvalidCode"
  | "authTooManyAttempts"
  | "authCodeExpired"
  | "authCaptchaFailed"
  | "authPhoneNotAllowed"
  | "authQuotaExceeded"
  | "authInvalidEmail"
  | "authInvalidCredentials"
  | "authWeakPassword"
  | "authEmailInUse"
  | "errorUnreachable"
  | "errorTitle";

export function authErrorKey(code: unknown): AuthErrorKey {
  const value = typeof code === "string" ? code : "";
  switch (value) {
    /* Phone. Each code gets its own message because each has a different
       remedy; "something went wrong" when the real problem is a missing
       country code wastes the one thing the person can fix. */
    case "auth/invalid-phone-number":
    case "auth/missing-phone-number":
      return "authInvalidPhone";
    case "auth/invalid-verification-code":
    case "auth/missing-verification-code":
      return "authInvalidCode";
    case "auth/code-expired":
    case "auth/session-expired":
      return "authCodeExpired";
    /* `invalid-app-credential` is what the SDK returns when the page's domain
       is not in Firebase's authorized-domains list. It reads like a captcha
       problem and is not one — it is a configuration fault nobody on a handset
       can fix, and it was the actual cause of phone sign-in failing here. It is
       grouped with the captcha codes only because the user-facing remedy,
       reloading, is the same. */
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
    case "auth/missing-app-credential":
      return "authCaptchaFailed";
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return "authPhoneNotAllowed";
    case "auth/quota-exceeded":
      return "authQuotaExceeded";

    /* Email and password. `user-not-found` and `wrong-password` deliberately
       collapse into one message: distinguishing them confirms which addresses
       are registered, which is an account enumeration leak. */
    case "auth/invalid-email":
      return "authInvalidEmail";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "authInvalidCredentials";
    case "auth/weak-password":
      return "authWeakPassword";
    case "auth/email-already-in-use":
      return "authEmailInUse";

    case "auth/too-many-requests":
      return "authTooManyAttempts";
    case "auth/network-request-failed":
      return "errorUnreachable";
    default:
      return "errorTitle";
  }
}
