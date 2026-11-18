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
  // Two interchangeable senders, picked by whichever key the deployment has:
  // RESEND_API_KEY talks to Resend directly (no relay in the middle), and
  // VLY_EMAIL_API_KEY talks to the Freebuff/vly auth relay. Keeping both means
  // the deployment never needs a code change to switch provider.
  const brevoKey = (process.env.BREVO_API_KEY || "").trim();
  if (brevoKey) {
    await sendViaBrevo({ to, code, kind, apiKey: brevoKey });
    return;
  }

  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (resendKey) {
    await sendViaResend({ to, code, kind, apiKey: resendKey });
    return;
  }

  const apiKey = process.env.VLY_EMAIL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "No email sender configured. Run: npx convex env set BREVO_API_KEY <key> (or RESEND_API_KEY / VLY_EMAIL_API_KEY)",
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

/**
 * Parse `Name <address>` into the two fields the providers want.
 * Falls back to the bare string when there is no display name.
 */
function parseFrom(raw: string | undefined, fallbackEmail: string): {
  name: string;
  email: string;
} {
  const value = (raw || "").trim();
  const match = /^(.*)<([^>]+)>\s*$/.exec(value);
  const appName = process.env.VLY_APP_NAME || "TajirDz";
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    return { name: name || appName, email: match[2].trim() };
  }
  return { name: appName, email: value || fallbackEmail };
}

/**
 * Brevo delivery — the option that needs no domain.
 *
 * Brevo verifies a *sender address* rather than a domain, so a deployment with
 * no registered domain can still reach any recipient. That is what unblocks
 * real sign-ups before a domain exists; deliverability is weaker than a
 * verified domain, so this path is the fallback, not the goal.
 */
async function sendViaBrevo({
  to,
  code,
  kind,
  apiKey,
}: {
  to: string;
  code?: string;
  kind: AuthEmailKind;
  apiKey: string;
}): Promise<void> {
  const lang: AuthEmailLang = process.env.VLY_EMAIL_LANG === "fr" ? "fr" : "ar";
  const sender = parseFrom(
    process.env.VLY_EMAIL_FROM || process.env.BREVO_SENDER_EMAIL,
    process.env.BREVO_SENDER_EMAIL || "",
  );
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject: authEmailSubject(lang, kind),
      htmlContent: authEmailHtml({ lang, kind, code: code ?? "" }),
      textContent: `${process.env.VLY_APP_NAME || "TajirDz"}: ${code ?? ""}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`emailSendFailed (${res.status})`);
  }
}

/**
 * Direct Resend delivery.
 *
 * `from` is configurable because Resend only delivers from a verified domain
 * (or `onboarding@resend.dev`, which Resend restricts to the account owner's
 * own address). Point VLY_EMAIL_FROM at your domain once it is verified.
 */
async function sendViaResend({
  to,
  code,
  kind,
  apiKey,
}: {
  to: string;
  code?: string;
  kind: AuthEmailKind;
  apiKey: string;
}): Promise<void> {
  const lang: AuthEmailLang = process.env.VLY_EMAIL_LANG === "fr" ? "fr" : "ar";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Resend keeps its own sender variable: Resend only accepts a verified
      // domain (or its shared onboarding address), so it must not inherit the
      // Brevo sender, which is a plain mailbox.
      from:
        process.env.RESEND_FROM ||
        process.env.VLY_EMAIL_FROM ||
        "TajirDz <onboarding@resend.dev>",
      to: [to],
      subject: authEmailSubject(lang, kind),
      html: authEmailHtml({ lang, kind, code: code ?? "" }),
      text: `${process.env.VLY_APP_NAME || "TajirDz"}: ${code ?? ""}`,
    }),
  });
  if (!res.ok) {
    // Status only: the body can echo the recipient and the provider detail,
    // and this message is surfaced to the user and to logs.
    throw new Error(`emailSendFailed (${res.status})`);
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
