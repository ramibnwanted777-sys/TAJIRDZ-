/**
 * The credential flows, run against the real Convex Auth provider.
 *
 * These are the rules a person actually meets: signing up with a password
 * signs the new account in immediately (email verification is deliberately
 * off while the deployment has no mail sender), a wrong password and an
 * unknown address are indistinguishable, a reset code works exactly once and
 * dies after ten minutes, and the abuse limits bite before the credentials are
 * even sent.
 *
 * `axios` is stubbed, so the e-mail body that would leave the deployment is
 * captured instead of sent — which is also how the reset tests read the
 * 6-digit code.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import axios from "axios";
import { convexTest } from "convex-test";

import schema from "@/convex/schema";
import { api } from "@/convex/_generated/api";
import { CODE_TTL_SECONDS } from "@/convex/auth/emailOtp";
import { authErrorText } from "@/lib/authErrors";
import { getDict } from "@/lib/i18n";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(async () => ({ status: 200 })),
    isAxiosError: () => false,
  },
  isAxiosError: () => false,
}));

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

// Convex Auth signs the session JWT with `JWT_PRIVATE_KEY`, which the
// deployment gets from `convex env set`. Tests mint their own key pair so the
// sign-in path is exercised end to end without borrowing a real secret.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const EMAIL = "sign-in@example.com";
const PASSWORD = "Abcdefgh1234";

/** The handle `convexTest` hands back; its type is not exported by the lib. */
type TestCtx = ReturnType<typeof convexTest>;

function setup(): TestCtx {
  return convexTest(schema, modules);
}

/** The 6-digit code from the most recent e-mail the provider would have sent. */
function lastCode(): string {
  const calls = (axios.post as Mock).mock.calls;
  const body = calls[calls.length - 1]?.[1] as { otp?: string };
  expect(body?.otp, "an e-mail with a code was sent").toMatch(/^\d{6}$/);
  return body.otp!;
}

/**
 * Sign up, which returns a session directly: password sign-up needs no e-mail
 * code, so this is the whole "create a normal account" step.
 */
async function createAccount(t: TestCtx, email = EMAIL, password = PASSWORD) {
  return await t.action(api.auth.signIn, {
    provider: "password",
    params: { flow: "signUp", email, password, name: "Tester", role: "retailer" },
  });
}

function signIn(t: TestCtx, params: Record<string, unknown>) {
  return t.action(api.auth.signIn, {
    provider: "password",
    params: params as Record<string, string>,
  });
}

beforeEach(() => {
  process.env.VLY_EMAIL_API_KEY = "test-key";
  process.env.CONVEX_SITE_URL = "https://example.convex.cloud";
  process.env.SITE_URL = "https://tajirdz.freebuff.app";
  process.env.VLY_APP_NAME = "TajirDz";
  process.env.JWT_PRIVATE_KEY = privateKey;
  const post = axios.post as Mock;
  post.mockReset();
  post.mockResolvedValue({ status: 200 });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

describe("creating an account", () => {
  it("signs the new account in immediately, with no e-mail sent", async () => {
    const t = setup();
    const result = await signIn(t, {
      flow: "signUp",
      email: EMAIL,
      password: PASSWORD,
      name: "Tester",
      role: "retailer",
    });

    // Anyone can register: no sender, no code, no waiting.
    expect(result.tokens).not.toBeNull();
    expect(axios.post as Mock).not.toHaveBeenCalled();

    // The address is still unproven — `emailVerificationTime` is what the admin
    // bootstrap requires, so a typed-in admin address grants nothing.
    const [user] = await t.run((ctx) => ctx.db.query("users").collect());
    expect(user.emailVerificationTime).toBeUndefined();
    expect(user.role).not.toBe("admin");
  });

  it("has no e-mail verification step to fall back on", async () => {
    const t = setup();
    await createAccount(t);
    await expect(
      signIn(t, { flow: "email-verification", email: EMAIL, code: "000000" }),
    ).rejects.toThrow(/not enabled|could not verify|code/i);
  });
});

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

describe("signing in with a password", () => {
  it("returns tokens for the right password", async () => {
    const t = setup();
    await createAccount(t);
    const result = await signIn(t, { flow: "signIn", email: EMAIL, password: PASSWORD });
    expect(result.tokens).not.toBeNull();
    expect(Object.keys(result.tokens as object).length).toBeGreaterThan(0);
  });

  it("rejects the wrong password", async () => {
    const t = setup();
    await createAccount(t);
    await expect(
      signIn(t, { flow: "signIn", email: EMAIL, password: "WrongPass123" }),
    ).rejects.toThrow(/InvalidSecret|Invalid credentials/i);
  });

  it("shows one sentence for a wrong password and for an address with no account", async () => {
    const t = setup();
    await createAccount(t);

    // Convex Auth names the two failures differently on the wire —
    // `InvalidSecret` versus `InvalidAccountId` — which is an enumeration
    // oracle if it ever reaches the screen. Nothing but `authErrorText` may
    // render an auth error, so that is what the assertion exercises.
    const message = async (params: Record<string, string>) => {
      try {
        await signIn(t, params);
        return "resolved";
      } catch (error) {
        return authErrorText(error, getDict("ar"), getDict("ar").authInvalidCredentials);
      }
    };

    const wrongPassword = await message({
      flow: "signIn",
      email: EMAIL,
      password: "WrongPass123",
    });
    const noAccount = await message({
      flow: "signIn",
      email: "nobody@example.com",
      password: "WrongPass123",
    });

    expect(wrongPassword).toBe(noAccount);
    expect(wrongPassword).toBe(getDict("ar").authInvalidCredentials);
    expect(wrongPassword).not.toContain("nobody@example.com");
  });

  it("lets the same password sign in again straight after sign-up", async () => {
    const t = setup();
    await createAccount(t, "self-serve@example.com");
    const result = await signIn(t, {
      flow: "signIn",
      email: "self-serve@example.com",
      password: PASSWORD,
    });
    expect(result.tokens).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe("password reset", () => {
  /** Ask for a reset code and hand back the code that was "sent". */
  async function requestCode(t: TestCtx): Promise<string> {
    await signIn(t, { flow: "reset", email: EMAIL });
    return lastCode();
  }

  it("changes the password with the emailed code", async () => {
    const t = setup();
    await createAccount(t);
    const code = await requestCode(t);

    const result = await signIn(t, {
      flow: "reset-verification",
      email: EMAIL,
      code,
      newPassword: "NewPass12345",
    });
    expect(result.tokens).not.toBeNull();

    // The old password is gone and the new one works.
    await expect(
      signIn(t, { flow: "signIn", email: EMAIL, password: PASSWORD }),
    ).rejects.toThrow(/InvalidSecret|Invalid credentials/i);
    const reauth = await signIn(t, {
      flow: "signIn",
      email: EMAIL,
      password: "NewPass12345",
    });
    expect(reauth.tokens).not.toBeNull();
  });

  it("uses the code exactly once", async () => {
    const t = setup();
    await createAccount(t);
    const code = await requestCode(t);

    await signIn(t, {
      flow: "reset-verification",
      email: EMAIL,
      code,
      newPassword: "NewPass12345",
    });

    // A replay of the same code must fail: the token was consumed.
    await expect(
      signIn(t, {
        flow: "reset-verification",
        email: EMAIL,
        code,
        newPassword: "AnotherPass123",
      }),
    ).rejects.toThrow(/code/i);
  });

  it("rejects a wrong code without touching the password", async () => {
    const t = setup();
    await createAccount(t);
    await requestCode(t);

    await expect(
      signIn(t, {
        flow: "reset-verification",
        email: EMAIL,
        code: "999999",
        newPassword: "NewPass12345",
      }),
    ).rejects.toThrow(/code/i);

    const stillOld = await signIn(t, { flow: "signIn", email: EMAIL, password: PASSWORD });
    expect(stillOld.tokens).not.toBeNull();
  });

  it("dies ten minutes after it was issued", async () => {
    expect(CODE_TTL_SECONDS).toBe(600);

    const t = setup();
    await createAccount(t);
    const code = await requestCode(t);

    // Only `Date` is faked, so Convex's own scheduling stays real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);

    await expect(
      signIn(t, {
        flow: "reset-verification",
        email: EMAIL,
        code,
        newPassword: "NewPass12345",
      }),
    ).rejects.toThrow(/code/i);
  });
});

// ---------------------------------------------------------------------------
// Abuse limits, through the mutation the UI calls
// ---------------------------------------------------------------------------

describe("attempt limits", () => {
  it("locks password sign-in for fifteen minutes after five attempts", async () => {
    const t = setup();
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        t.mutation(api.authGuard.chargeAttempt, { kind: "signIn", email: EMAIL }),
      ).resolves.not.toThrow();
    }
    await expect(
      t.mutation(api.authGuard.chargeAttempt, { kind: "signIn", email: EMAIL }),
    ).rejects.toThrow(/^errAuthGuard:signIn:1[45]$/);
  });

  it("refuses a second reset e-mail inside sixty seconds", async () => {
    const t = setup();
    await expect(
      t.mutation(api.authGuard.chargeAttempt, { kind: "resetRequest", email: EMAIL }),
    ).resolves.not.toThrow();
    await expect(
      t.mutation(api.authGuard.chargeAttempt, { kind: "resetRequest", email: EMAIL }),
    ).rejects.toThrow(/^errAuthGuard:resetRequest:1$/);
  });

  it("lets the signed-in owner clear their counter, and nobody else", async () => {
    const t = setup();
    await createAccount(t);

    for (let attempt = 0; attempt < 5; attempt++) {
      await t.mutation(api.authGuard.chargeAttempt, { kind: "signIn", email: EMAIL });
    }
    await expect(
      t.mutation(api.authGuard.chargeAttempt, { kind: "signIn", email: EMAIL }),
    ).rejects.toThrow(/errAuthGuard/);

    // A bare call proves nothing, so it must not be able to unlock anyone.
    const anonymous = await t.mutation(api.authGuard.clearSignInLockout, { email: EMAIL });
    expect(anonymous.cleared).toBe(false);

    // The person who holds the account can, which is what stops five typos
    // from locking out the sixth correct attempt.
    const [user] = await t.run((ctx) => ctx.db.query("users").collect());
    const asOwner = t.withIdentity({ subject: user._id });
    const cleared = await asOwner.mutation(api.authGuard.clearSignInLockout, {
      email: EMAIL,
    });
    expect(cleared.cleared).toBe(true);

    await expect(
      t.mutation(api.authGuard.chargeAttempt, { kind: "signIn", email: EMAIL }),
    ).resolves.not.toThrow();
  });
});
