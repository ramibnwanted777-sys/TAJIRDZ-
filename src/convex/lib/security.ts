/**
 * Security configuration and shared validation helpers.
 *
 * Kept in one place so the rate-limit table, the admin allowlist and the
 * password policy cannot drift apart between the functions that use them.
 */

/**
 * Admin bootstrap allowlist.
 *
 * Read from the `ADMIN_EMAILS` Convex env var (comma-separated). Any user
 * whose email matches gets `role: "admin"` the first time they sign in, which
 * removes the need for a seeded placeholder account that could never receive a
 * code. Comma- and whitespace-separated, case-insensitive.
 *
 * Promote by running:  npx convex env set ADMIN_EMAILS you@example.com
 */
export const DEFAULT_ADMIN_EMAILS = [
  "ramibnwantedd777@gmail.com",
  "ramibnwanted777@gmail.com",
];

export function adminEmails(raw: string | undefined = process.env.ADMIN_EMAILS): Set<string> {
  const envList = (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ADMIN_EMAILS, ...envList]);
}

/** Is this email allowed to self-promote to admin on sign-in? */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

/** Emails are compared case-insensitively and without surrounding space. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Generic failures, so sign-in never reveals whether an account exists. */
export const GENERIC_CREDENTIALS_ERROR = "errInvalidCredentials";

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Password policy: length plus a character-class requirement. Deliberately
 * generous on composition and strict on length, which matches what people
 * actually manage on a phone.
 */
export function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("errPasswordTooShort");
  }
  if (password.length > 200) throw new Error("errPasswordTooLong");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("errPasswordTooWeak");
  }
}

export type PasswordStrength = {
  /** 0-4, drives the meter. */
  score: number;
  label: "veryWeak" | "weak" | "fair" | "good" | "strong";
  /** Keys resolved against the i18n dictionary. */
  problems: string[];
};

/**
 * Pure strength estimate for the sign-up meter. Advisory only — the server
 * re-runs `validatePassword`, so a weak password can never reach the database.
 */
export function passwordStrength(password: string): PasswordStrength {
  const problems: string[] = [];
  if (!password) {
    return { score: 0, label: "veryWeak", problems: [] };
  }
  if (password.length < MIN_PASSWORD_LENGTH) problems.push("errPasswordTooShort");
  if (!/[a-z]/.test(password)) problems.push("errNeedsLowercase");
  if (!/[A-Z]/.test(password)) problems.push("errNeedsUppercase");
  if (!/[0-9]/.test(password)) problems.push("errNeedsDigit");

  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  const classes =
    [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password))
      .length;
  if (classes >= 3) score += 1;
  if (classes >= 4 && password.length >= 12) score += 1;

  const labels = ["veryWeak", "weak", "fair", "good", "strong"] as const;
  return { score, label: labels[Math.min(score, 4)], problems };
}
