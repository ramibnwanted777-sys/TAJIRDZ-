/**
 * The courses rules that decide who gets access and when something is taken
 * down. They are asserted directly against `src/lib/courses.ts` — the same
 * functions the Convex mutations call — so a passing test means the server
 * behaviour, not a copy of it.
 */

import { describe, expect, it } from "vitest";

import {
  COMPLAINT_AUTO_HIDE_THRESHOLD,
  CODE_LOCK_PREFIX,
  canApply,
  canPublish,
  canViewMaterials,
  codeCandidates,
  codeRemaining,
  codeState,
  distinctComplainants,
  instructorStatusLabelKey,
  normaliseCode,
  parseCourseLock,
  redemptionOutcome,
  reviewVerdict,
  reviewWaitHours,
  shouldAutoHide,
  type CodeLike,
} from "@/lib/courses";
import { getDict } from "@/lib/i18n";
import { COMPLAINT_AUTO_HIDE_THRESHOLD as SERVER_THRESHOLD } from "@/convex/courses";
import { RATE_LIMITS, subscriptionIsLive } from "@/convex/lib/access";
import {
  DEFAULT_PRICING,
  pricingFromRaw,
  savingPercent,
  totalForCycle,
} from "@/lib/pricing";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const COURSE = "course_1";

function code(overrides: Partial<CodeLike> = {}): CodeLike {
  return {
    courseId: COURSE,
    code: "ABCD-EFGH",
    maxUses: 1,
    uses: 0,
    ...overrides,
  };
}

const redeem = (row: CodeLike | null, alreadyEnrolled = false) =>
  redemptionOutcome({ alreadyEnrolled, row, courseId: COURSE, now: NOW });

describe("enrollment code redemption", () => {
  it("accepts a fresh single-use code and consumes exactly one use", () => {
    const { outcome, usesAfter } = redeem(code());
    expect(outcome).toEqual({ ok: true, alreadyEnrolled: false });
    expect(usesAfter).toBe(1);
  });

  it("refuses a single-use code that has already been used", () => {
    const { outcome, usesAfter } = redeem(code({ maxUses: 1, uses: 1 }));
    expect(outcome).toEqual({ ok: false, reason: "errCodeUsedUp" });
    // A refused redemption never advances the counter.
    expect(usesAfter).toBe(1);
  });

  it("refuses once a multi-use code is exhausted", () => {
    expect(redeem(code({ maxUses: 5, uses: 4 })).outcome).toEqual({
      ok: true,
      alreadyEnrolled: false,
    });
    expect(redeem(code({ maxUses: 5, uses: 5 })).outcome).toEqual({
      ok: false,
      reason: "errCodeUsedUp",
    });
  });

  it("refuses an expired code, including one expiring exactly now", () => {
    expect(redeem(code({ expiresAt: NOW + 1 })).outcome.ok).toBe(true);
    expect(redeem(code({ expiresAt: NOW })).outcome).toEqual({
      ok: false,
      reason: "errCodeExpired",
    });
    expect(redeem(code({ expiresAt: NOW - 1 })).outcome).toEqual({
      ok: false,
      reason: "errCodeExpired",
    });
  });

  it("refuses a revoked code even when it still has uses left", () => {
    expect(redeem(code({ maxUses: 10, revokedAt: NOW - 1 })).outcome).toEqual({
      ok: false,
      reason: "errCodeRevoked",
    });
  });

  it("refuses a code that belongs to a different course", () => {
    expect(redeem(code({ courseId: "course_2" })).outcome).toEqual({
      ok: false,
      reason: "errCodeInvalid",
    });
  });

  it("treats a missing code as invalid rather than as an internal error", () => {
    expect(redeem(null).outcome).toEqual({ ok: false, reason: "errCodeInvalid" });
  });

  it("is idempotent when the same user submits their code twice", () => {
    // The second submission must succeed (the student just lost the page) and
    // must not burn another use.
    const { outcome, usesAfter } = redeem(code({ maxUses: 5, uses: 1 }), true);
    expect(outcome).toEqual({ ok: true, alreadyEnrolled: true });
    expect(usesAfter).toBe(1);
  });

  it("never lets concurrent redemptions exceed maxUses", () => {
    // The mutation is one Convex transaction, so the read-modify-write on
    // `uses` is serialised. Run every interleaving this serialisation can
    // produce: apply each accepted redemption to the shared row and assert the
    // invariant holds after each step.
    const maxUses = 3;
    let row = code({ maxUses, uses: 0 });
    let accepted = 0;

    for (let attempt = 0; attempt < 10; attempt++) {
      const { outcome, usesAfter } = redeem(row);
      if (outcome.ok && !outcome.alreadyEnrolled) {
        accepted++;
        expect(usesAfter).toBeLessThanOrEqual(maxUses);
        row = { ...row, uses: usesAfter };
      } else {
        expect(outcome).toEqual({ ok: false, reason: "errCodeUsedUp" });
        // A losing attempt leaves the row untouched.
        expect(usesAfter).toBe(row.uses);
      }
    }

    expect(accepted).toBe(maxUses);
    expect(row.uses).toBe(maxUses);
    expect(codeRemaining(row)).toBe(0);
  });

  it("survives a code typed without its dash", () => {
    expect(codeCandidates("abcd efgh")).toContain("ABCD-EFGH");
    expect(codeCandidates("ABCD-EFGH")).toContain("ABCD-EFGH");
    expect(normaliseCode("  abcd-efgh ")).toBe("ABCD-EFGH");
    // A lookup uses the first candidate, so the typed spelling is tried too.
    expect(codeCandidates("ABCD-EFGH")[0]).toBe("ABCD-EFGH");
  });

  it("reports a code's badge state for the instructor list", () => {
    expect(codeState(code(), NOW)).toBe("available");
    expect(codeState(code({ uses: 1, maxUses: 1 }), NOW)).toBe("usedUp");
    expect(codeState(code({ expiresAt: NOW - 1 }), NOW)).toBe("expired");
    expect(codeState(code({ revokedAt: NOW - 1 }), NOW)).toBe("revoked");
  });
});

describe("redemption rate limit", () => {
  it("allows five attempts per quarter of an hour per user", () => {
    expect(RATE_LIMITS.codeRedeem.limit).toBe(5);
    expect(RATE_LIMITS.codeRedeem.windowMs).toBe(15 * 60 * 1000);
  });

  it("carries the wait back to the form as text", () => {
    // The RateLimitError class does not survive the wire, so the minutes are
    // encoded in the message and read back by the same prefix constant.
    expect(parseCourseLock(`${CODE_LOCK_PREFIX}12`)).toBe(12);
    expect(parseCourseLock("errCodeInvalid")).toBeNull();
    expect(parseCourseLock(`${CODE_LOCK_PREFIX}soon`)).toBeNull();
  });
});

describe("review eligibility", () => {
  const base = { enrolled: true, enrolledAt: NOW - 49 * HOUR, hasReviewed: false, now: NOW };

  it("accepts an enrolled student after 48 hours", () => {
    expect(reviewVerdict(base)).toBe("ok");
  });

  it("refuses anyone who is not enrolled", () => {
    expect(reviewVerdict({ ...base, enrolled: false })).toBe("notEnrolled");
  });

  it("refuses a review written before 48 hours have passed", () => {
    expect(reviewVerdict({ ...base, enrolledAt: NOW - 47 * HOUR })).toBe("tooEarly");
    expect(reviewVerdict({ ...base, enrolledAt: NOW })).toBe("tooEarly");
  });

  it("allows exactly one review per student", () => {
    expect(reviewVerdict({ ...base, hasReviewed: true })).toBe("alreadyReviewed");
  });

  it("tells the student how long is left to wait", () => {
    expect(reviewWaitHours(NOW - 24 * HOUR, NOW)).toBe(24);
    expect(reviewWaitHours(NOW - 49 * HOUR, NOW)).toBe(0);
  });
});

describe("complaint enforcement", () => {
  it("hides a course after three different complainants", () => {
    expect(COMPLAINT_AUTO_HIDE_THRESHOLD).toBe(3);
    expect(distinctComplainants(["a", "b"])).toBe(2);
    expect(shouldAutoHide(["a", "b", "c"])).toBe(true);
  });

  it("ignores one person complaining repeatedly", () => {
    // Otherwise a single bad actor could take a competitor down alone.
    expect(shouldAutoHide(["a", "a", "a"])).toBe(false);
    expect(distinctComplainants(["a", "a", "a"])).toBe(1);
  });
});

describe("pricing", () => {
  it("ships the launch prices", () => {
    expect(DEFAULT_PRICING.wholesaler.basic.monthly).toBe(800);
    expect(DEFAULT_PRICING.wholesaler.pro.monthly).toBe(1800);
    expect(DEFAULT_PRICING.retailer.plus.monthly).toBe(300);
    expect(DEFAULT_PRICING.retailer.freeContactsPerMonth).toBe(3);
    expect(DEFAULT_PRICING.boost.perWeek).toBe(200);
    expect(DEFAULT_PRICING.promo.code).toBe("TAJIR-FREE");
  });

  it("keeps annual plans cheaper than twelve monthly payments", () => {
    for (const [monthly, yearly] of [
      [DEFAULT_PRICING.wholesaler.basic.monthly, DEFAULT_PRICING.wholesaler.basic.yearly],
      [DEFAULT_PRICING.wholesaler.pro.monthly, DEFAULT_PRICING.wholesaler.pro.yearly],
      [DEFAULT_PRICING.retailer.plus.monthly, DEFAULT_PRICING.retailer.plus.yearly],
    ]) {
      expect(yearly).toBeLessThan(monthly * 12);
    }
    // Wholesale yearly is "pay ten months, get twelve".
    expect(DEFAULT_PRICING.wholesaler.basic.yearly).toBe(
      DEFAULT_PRICING.wholesaler.basic.monthly * 10,
    );
  });

  it("fills in every field an override leaves out", () => {
    const partial = pricingFromRaw({
      wholesaler: { basic: { monthly: 700 } },
      retailer: { plus: { quarterly: 750 } },
    });
    expect(partial.wholesaler.basic.monthly).toBe(700);
    // Untouched fields keep the shipped value instead of collapsing to zero.
    expect(partial.wholesaler.basic.yearly).toBe(DEFAULT_PRICING.wholesaler.basic.yearly);
    expect(partial.wholesaler.pro.monthly).toBe(DEFAULT_PRICING.wholesaler.pro.monthly);
    expect(partial.retailer.plus.quarterly).toBe(750);
    expect(partial.retailer.plus.monthly).toBe(DEFAULT_PRICING.retailer.plus.monthly);
    expect(partial.boost.perWeek).toBe(DEFAULT_PRICING.boost.perWeek);
  });

  it("ignores nonsense overrides rather than publishing them", () => {
    const broken = pricingFromRaw({
      wholesaler: { basic: { monthly: -5, yearly: "free", features: "all" } },
      retailer: { freeContactsPerMonth: Number.NaN },
      promo: { code: "   ", maxUsers: null },
    });
    expect(broken.wholesaler.basic.monthly).toBe(DEFAULT_PRICING.wholesaler.basic.monthly);
    expect(broken.wholesaler.basic.yearly).toBe(DEFAULT_PRICING.wholesaler.basic.yearly);
    expect(broken.wholesaler.basic.features).toEqual(DEFAULT_PRICING.wholesaler.basic.features);
    expect(broken.retailer.freeContactsPerMonth).toBe(
      DEFAULT_PRICING.retailer.freeContactsPerMonth,
    );
    expect(broken.promo.code).toBe(DEFAULT_PRICING.promo.code);
    expect(broken.promo.maxUsers).toBe(DEFAULT_PRICING.promo.maxUsers);
  });

  it("does not mutate the object it is given", () => {
    const input = { wholesaler: { basic: { monthly: 500 } } };
    pricingFromRaw(input);
    expect(input).toEqual({ wholesaler: { basic: { monthly: 500 } } });
  });

  it("computes the cycle total and the stated saving", () => {
    expect(totalForCycle(DEFAULT_PRICING, "retailer", "plus", "quarterly")).toBe(800);
    expect(totalForCycle(DEFAULT_PRICING, "wholesaler", "pro", "yearly")).toBe(18000);
    expect(savingPercent(300, "quarterly", 800)).toBe(11);
    expect(savingPercent(300, "yearly", 2500)).toBe(30);
    expect(savingPercent(800, "yearly", 8000)).toBe(16);
    // A cycle that costs more than twelve months is never advertised as saving.
    expect(savingPercent(300, "yearly", 4000)).toBe(0);
  });

  it("keeps a paid subscription live when the price changes", () => {
    // Grandfathering: the subscription row owns its plan and expiry, so editing
    // the price list cannot deactivate somebody who has already paid. The
    // override below is what an admin would type; the subscription is untouched.
    const nextYear = pricingFromRaw({
      wholesaler: { pro: { monthly: 1, yearly: 1 } },
      retailer: { plus: { monthly: 1 } },
    });
    expect(nextYear.wholesaler.pro.monthly).toBe(1);

    // Only the fields the liveness rule reads; the rest of the row is not
    // relevant to "is this subscriber still covered".
    const paid = {
      status: "active",
      expiresAt: NOW + 10 * 24 * HOUR,
    } as unknown as Parameters<typeof subscriptionIsLive>[0];
    expect(subscriptionIsLive(paid, NOW)).toBe(true);
  });
});

describe("private materials access", () => {
  it("lets in the instructor who owns the course", () => {
    expect(canViewMaterials({ isOwner: true, isAdmin: false, isEnrolled: false })).toBe(true);
  });

  it("lets in an admin, for support and moderation", () => {
    expect(canViewMaterials({ isOwner: false, isAdmin: true, isEnrolled: false })).toBe(true);
  });

  it("lets in an enrolled student", () => {
    expect(canViewMaterials({ isOwner: false, isAdmin: false, isEnrolled: true })).toBe(true);
  });

  it("refuses a visitor with no enrollment", () => {
    // The query returns `[]` for signed-out callers before it ever asks; this
    // is the case that has to hold for every other unenrolled signed-in user.
    expect(canViewMaterials({ isOwner: false, isAdmin: false, isEnrolled: false })).toBe(false);
  });
});

describe("instructor standing", () => {
  it("lets only an approved instructor publish, or stay visible", () => {
    expect(canPublish("approved")).toBe(true);
    for (const status of ["pending", "rejected", "suspended", "closed"] as const) {
      expect(canPublish(status)).toBe(false);
    }
  });

  it("blocks a suspended or closed account from applying again", () => {
    // Otherwise closing an instructor is undone by re-submitting the form.
    expect(canApply("none")).toBe(true);
    expect(canApply("pending")).toBe(true);
    expect(canApply("rejected")).toBe(true);
    expect(canApply("suspended")).toBe(false);
    expect(canApply("closed")).toBe(false);
  });

  it("labels every standing in both languages", () => {
    for (const status of ["pending", "approved", "rejected", "suspended", "closed"] as const) {
      const key = instructorStatusLabelKey(status);
      expect(getDict("ar")).toHaveProperty(key);
      expect(getDict("fr")).toHaveProperty(key);
    }
  });

  it("uses the same auto-hide threshold as the server", () => {
    // The convex module re-exports the constant from the shared module; if
    // that re-export ever drifts, the page would promise a rule the server
    // does not keep.
    expect(SERVER_THRESHOLD).toBe(COMPLAINT_AUTO_HIDE_THRESHOLD);
    expect(SERVER_THRESHOLD).toBe(3);
  });
});
