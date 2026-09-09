/**
 * English is the source of truth for the key set. Every other language is a
 * Partial of this shape, so a missing key falls back to English rather than
 * rendering a blank label, and the gap is reported by the completeness test.
 *
 * Keys are grouped by the feature area that owns them. Add keys in the slice
 * that needs them rather than pre-declaring an unused vocabulary.
 */
export const en = {
  /* ── identity ─────────────────────────────────────────────────────────── */
  appName: "AgriSense",
  tagline: "Know the right morning to spray",
  languageName: "English",

  /* ── shared actions ───────────────────────────────────────────────────── */
  back: "Back",
  next: "Next",
  cancel: "Cancel",
  confirm: "Confirm",
  save: "Save",
  edit: "Edit",
  retry: "Try again",
  close: "Close",
  skip: "Skip for now",
  done: "Done",
  changeLanguage: "Language",

  /* ── shared states ────────────────────────────────────────────────────── */
  loading: "Loading",
  errorTitle: "Something went wrong",
  errorOffline: "You appear to be offline. Check your connection and try again.",
  errorUnreachable:
    "We cannot reach AgriSense right now. Please try again in a moment.",
  unknownValue: "Not known",
  notApplicable: "Not applicable",
  estimateLabel: "Model estimate",

  /* ── data honesty labels ──────────────────────────────────────────────── */
  dataLive: "Live data",
  dataEstimated: "Estimated data",
  dataDemo: "Demo data",
  dataMixed: "Mixed data",
  dataUnavailable: "Data unavailable",
  whereDataComes: "Where this data comes from",
  updatedAt: "Updated",

  /* ── primary navigation ───────────────────────────────────────────────── */
  navHome: "Home",
  navPlan: "Plan",
  navJournal: "Journal",
  navAsk: "Ask",
  navNotifications: "Notifications",
  navAccount: "Account",

  /* ── P1-01 authentication ─────────────────────────────────────────────── */
  signInTitle: "Sign in to AgriSense",
  signInSubtitle: "Use the email address and password you registered with.",
  signUpTitle: "Create your AgriSense account",
  signUpSubtitle: "You need an email address and a password.",
  emailLabel: "Email address",
  passwordLabel: "Password",
  passwordShow: "Show password",
  passwordHide: "Hide password",
  passwordMinHint: "At least 8 characters.",
  signInAction: "Sign in",
  signUpAction: "Create account",
  signOutAction: "Sign out",
  signInBusy: "Signing in",
  signUpBusy: "Creating your account",
  noAccountPrompt: "Do not have an account?",
  hasAccountPrompt: "Already have an account?",
  forgotPassword: "Forgot your password?",
  resetTitle: "Reset your password",
  resetSubtitle:
    "Enter your email address and we will send you a link to set a new password.",
  resetAction: "Send reset link",
  resetSent:
    "If an account exists for that address, a reset link is on its way. Check your inbox.",
  verifyEmailTitle: "Confirm your email address",
  verifyEmailBody:
    "We sent a confirmation link to your email. Open it to finish setting up your account.",
  verifyEmailResend: "Send it again",
  sessionExpiredTitle: "Please sign in again",
  sessionExpiredBody: "You were signed out to keep your account safe.",

  /* Auth errors. Deliberately do not reveal whether an address is registered. */
  authInvalidEmail: "That does not look like an email address.",
  authInvalidCredentials: "That email address and password do not match.",
  authWeakPassword: "Choose a password of at least 8 characters.",
  authEmailInUse: "That email address cannot be used. Try signing in instead.",
  authTooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
  authRequiredEmail: "Enter your email address.",
  authRequiredPassword: "Enter your password.",
} as const;

export type Dict = Record<keyof typeof en, string>;
export type TranslationKey = keyof typeof en;
