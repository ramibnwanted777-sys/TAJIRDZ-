/**
 * Single source of truth for the TajirDz mark geometry.
 *
 * The React component (`src/components/Logo.tsx`) and the icon generator
 * (`scripts/generate-icons.mjs`) both derive their drawing from this file, so
 * an SVG in the app and a PNG on the home screen can never drift apart.
 *
 * The mark is one simple, bold shape: a "T" whose stem ends in a single
 * arrowhead — the direction trade flows. Nothing thinner than 7 units and no
 * detached satellites, because details like the old paired nodes merged into a
 * bone shape below 48px.
 *
 * Everything is expressed in a 48x48 design space. Two rules are enforced here
 * rather than left to review:
 *
 *  1. **Safe area.** All artwork stays at least `SAFE_AREA` (12%) away from the
 *     tile edge. Platform masks, rounded-corner cropping and antialiasing all
 *     eat into the outer ring. `assertLogoSafeArea` turns a regression into a
 *     thrown error in the generator and a failing test, not a clipped favicon.
 *  2. **Small-size simplification.** Below 40px the whole mark is scaled up
 *     (`variantForSize`), so the arrow still reads at 24px instead of
 *     dissolving into pixels.
 */

export const LOGO_VIEWBOX = 48;

/** Side of the design space, in units. */
export const LOGO_TILE = 48;

/** Corner radius of the green field. */
export const LOGO_CORNER_RADIUS = 12;

/** Fraction of the tile the artwork must stay clear of, on every side. */
export const SAFE_AREA = 0.12;

/** Brand green. Kept in sync with `--brand-green` in src/index.css. */
export const LOGO_BRAND = "#006233";

/** Scale applied to the whole mark when the simplified variant is used. */
const SIMPLE_SCALE = 1.18;

export type LogoVariant = "full" | "simple";

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export type LogoShapes = {
  /** 1 for the full mark, larger for the simplified one. */
  scale: number;
  /** The horizontal bar of the "T". */
  crossbar: Rect;
  /** The vertical stem of the "T". */
  stem: Rect;
  /** The arrowhead the stem ends in, as three points. */
  arrow: Point[];
};

/** Unscaled geometry of the mark. */
const BASE = {
  crossbar: { x: 11, y: 11, w: 26, h: 8 },
  stem: { x: 20.5, y: 19, w: 7, h: 9 },
  // Overlaps the stem bottom by 1.5 units so the two read as one solid shape.
  arrow: [
    { x: 16.5, y: 26.5 },
    { x: 31.5, y: 26.5 },
    { x: 24, y: 39 },
  ],
};

/** The artwork box artwork must stay inside, in design units. */
export const SAFE_BOX = {
  min: LOGO_TILE * SAFE_AREA,
  max: LOGO_TILE * (1 - SAFE_AREA),
};

/** Which variant a given pixel size should use. */
export function variantForSize(pixels: number): LogoVariant {
  return pixels < 40 ? "simple" : "full";
}

function scaleRect(rect: Rect, project: (n: number) => number, scale: number): Rect {
  return {
    x: project(rect.x),
    y: project(rect.y),
    w: rect.w * scale,
    h: rect.h * scale,
  };
}

/**
 * Resolve the drawn geometry for a variant.
 *
 * The simplified variant scales about the tile centre so the mark stays
 * optically centred and gains stroke weight at small sizes.
 */
export function logoShapes(variant: LogoVariant): LogoShapes {
  const scale = variant === "simple" ? SIMPLE_SCALE : 1;
  const centre = LOGO_TILE / 2;
  const project = (n: number) => centre + (n - centre) * scale;

  return {
    scale,
    crossbar: scaleRect(BASE.crossbar, project, scale),
    stem: scaleRect(BASE.stem, project, scale),
    arrow: BASE.arrow.map((point) => ({
      x: project(point.x),
      y: project(point.y),
    })),
  };
}

/** Every shape of a variant, as `{min,max}` pairs per axis, for bounds checks. */
export function logoShapeBounds(variant: LogoVariant): { minX: number; minY: number; maxX: number; maxY: number } {
  const { crossbar, stem, arrow } = logoShapes(variant);
  const rects = [crossbar, stem];
  let minX = Math.min(...rects.map((r) => r.x));
  let minY = Math.min(...rects.map((r) => r.y));
  let maxX = Math.max(...rects.map((r) => r.x + r.w));
  let maxY = Math.max(...rects.map((r) => r.y + r.h));
  for (const point of arrow) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Throw if any variant's artwork leaves the safe area.
 *
 * Called by the icon generator before it writes a single file, so a bad edit
 * cannot produce a half-updated icon set.
 */
export function assertLogoSafeArea(): void {
  for (const variant of ["full", "simple"] as const) {
    const { minX, minY, maxX, maxY } = logoShapeBounds(variant);
    const eps = 1e-6;
    if (
      minX < SAFE_BOX.min - eps ||
      minY < SAFE_BOX.min - eps ||
      maxX > SAFE_BOX.max + eps ||
      maxY > SAFE_BOX.max + eps
    ) {
      throw new Error(
        `logo ${variant} artwork leaves the safe area: ` +
          `x ${minX.toFixed(2)}..${maxX.toFixed(2)}, y ${minY.toFixed(2)}..${maxY.toFixed(2)}, ` +
          `allowed ${SAFE_BOX.min.toFixed(2)}..${SAFE_BOX.max.toFixed(2)}`,
      );
    }
  }
}

/** The mark as a standalone SVG string, for the generator and static pages. */
export function logoSvg(variant: LogoVariant = "full"): string {
  const { crossbar, stem, arrow } = logoShapes(variant);
  const points = arrow.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
  const parts = [
    `<rect width="48" height="48" rx="${LOGO_CORNER_RADIUS}" fill="${LOGO_BRAND}"/>`,
    `<rect x="${round(crossbar.x)}" y="${round(crossbar.y)}" width="${round(crossbar.w)}" height="${round(crossbar.h)}" rx="1.5" fill="#ffffff"/>`,
    `<rect x="${round(stem.x)}" y="${round(stem.y)}" width="${round(stem.w)}" height="${round(stem.h)}" rx="1.5" fill="#ffffff"/>`,
    `<polygon points="${points}" fill="#ffffff"/>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">\n  ${parts.join("\n  ")}\n</svg>\n`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
