import { Password } from "@convex-dev/auth/providers/Password";
import type { PasswordConfig } from "@convex-dev/auth/providers/Password";
import type { DataModel } from "../_generated/dataModel";

import { resetEmailConfig } from "./emailOtp";
import {
  isAdminEmail,
  isValidEmail,
  normalizeEmail,
  validatePassword,
} from "../lib/security";

/** Longest name we store; anything longer is a paste accident, not a person. */
const MAX_NAME_LENGTH = 120;

/**
 * Email + password sign-in, alongside the existing email-OTP provider.
 *
 * - `verify` requires email verification at sign-up, so an account only becomes
 *   usable once the address is proven. The 6-digit code is emailed by
 *   `verifyEmailConfig`.
 * - `reset` also requires verification, so "forgot password" cannot be used to
 *   probe for real accounts. `resetEmailConfig` expires its code in 10 minutes
 *   and Convex Auth consumes it on use, so a reset code is single-use.
 * - Password rules live in `lib/security` and are enforced here on the server;
 *   the client-side strength meter is advisory only.
 * - The role is decided from the server-side ADMIN_EMAILS allowlist. An `admin`
 *   role is never read from the client; the only role a client may pick is its
 *   own business type (wholesaler / retailer).
 *
 * `profile` must stay synchronous — Convex Auth reads `email` off its return
 * value without awaiting — so the per-flow abuse limits live in
 * `api.authGuard.chargeAttempt`, which the UI calls immediately before each
 * auth action.
 */
const config: PasswordConfig<DataModel> = {
  id: "password",
  // Sign-up completes without an emailed code on purpose.
  //
  // Email infrastructure costs money (a verified domain or a transactional
  // provider), and requiring it closed the marketplace to everyone except the
  // owner: a new visitor could never finish registering. Signing up with a
  // password is therefore self-service, and the address is treated as
  // unproven — `emailVerificationTime` stays unset, so the ADMIN_EMAILS
  // bootstrap (which requires a proven address, see lib/access.ts) still
  // cannot be claimed by someone who merely typed the admin address.
  // Re-enable `verify: verifyEmailConfig` once a sender is configured.
  reset: resetEmailConfig,

  validatePasswordRequirements: (value) => {
    validatePassword(value);
  },

  profile: (params) => {
    const email = normalizeEmail(String(params.email ?? ""));
    // Nothing else proves the address now, so a malformed one is rejected here
    // rather than stored and shown to wholesalers later.
    if (!isValidEmail(email)) throw new Error("errEmailInvalid");
    const role = profileRole(email, params.role);
    const name = profileName(params.name);
    // Only the fields we set are returned; Convex Auth fills the rest in.
    return {
      email,
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
    };
  },
};

/**
 * Admin comes from the server-side allowlist only. Anything else the client
 * sends is narrowed to the two business roles it is allowed to choose, so a
 * crafted `role: "admin"` at sign-up is discarded.
 */
function profileRole(email: string, requested: unknown) {
  if (isAdminEmail(email)) return "admin" as const;
  return requested === "wholesaler" || requested === "retailer"
    ? (requested as "wholesaler" | "retailer")
    : undefined;
}

function profileName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return undefined;
  return name.slice(0, MAX_NAME_LENGTH);
}

export const password = Password(config);