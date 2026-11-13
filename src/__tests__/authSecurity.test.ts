/**
 * Credential policy, error handling and abuse limits.
 *
 * These are the rules that decide whether somebody can get into an account, so
 * they are asserted directly rather than through the UI.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ADMIN_EMAILS,
  MIN_PASSWORD_LENGTH,
  adminEmails,
  isAdminEmail,
  normalizeEmail,
  passwordStrength,
  validatePassword,
} from "@/convex/lib/security";
import { authErrorText } from "@/lib/authErrors";
import { getDict } from "@/lib/i18n";
import {
  AUTH_GUARD_RULES,
  AuthGuardError,
  authGuardKey,
  consumeAuthGuard,
  guardKindForFlow,
  parseAuthGuardError,
} from "@/convex/lib/authGuard";
import { shouldPromoteToAdmin } from "@/convex/lib/access";
import { CODE_TTL_SECONDS } from "@/convex/auth/emailOtp";
import type { MutationCtx } from "@/convex/_generated/server";

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

describe("validatePassword", () => {
  it("rejects anything shorter than the minimum", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(() => validatePassword("Ab1cdef")).toThrow("errPasswordTooShort");
  });

  it("requires a lower case, an upper case and a digit", () => {
    expect(() => validatePassword("abcdefgh")).toThrow("errPasswordTooWeak");
    expect(() => validatePassword("ABCDEFGH")).toThrow("errPasswordTooWeak");
    expect(() => validatePassword("abcd2345")).toThrow("errPasswordTooWeak");
    expect(() => validatePassword("Abcd2345")).not.toThrow();
  });

  it("caps the length so a paste cannot become a hash DoS", () => {
    expect(() => validatePassword(`Ab1${"x".repeat(300)}`)).toThrow("errPasswordTooLong");
  });
});

describe("passwordStrength", () => {
  it("scores an empty password as nothing and reports no problems", () => {
    expect(passwordStrength("")).toEqual({ score: 0, label: "veryWeak", problems: [] });
  });

  it("names every missing rule so the meter can explain itself", () => {
    expect(passwordStrength("abc").problems).toEqual([
      "errPasswordTooShort",
      "errNeedsUppercase",
      "errNeedsDigit",
    ]);
  });

  it("rates a long mixed password as strong", () => {
    const strength = passwordStrength("Abcdefgh1234!");
    expect(strength.score).toBe(4);
    expect(strength.label).toBe("strong");
    expect(strength.problems).toEqual([]);
  });

  it("agrees with the server rule: a password with no listed problem is accepted", () => {
    for (const candidate of ["abc", "abcdefgh", "ABCDEFGH", "abcd2345", "Ab1", "Abcd2345"]) {
      let accepted = true;
      try {
        validatePassword(candidate);
      } catch {
        accepted = false;
      }
      expect(accepted).toBe(passwordStrength(candidate).problems.length === 0);
    }
  });

  it("stays silent on an untouched field rather than shouting at an empty one", () => {
    // The sign-up form rejects an empty password on length before it ever looks
    // at the meter, so the meter deliberately reports nothing here.
    expect(passwordStrength("").problems).toEqual([]);
    expect(() => validatePassword("")).toThrow("errPasswordTooShort");
  });
});

// ---------------------------------------------------------------------------
// Generic errors
// ---------------------------------------------------------------------------

describe("authErrorText", () => {
  const t = getDict("ar");
  const generic = t.authInvalidCredentials;

  it("collapses a wrong password and an unknown account to one sentence", () => {
    expect(authErrorText(new Error("Invalid credentials"), t, generic)).toBe(generic);
    expect(authErrorText(new Error("errInvalidCredentials"), t, generic)).toBe(generic);
    expect(authErrorText(new Error(""), t, generic)).toBe(generic);
    expect(authErrorText(undefined, t, generic)).toBe(generic);
  });

  it("never leaks the raw server message", () => {
    const leaky = new Error("no account for nobody@example.com");
    expect(authErrorText(leaky, t, generic)).toBe(generic);
    expect(authErrorText(leaky, t, generic)).not.toContain("nobody@example.com");
  });

  it("surfaces the wait when the account is locked out", () => {
    const message = authErrorText(new Error("errAuthGuard:signIn:15"), t, generic);
    expect(message).toContain("15");
    expect(message).not.toBe(generic);
  });

  it("names password policy failures, which say nothing about the account", () => {
    expect(authErrorText(new Error("errPasswordTooShort"), t, generic)).toBe(
      t.errPasswordTooShort,
    );
  });

  it("says the same thing in French", () => {
    const fr = getDict("fr");
    expect(authErrorText(new Error("Invalid credentials"), fr, fr.authInvalidCredentials)).toBe(
      fr.authInvalidCredentials,
    );
  });
});

// ---------------------------------------------------------------------------
// Abuse limits
// ---------------------------------------------------------------------------

/**
 * Minimal stand-in for the slice of `MutationCtx` the guard touches: one
 * table, read through its unique index, plus the three writes it makes.
 */
function fakeGuardCtx() {
  type Row = { _id: string; key: string; count: number; windowStart: number };
  const rows = new Map<string, Row>();
  let nextId = 1;

  // The guard only ever builds one equality, on "key", so the fake just keeps
  // the last value it was handed.
  let wanted = "";

  const db = {
    query: () => ({
      withIndex: (
        _index: string,
        builder: (q: { eq: (field: string, value: string) => unknown }) => unknown,
      ) => ({
        first: async () => {
          builder({
            eq: (_field: string, value: string) => {
              wanted = value;
            },
          });
          return rows.get(wanted) ?? null;
        },
      }),
    }),
    patch: async (id: string, patch: Record<string, number>) => {
      for (const row of rows.values()) {
        if (row._id === id) Object.assign(row, patch);
      }
    },
    insert: async (_table: string, doc: Omit<Row, "_id">) => {
      rows.set(doc.key, { _id: String(nextId++), ...doc });
    },
    delete: async (id: string) => {
      for (const [key, row] of rows) if (row._id === id) rows.delete(key);
    },
  };

  // Only `db` is exercised, so the rest of the context is stubbed away rather
  // than hand-written.
  return { db } as unknown as MutationCtx;
}

describe("auth guards", () => {
  it("maps every credential flow onto a bucket", () => {
    expect(guardKindForFlow("signUp")).toBe("signUp");
    expect(guardKindForFlow("signIn")).toBe("signIn");
    expect(guardKindForFlow("reset")).toBe("resetRequest");
    expect(guardKindForFlow("reset-verification")).toBe("resetVerify");
    expect(guardKindForFlow("email-verification")).toBe("emailVerify");
    expect(guardKindForFlow("something-new")).toBeNull();
  });

  it("locks an account for 15 minutes after five password attempts", async () => {
    const ctx = fakeGuardCtx();
    const now = 1_000_000;

    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(consumeAuthGuard(ctx, "signIn", "a@b.com", now)).resolves.toBeUndefined();
    }

    await expect(consumeAuthGuard(ctx, "signIn", "a@b.com", now)).rejects.toBeInstanceOf(
      AuthGuardError,
    );
    await expect(consumeAuthGuard(ctx, "signIn", "a@b.com", now + 60_000)).rejects.toThrow(
      "errAuthGuard:signIn:14",
    );
    // Once the window rolls over the account is usable again.
    await expect(
      consumeAuthGuard(ctx, "signIn", "a@b.com", now + 15 * 60_000),
    ).resolves.toBeUndefined();
  });

  it("allows only five guesses at a reset code", async () => {
    const ctx = fakeGuardCtx();
    const now = 2_000_000;
    for (let i = 0; i < 5; i++) {
      await expect(consumeAuthGuard(ctx, "resetVerify", "a@b.com", now)).resolves.toBeUndefined();
    }
    await expect(consumeAuthGuard(ctx, "resetVerify", "a@b.com", now)).rejects.toBeInstanceOf(
      AuthGuardError,
    );
    expect(AUTH_GUARD_RULES.resetVerify.limit).toBe(5);
    expect(AUTH_GUARD_RULES.resetVerify.windowMs).toBe(10 * 60 * 1000);
  });

  it("enforces the 60 second resend cooldown", async () => {
    const ctx = fakeGuardCtx();
    const now = 3_000_000;
    await expect(consumeAuthGuard(ctx, "resetRequest", "a@b.com", now)).resolves.toBeUndefined();
    await expect(
      consumeAuthGuard(ctx, "resetRequest", "a@b.com", now + 59_000),
    ).rejects.toBeInstanceOf(AuthGuardError);
    await expect(
      consumeAuthGuard(ctx, "resetRequest", "a@b.com", now + 60_000),
    ).resolves.toBeUndefined();
  });

  it("allows five guesses at a new-account verification code too", async () => {
    const ctx = fakeGuardCtx();
    const now = 5_000_000;
    for (let i = 0; i < 5; i++) {
      await expect(consumeAuthGuard(ctx, "emailVerify", "a@b.com", now)).resolves.toBeUndefined();
    }
    await expect(consumeAuthGuard(ctx, "emailVerify", "a@b.com", now)).rejects.toBeInstanceOf(
      AuthGuardError,
    );
  });

  it("scopes buckets per address, so one user cannot lock out another", async () => {
    const ctx = fakeGuardCtx();
    const now = 4_000_000;
    for (let i = 0; i < 5; i++) await consumeAuthGuard(ctx, "signIn", "a@b.com", now);
    await expect(consumeAuthGuard(ctx, "signIn", "c@d.com", now)).resolves.toBeUndefined();
    expect(authGuardKey("signIn", " C@D.com ")).toBe(authGuardKey("signIn", "c@d.com"));
  });

  it("parses the wait back out of the error message", () => {
    expect(parseAuthGuardError("errAuthGuard:signIn:15")).toEqual({ minutes: 15 });
    expect(parseAuthGuardError("errAuthGuard:resetRequest:1")).toEqual({ minutes: 1 });
    expect(parseAuthGuardError("Invalid credentials")).toBeNull();
    expect(parseAuthGuardError("errAuthGuard:signIn:soon")).toBeNull();
  });

  it("expires a six digit code in ten minutes", () => {
    expect(CODE_TTL_SECONDS).toBe(600);
  });

  it("normalises addresses before comparing them", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

// ---------------------------------------------------------------------------
// Admin promotion
// ---------------------------------------------------------------------------

describe("admin allowlist parsing", () => {
  // The bootstrap admins are compiled in on purpose: a deployment whose env
  // var was never set still needs somebody who can approve the first shop.
  const BOOTSTRAP = DEFAULT_ADMIN_EMAILS;

  it("adds a comma and whitespace separated list, case-insensitively", () => {
    const list = adminEmails(" A@B.com , c@d.com,,  ");
    for (const address of BOOTSTRAP) expect(list.has(address)).toBe(true);
    expect(list.has("a@b.com")).toBe(true);
    expect(list.has("c@d.com")).toBe(true);
    expect(list.has(" ")).toBe(false);
    expect(list.has("")).toBe(false);
  });

  it("always keeps the bootstrap admins, even with no env var", () => {
    expect(adminEmails("").size).toBe(BOOTSTRAP.length);
    for (const address of BOOTSTRAP) expect(adminEmails(undefined).has(address)).toBe(true);
  });

  it("does not let an unrelated address in", () => {
    expect(adminEmails(" a@b.com ").has("mallory@example.com")).toBe(false);
  });
});

describe("shouldPromoteToAdmin", () => {
  // The predicate is injected so the rule can be exercised without depending on
  // the deployment's env var, which is what is actually being asserted here.
  const allowlisted = "ramibnwantedd777@gmail.com";
  const isAllowed = (email: string | undefined) =>
    adminEmails("ramibnwantedd777@gmail.com").has((email ?? "").toLowerCase());

  it("promotes an allowlisted address once the email is verified", () => {
    expect(
      shouldPromoteToAdmin(
        { role: "retailer", doc: { email: allowlisted, emailVerificationTime: 1234 } },
        isAllowed,
      ),
    ).toBe(true);
  });

  it("refuses an allowlisted address that has never been verified", () => {
    expect(
      shouldPromoteToAdmin(
        { role: "retailer", doc: { email: allowlisted, emailVerificationTime: undefined } },
        isAllowed,
      ),
    ).toBe(false);
  });

  it("refuses any address that is not on the allowlist", () => {
    expect(
      shouldPromoteToAdmin(
        { role: "retailer", doc: { email: "someone@else.com", emailVerificationTime: 1 } },
        isAllowed,
      ),
    ).toBe(false);
  });

  it("never demotes an existing admin", () => {
    expect(
      shouldPromoteToAdmin(
        { role: "admin", doc: { email: "someone@else.com", emailVerificationTime: 1 } },
        isAllowed,
      ),
    ).toBe(false);
  });

  it("refuses an account with no address at all", () => {
    expect(
      shouldPromoteToAdmin(
        { role: "retailer", doc: { email: undefined, emailVerificationTime: 1 } },
        isAllowed,
      ),
    ).toBe(false);
  });

  it("matches a bootstrap admin through the real reader", () => {
    expect(isAdminEmail(DEFAULT_ADMIN_EMAILS[0])).toBe(true);
    expect(isAdminEmail(` ${DEFAULT_ADMIN_EMAILS[0].toUpperCase()} `)).toBe(true);
    expect(isAdminEmail("stranger@example.com")).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});