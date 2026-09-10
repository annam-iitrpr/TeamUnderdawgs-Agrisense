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
  signInSubtitle: "Use your phone number to receive a one-time code by SMS.",
  signUpTitle: "Create your AgriSense account",
  signUpSubtitle: "Create your account with a phone number and a one-time code.",
  phoneAuthTitle: "Continue with your phone",
  phoneAuthSubtitle: "Enter your mobile number to continue.",
  phoneCodeSubtitle: "Enter the six-digit code sent to your phone.",
  phoneLabel: "Phone number",
  phoneHint: "Use international format, for example +91 98765 43210.",
  phoneCodeLabel: "Verification code",
  sendCodeAction: "Send code",
  sendCodeBusy: "Sending code",
  verifyCodeAction: "Verify and continue",
  verifyCodeBusy: "Verifying code",
  changePhone: "Use a different phone number",
  signInAction: "Sign in",
  signUpAction: "Create account",
  signOutAction: "Sign out",
  signInBusy: "Signing in",
  signUpBusy: "Creating your account",
  noAccountPrompt: "Do not have an account?",
  hasAccountPrompt: "Already have an account?",
  sessionExpiredTitle: "Please sign in again",
  sessionExpiredBody: "You were signed out to keep your account safe.",

  // Retained for old saved translations during the migration; no current
  // screen links to password reset or email verification.
  emailLabel: "Email address",
  phonePasswordSubtitle: "Use your mobile number and a password.",
  phonePasswordNotice: "Signing in as {phone}. No code is sent to this number.",
  passwordCreateHint: "At least 8 characters.",
  authPhoneInUse: "That number already has an account. Try signing in instead.",
  passwordLabel: "Password",
  passwordShow: "Show password",
  passwordHide: "Hide password",
  passwordMinHint: "At least 8 characters.",
  forgotPassword: "Forgot password?",
  resetTitle: "Reset your password",
  resetSubtitle: "Enter your email address and we will send a reset link.",
  resetAction: "Send reset link",
  resetSent: "If an account exists for that address, a reset link has been sent.",
  verifyEmailTitle: "Verify your email address",
  verifyEmailBody: "We sent a link to your email. Open it to finish your account.",
  verifyEmailResend: "Send again",

  /* Auth errors. Deliberately do not reveal whether an address is registered. */
  authInvalidPhone: "Enter a valid phone number with its country code.",
  authInvalidCode: "Enter the six-digit verification code.",
  authCodeExpired: "That code has expired. Request a new one.",
  authTooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
  authInvalidEmail: "That does not look like an email address.",
  authInvalidCredentials: "Those credentials do not match.",
  authWeakPassword: "Choose a password with at least 8 characters.",
  authEmailInUse: "That email address cannot be used. Try signing in.",
  authRequiredEmail: "Enter your email address.",
  authRequiredPassword: "Enter your password.",

  /* Choosing a sign-in method, and the phone failures that need naming. */
  signInWithPhone: "Phone",
  signInWithEmail: "Email",
  authCaptchaFailed: "We could not confirm this device. Reload the page and try again.",
  authPhoneNotAllowed: "Signing in by phone is not switched on for this app.",
  authQuotaExceeded: "Too many codes have been sent today. Try again tomorrow, or use email.",
} as const;

export type Dict = Record<keyof typeof en, string>;
export type TranslationKey = keyof typeof en;
