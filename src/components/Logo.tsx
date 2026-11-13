/**
 * TajirDz logo.
 *
 * Every surface (header, footer, hero, auth, install prompt) renders this one
 * component, so the mark is always square, never stretched and never clipped:
 *
 *  - the size is fixed per variant (`xs` 24 / `sm` 36 / `md` 56 / `lg` 96) and
 *    applied as inline `width`/`height`, which a className cannot override, so
 *    a caller cannot accidentally squash it;
 *  - `shrink-0` stops the header flex row from squeezing it at 320px;
 *  - `aspect-square` keeps the box square if a parent sets one dimension;
 *  - the geometry comes from `@/lib/logoMark`, the same source the PNG
 *    generator uses, and already respects a 12% safe area.
 *
 * Below 40px the simplified variant scales the whole mark up, because the
 * arrowhead needs raw pixels to stay crisp at 24.
 */

import { cn } from "@/lib/utils";
import {
  LOGO_CORNER_RADIUS,
  LOGO_TILE,
  logoShapes,
  variantForSize,
} from "@/lib/logoMark";

export type LogoSize = "xs" | "sm" | "md" | "lg";

/** The only sizes the logo is allowed to take, in CSS pixels. */
export const LOGO_SIZES: Record<LogoSize, number> = {
  xs: 24,
  sm: 36,
  md: 56,
  lg: 96,
};

export function Logo({
  size = "md",
  className,
  label,
}: {
  size?: LogoSize;
  className?: string;
  /** Accessible name. Decorative instances inside a labelled link can pass null. */
  label?: string | null;
}) {
  const pixels = LOGO_SIZES[size];
  const shapes = logoShapes(variantForSize(pixels));

  return (
    <svg
      viewBox={`0 0 ${LOGO_TILE} ${LOGO_TILE}`}
      style={{ width: pixels, height: pixels }}
      className={cn("shrink-0 aspect-square drop-shadow-sm select-none", className)}
      role={label === null ? "presentation" : "img"}
      aria-label={label === null ? undefined : (label ?? "TajirDz")}
      aria-hidden={label === null ? true : undefined}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`tajir-bg-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#007e42" />
          <stop offset="60%" stopColor="#006233" />
          <stop offset="100%" stopColor="#004724" />
        </linearGradient>
        <linearGradient id={`tajir-glow-${size}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`tajir-shadow-${size}`} x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="0.6" floodColor="#002e17" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Primary Brand Emerald Rounded Tile with depth gradient */}
      <rect
        width={LOGO_TILE}
        height={LOGO_TILE}
        rx={LOGO_CORNER_RADIUS}
        fill={`url(#tajir-bg-${size})`}
      />

      {/* Subtle top gloss sheen for high-end polish */}
      <rect
        x="1.5"
        y="1.5"
        width={LOGO_TILE - 3}
        height={LOGO_TILE * 0.48}
        rx={LOGO_CORNER_RADIUS - 1}
        fill={`url(#tajir-glow-${size})`}
      />

      {/* Elegant inner bevel outline */}
      <rect
        x="0.75"
        y="0.75"
        width={LOGO_TILE - 1.5}
        height={LOGO_TILE - 1.5}
        rx={LOGO_CORNER_RADIUS - 0.5}
        stroke="#ffffff"
        strokeOpacity="0.2"
        strokeWidth="1.2"
        fill="none"
      />

      {/* The "T" & Trade Arrow mark with crisp shadow */}
      <g filter={`url(#tajir-shadow-${size})`}>
        <rect
          x={shapes.crossbar.x}
          y={shapes.crossbar.y}
          width={shapes.crossbar.w}
          height={shapes.crossbar.h}
          rx={2}
          fill="#ffffff"
        />
        <rect
          x={shapes.stem.x}
          y={shapes.stem.y}
          width={shapes.stem.w}
          height={shapes.stem.h}
          rx={2}
          fill="#ffffff"
        />
        <polygon
          points={shapes.arrow.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}

/** Mark plus name, for the hero, header and footer. */
export function LogoWordmark({
  size = "md",
  className,
  name,
  nameClassName,
  subtitle,
}: {
  size?: LogoSize;
  className?: string;
  name: string;
  nameClassName?: string;
  subtitle?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo size={size} label={null} />
      <span className="flex flex-col leading-tight text-start">
        <span className={cn("truncate font-black tracking-tight text-neutral-900 text-base md:text-lg", nameClassName)}>
          {name}
        </span>
        {subtitle && (
          <span className="text-[10px] font-semibold text-[#006233] tracking-wide">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}