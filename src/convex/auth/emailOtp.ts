import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

import {
  authEmailHtml,
  authEmailSubject,
  type AuthEmailKind,
  type AuthEmailLang,
} from "./emailTemplates";

/**
 * Shared transactional-email sender for every auth flow.
 *
 * The API key lives in the Convex environment (`npx convex env set
 * VLY_EMAIL_API_KEY ...`), never in the repository. If it is unset we fail loudly
 * at send time rather than issuing a request with an empty key, which would
 * otherwise surface as an opaque provider error to the user.
 *
 * The payload is deliberately limited to the fields this endpoint accepts.
 * Sending extra fields such as `subject` or `text` makes it reject the whole
 * request, which surfaces to the user as a failed sign-in rather than as a
 * validation error, so the message body is not templated here.
 */
async function sendAuthEmail({
  to,
  code,
  kind = "verify",
}: {
  to: string;
  code?: string;
  /** Which of the two template variants to use when HTML is enabled. */
  kind?: AuthEmailKind;
}): Promise<void> {
  const apiKey = process.env.VLY_EMAIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VLY_EMAIL_API_KEY is not set. Run: npx convex env set VLY_EMAIL_API_KEY <key>",
    );
  }
  const payload: Record<string, string> = {
    to,
    ...(code ? { otp: code } : {}),
    appName: process.env.VLY_APP_NAME || "TajirDz",
  };

  // The endpoint rejects fields it does not know, so the branded HTML body is
  // opt-in: a deployment whose provider accepts `subject`/`html` turns it on
  // with `npx convex env set VLY_EMAIL_HTML 1`, and one that does not keeps
  // sending the three fields that are known to work.
  if (code && process.env.VLY_EMAIL_HTML === "1") {
    const lang: AuthEmailLang = process.env.VLY_EMAIL_LANG === "fr" ? "fr" : "ar";
    payload.subject = authEmailSubject(lang, kind);
    payload.html = authEmailHtml({ lang, kind, code });
  }

  try {
    await axios.post("https://auth.freebuff.app/send_otp", payload, {
      headers: { "x-api-key": apiKey },
    });
  } catch (error) {
    // Keep the HTTP status but never the body or the key: the body can carry
    // provider detail, and this string is surfaced in logs.
    const status =
      axios.isAxiosError(error) ? error.response?.status : undefined;
    throw new Error(`emailSendFailed${status ? ` (${status})` : ""}`);
  }
}

/** Expiry of a 6-digit verification or reset code. */
export const CODE_TTL_SECONDS = 60 * 10;

function sixDigitCode(): string {
  const random: RandomReader = {
    read(bytes: Uint8Array) {
      crypto.getRandomValues(bytes);
    },
  };
  return generateRandomString(random, "0123456789", 6);
}

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return sixDigitCode();
  },
  async sendVerificationRequest({ identifier, token }) {
    await sendAuthEmail({ to: identifier, code: token });
  },
});

/**
 * Build an Auth.js email config for the password flows.
 *
 * The Password provider consumes a full `EmailConfig`, so it needs the
 * `from`/`maxAge` defaults Auth.js reads at startup — without them it throws
 * while materialising providers.
 */
function authEmail(id: string, maxAgeSeconds: number, kind: AuthEmailKind): EmailConfig {
  return {
    id,
    type: "email",
    name: id,
    from: "TajirDz <no-reply@tajirdz.app>",
    // Without this the Password provider falls back to Convex Auth's default
    // token, a 30-character random string, while every screen in front of it
    // asks for six digits — so no code a person can type would ever match.
    generateVerificationToken: async () => sixDigitCode(),
    // The code is a single-use, 6-digit secret; a long window only widens the
    // brute-force surface. Ten minutes is long enough to find a mail and short
    // enough that a leaked inbox is not a lasting problem. The server-side
    // attempt limit (lib/authGuard) is the real stop; this is the outer bound.
    maxAge: maxAgeSeconds,
    async sendVerificationRequest({ identifier, token }) {
      await sendAuthEmail({ to: identifier, code: token, kind });
    },
  };
}

/**
 * Mailer for the password flows: new-account verification, password reset and
 * email-change confirmation. All three share one sender, so rotating the key
 * covers every flow.
 */
export const verifyEmailConfig = authEmail("verify-email", CODE_TTL_SECONDS, "verify");

export const resetEmailConfig = authEmail("reset-email", CODE_TTL_SECONDS, "reset");

/** Confirms a change of the account's email address. */
export async function sendEmailChangeCode(
  to: string,
  code: string,
): Promise<void> {
  await sendAuthEmail({ to, code });
}
