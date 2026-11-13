/**
 * Brand asset generator: the single source for every icon TajirDz ships.
 *
 * The mark geometry comes from `src/lib/logoMark.ts` — the very same module the
 * React component renders — so the SVG in the app and the PNG on the home
 * screen cannot drift apart. Re-run this after changing that file:
 *
 *   bun run icons
 *
 * Emits:
 *   public/logo.svg                full mark, for sharing and previews
 *   public/favicon.svg             simplified mark, vector (rendered at 16px)
 *   public/favicon-16.png          simplified mark (scaled up below 40px)
 *   public/favicon-32.png          simplified mark
 *   public/favicon-40.png          full mark
 *   public/apple-touch-icon.png    180x180, opaque, full mark
 *   public/icons/icon-192.png      192x192
 *   public/icons/icon-512.png      512x512
 *   public/icons/maskable-192.png  192x192, inside the maskable safe zone
 *   public/icons/maskable-512.png  512x512, artwork inside the maskable safe zone
 *   public/og-image.png            1200x630 social card with the English wordmark
 *
 * Uses a minimal built-in PNG encoder, so the script has no dependencies and
 * produces byte-identical output on every machine.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOGO_BRAND,
  LOGO_CORNER_RADIUS,
  LOGO_TILE,
  assertLogoSafeArea,
  logoShapes,
  logoSvg,
  variantForSize,
} from "../src/lib/logoMark.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const iconsDir = join(publicDir, "icons");

const GREEN = hexToRgb(LOGO_BRAND);
const WHITE = [0xff, 0xff, 0xff];
const TINT = [0xee, 0xf6, 0xf1];

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

// Refuse to write a half-updated icon set if the artwork has drifted outside
// the safe area. Better to fail the script than to ship a clipped favicon.
assertLogoSafeArea();

mkdirSync(iconsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Tiny PNG encoder (RGBA, no interlacing)
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  // Each scanline is prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Rasteriser: analytic shapes sampled with 4x4 supersampling
// ---------------------------------------------------------------------------

/** Rounded-rect containment test at a point. */
function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (radius === 0) return true;
  const dx = Math.min(x, w - x);
  const dy = Math.min(y, h - y);
  if (dx >= radius || dy >= radius) return true;
  return (radius - dx) ** 2 + (radius - dy) ** 2 <= radius * radius;
}

function insideRect(x, y, r, radius = 0) {
  return insideRoundedRect(x - r.x, y - r.y, r.w, r.h, radius);
}

/** Point-in-polygon (ray casting) for the arrowhead. */
function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Colour of the mark at a normalised point, or null for transparent.
 *
 * `padding` insets the whole artwork, which is how the maskable icon keeps its
 * content inside the safe zone every platform reserves.
 */
function sample(x, y, { padding = 0, variant }) {
  const s = LOGO_TILE;
  const u = x * s;
  const v = y * s;
  const radius = s - padding * 2;

  const px = u - padding;
  const py = v - padding;

  const scale = radius / s;
  const bx = px / scale;
  const by = py / scale;

  if (!insideRoundedRect(px, py, radius, radius, LOGO_CORNER_RADIUS * scale)) return null;

  const { crossbar, stem, arrow } = logoShapes(variant);

  // 1.5 is the same corner radius the React component and logoSvg() use, so
  // the raster and the vector outlines stay identical.
  if (insideRect(bx, by, crossbar, 1.5)) return WHITE;
  if (insideRect(bx, by, stem, 1.5)) return WHITE;
  if (insidePolygon(bx, by, arrow)) return WHITE;

  return GREEN;
}

function renderIcon(size, options) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling factor per axis
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = sample(x, y, options);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const idx = (py * size + px) * 4;
      const alpha = a / n;
      if (alpha > 0) {
        // Un-premultiply so edge pixels keep their colour.
        const covered = a / 255;
        rgba[idx] = Math.round(r / covered);
        rgba[idx + 1] = Math.round(g / covered);
        rgba[idx + 2] = Math.round(b / covered);
        rgba[idx + 3] = Math.round(alpha);
      }
    }
  }
  return encodePng(size, size, rgba);
}

// ---------------------------------------------------------------------------
// Social card (1200x630)
// ---------------------------------------------------------------------------

/**
 * "TajirDz" in a tiny built-in pixel face, so the card carries the English
 * wordmark without the generator needing a font engine. Every glyph is a
 * 5x9 cell: caps and ascenders fill rows 0-6, lowercase x-height rows 2-6,
 * descenders (j) reach row 8.
 */
const WORDMARK_FONT = {
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100", "00000", "00000"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111", "00000", "00000"],
  j: ["00110", "00000", "00010", "00010", "00010", "00010", "00010", "00010", "01100"],
  i: ["00100", "00000", "00100", "00100", "00100", "00100", "00100", "00000", "00000"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000", "00000", "00000"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110", "00000", "00000"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111", "00000", "00000"],
};

function renderWordmark(rgba, word, { x, y, pixel, colour }) {
  const w = 1200;
  const h = 630;
  let cursor = x;
  for (const char of word) {
    const glyph = WORDMARK_FONT[char];
    if (!glyph) {
      cursor += pixel * 3;
      continue;
    }
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] !== "1") continue;
        for (let dy = 0; dy < pixel; dy++) {
          for (let dx = 0; dx < pixel; dx++) {
            const px = cursor + col * pixel + dx;
            const py = y + row * pixel + dy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            const idx = (py * w + px) * 4;
            rgba[idx] = colour[0];
            rgba[idx + 1] = colour[1];
            rgba[idx + 2] = colour[2];
            rgba[idx + 3] = 255;
          }
        }
      }
    }
    cursor += (glyph[0].length + 1) * pixel;
  }
}

function renderSocial() {
  const w = 1200;
  const h = 630;
  const rgba = Buffer.alloc(w * h * 4);
  const bandTop = 120;
  const bandBottom = 420;
  const markSize = 240;
  const markX = Math.round((w - markSize) / 2);
  const markY = 150;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // White page with a soft green band behind the mark.
      const inBand = y >= bandTop && y < bandBottom;
      const c = inBand ? TINT : WHITE;
      rgba[idx] = c[0];
      rgba[idx + 1] = c[1];
      rgba[idx + 2] = c[2];
      rgba[idx + 3] = 255;

      const lx = (x - markX) / markSize;
      const ly = (y - markY) / markSize;
      if (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) {
        const mark = sample(lx, ly, { padding: 0, variant: "full" });
        if (mark) {
          rgba[idx] = mark[0];
          rgba[idx + 1] = mark[1];
          rgba[idx + 2] = mark[2];
        }
      }
    }
  }

  // "TajirDz" — the English wordmark, centred under the mark.
  const pixel = 13;
  const word = "TajirDz";
  const advance = 6 * pixel; // 5 columns + 1 spacing per glyph
  const wordWidth = word.length * advance - pixel;
  renderWordmark(rgba, word, {
    x: Math.round((w - wordWidth) / 2),
    y: 445,
    pixel,
    colour: GREEN,
  });

  // A brand-green rule under the wordmark, so the card reads as branded even
  // at the small size some chat apps crop the preview to.
  const ruleY = 590;
  for (let y = ruleY; y < ruleY + 6; y++) {
    for (let x = w / 2 - 60; x < w / 2 + 60; x++) {
      const idx = (y * w + x) * 4;
      rgba[idx] = GREEN[0];
      rgba[idx + 1] = GREEN[1];
      rgba[idx + 2] = GREEN[2];
      rgba[idx + 3] = 255;
    }
  }

  return encodePng(w, h, rgba);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** Small PNGs use the scaled-up mark; anything at 40px and up uses the full one. */
function icon(size, { padding = 0 } = {}) {
  return renderIcon(size, { padding, variant: variantForSize(size) });
}

const outputs = [
  // Standard icons: artwork fills the tile.
  ["icons/icon-192.png", icon(192)],
  ["icons/icon-512.png", icon(512)],
  ["favicon-16.png", icon(16)],
  ["favicon-32.png", icon(32)],
  ["favicon-40.png", icon(40)],
  ["apple-touch-icon.png", icon(180)],
  // Maskable: artwork inset so platform masks never clip the mark. Android
  // reserves ~20% of the tile, so the green field is padded past that.
  ["icons/maskable-192.png", renderIcon(192, { padding: 22, variant: "full" })],
  ["icons/maskable-512.png", renderIcon(512, { padding: 56, variant: "full" })],
  ["og-image.png", renderSocial()],
];

for (const [name, data] of outputs) {
  const target = join(publicDir, name);
  writeFileSync(target, data);
  console.log(`wrote ${name} (${data.length} bytes)`);
}

// Vector assets. Both are referenced from index.html / the web manifest, so
// they are written from the same geometry as the raster versions. The favicon
// gets the simplified variant: an SVG favicon is rasterised as small as 16px,
// where the full mark's stem and arrow start to blur together.
for (const [name, variant] of [
  ["logo.svg", "full"],
  ["favicon.svg", "simple"],
]) {
  const svg = logoSvg(variant);
  writeFileSync(join(publicDir, name), svg);
  console.log(`wrote ${name} (${variant})`);
}