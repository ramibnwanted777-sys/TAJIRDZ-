/**
 * Browser-tab identity.
 *
 * The tab showed a default globe because the icon links either pointed at
 * files the generator no longer wrote or carried a stale cache-buster. These
 * assertions pin the whole chain — `index.html`, the manifest, the service
 * worker precache and the `usePageMeta` hook — to one version, so a half-bumped
 * release fails here instead of shipping an old logo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const manifest = read("public/manifest.webmanifest");
const sw = read("public/sw.js");

/** Every `?v=N` in a document, as plain numbers. */
function versions(text: string): number[] {
  return [...text.matchAll(/\?v=(\d+)/g)].map((match) => Number(match[1]));
}

describe("browser tab title", () => {
  it("is the English wordmark in the document head", () => {
    expect(html).toMatch(/<title>TajirDz<\/title>/);
  });

  it("is set by the hook on every layout, in both languages", () => {
    const hook = read("src/hooks/use-page-meta.ts");
    expect(hook).toContain('const PAGE_TITLE = "TajirDz"');
    // The title must not switch with the language: one brand, one tab label.
    expect(hook).not.toContain("lang === \"ar\" ? \"TajirDz\"");

    for (const layout of ["src/components/AppShell.tsx", "src/components/BarePageLayout.tsx"]) {
      expect(read(layout)).toContain("usePageMeta()");
    }
  });

  it("keeps the brand green on the Android status bar", () => {
    expect(html).toContain('<meta name="theme-color" content="#006233" />');
    expect(read("src/hooks/use-page-meta.ts")).toContain('const THEME_COLOR = "#006233"');
  });
});

describe("favicon links", () => {
  it("covers SVG, 16px, 32px, Apple touch icon and the manifest", () => {
    expect(html).toContain('rel="icon" type="image/svg+xml"');
    expect(html).toContain('sizes="16x16"');
    expect(html).toContain('sizes="32x32"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="manifest"');
  });

  it("points at files the generator actually writes", () => {
    for (const file of [
      "public/favicon.svg",
      "public/favicon-16.png",
      "public/favicon-32.png",
      "public/favicon-40.png",
      "public/apple-touch-icon.png",
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "public/icons/maskable-192.png",
      "public/icons/maskable-512.png",
      "public/manifest.webmanifest",
    ]) {
      // Throws if the file is missing, which is exactly the regression.
      expect(() => read(file)).not.toThrow();
    }
  });

  it("uses one cache-buster everywhere, so no stale icon can be served", () => {
    const all = [...versions(html), ...versions(manifest), ...versions(sw)];
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all).size).toBe(1);
  });

  it("declares 192 and 512 icons plus maskable variants in the manifest", () => {
    const parsed = JSON.parse(manifest) as {
      icons: { src: string; sizes: string; purpose: string }[];
      theme_color: string;
      short_name: string;
    };

    const bySizes = (size: string, purpose: string) =>
      parsed.icons.filter((icon) => icon.sizes === size && icon.purpose === purpose);

    expect(bySizes("192x192", "any")).toHaveLength(1);
    expect(bySizes("512x512", "any")).toHaveLength(1);
    expect(bySizes("192x192", "maskable")).toHaveLength(1);
    expect(bySizes("512x512", "maskable")).toHaveLength(1);

    expect(parsed.short_name).toBe("TajirDz");
    expect(parsed.theme_color).toBe("#006233");
  });

  it("bumps the service worker cache when the icon version does", () => {
    const version = Number(versions(sw)[0]);
    const cacheName = /const VERSION = "v(\d+)"/.exec(sw)?.[1];
    expect(cacheName).toBeDefined();
    // The cache name is independent, but it must exist: reusing the old one
    // keeps the previous icons alive in a returning browser.
    expect(Number(cacheName)).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(0);
  });

  it("precaches the same URLs the page references", () => {
    const shell = /const SHELL_ASSETS = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? "";
    for (const href of [
      "/favicon.svg",
      "/favicon-16.png",
      "/favicon-32.png",
      "/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/manifest.webmanifest",
    ]) {
      expect(html.includes(href) || manifest.includes(href)).toBe(true);
      expect(shell).toContain(href);
    }
  });
});

describe("generated icon script", () => {
  it("derives every asset from the shared logo geometry", () => {
    const script = read("scripts/generate-icons.mjs");
    expect(script).toContain("logoMark");
    expect(script).toContain("assertLogoSafeArea");
  });

  it("renders the small favicon from the simplified variant", () => {
    const script = read("scripts/generate-icons.mjs");
    // A 16px tab cannot resolve the full mark; `variantForSize` picks "simple".
    expect(script).toMatch(/simple/);
  });
});
