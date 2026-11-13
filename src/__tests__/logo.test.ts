/**
 * Logo geometry.
 *
 * The safe-area rule is the whole point of the file: artwork that leaves it is
 * exactly what got clipped on small favicons, so it is asserted rather than
 * eyeballed.
 */

import { describe, expect, it } from "vitest";

import {
  LOGO_SIZES,
} from "@/components/Logo";
import {
  SAFE_AREA,
  SAFE_BOX,
  assertLogoSafeArea,
  logoShapeBounds,
  logoShapes,
  logoSvg,
  variantForSize,
} from "@/lib/logoMark";

describe("logo safe area", () => {
  it("keeps at least 12% of every edge clear for both variants", () => {
    expect(SAFE_AREA).toBeGreaterThanOrEqual(0.12);
    for (const variant of ["full", "simple"] as const) {
      const { minX, minY, maxX, maxY } = logoShapeBounds(variant);
      expect(minX).toBeGreaterThanOrEqual(SAFE_BOX.min);
      expect(minY).toBeGreaterThanOrEqual(SAFE_BOX.min);
      expect(maxX).toBeLessThanOrEqual(SAFE_BOX.max);
      expect(maxY).toBeLessThanOrEqual(SAFE_BOX.max);
    }
  });

  it("does not throw, which is what the icon generator relies on", () => {
    expect(() => assertLogoSafeArea()).not.toThrow();
  });

  it("keeps the arrowhead off the bottom edge", () => {
    const { arrow } = logoShapes("full");
    expect(arrow).toHaveLength(3);
    for (const point of arrow) {
      expect(point.y).toBeLessThanOrEqual(SAFE_BOX.max);
      expect(point.x).toBeGreaterThanOrEqual(SAFE_BOX.min);
      expect(point.x).toBeLessThanOrEqual(SAFE_BOX.max);
    }
  });

  it("draws nothing thinner than 7 units, so it survives 24px", () => {
    const { crossbar, stem } = logoShapes("full");
    expect(crossbar.h).toBeGreaterThanOrEqual(7);
    expect(stem.w).toBeGreaterThanOrEqual(7);
  });
});

describe("logo variants", () => {
  it("scales the whole mark up below 40px", () => {
    expect(variantForSize(16)).toBe("simple");
    expect(variantForSize(24)).toBe("simple");
    expect(variantForSize(36)).toBe("simple");
    expect(variantForSize(40)).toBe("full");
    expect(variantForSize(192)).toBe("full");

    const simple = logoShapes("simple");
    expect(simple.scale).toBeGreaterThan(1);
    expect(simple.arrow).toHaveLength(3);

    const full = logoShapes("full");
    expect(full.scale).toBe(1);
    expect(full.arrow).toHaveLength(3);
  });

  it("scales the arrow but keeps the same silhouette", () => {
    const full = logoShapes("full");
    const simple = logoShapes("simple");
    // Same orientation: tip below the bar, pointing down the stem.
    expect(full.arrow[0].y).toBe(full.arrow[1].y);
    expect(simple.arrow[0].y).toBe(simple.arrow[1].y);
    expect(full.arrow[2].y).toBeGreaterThan(full.arrow[0].y);
    expect(simple.arrow[2].y).toBeGreaterThan(simple.arrow[0].y);
  });
});

describe("Logo size variants", () => {
  it("exposes exactly the four supported sizes, all square", () => {
    expect(LOGO_SIZES).toEqual({ xs: 24, sm: 36, md: 56, lg: 96 });
  });
});

describe("logoSvg", () => {
  it("emits a self-contained 48x48 vector with no external references", () => {
    const svg = logoSvg("full");
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(svg).not.toContain("http://www.w3.org/1999/xhtml");
    expect(svg).not.toContain("<image");
    expect(svg).toContain("<polygon");
  });
});
