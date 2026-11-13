/**
 * Sitemap generator.
 *
 * Pulls every publicly reachable product and shop from the Convex deployment
 * and writes public/sitemap.xml. Run after seeding or whenever content
 * changes:
 *
 *   VITE_CONVEX_URL=https://<deployment>.convex.cloud \
 *   SITE_URL=https://<public-host> bun scripts/generate-sitemap.mjs
 *
 * Both URLs come from the environment, never from a committed file.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";

const SITE = (process.env.SITE_URL ?? "https://tajirdz.freebuff.app").replace(
  /\/+$/,
  "",
);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const convexUrl = process.env.VITE_CONVEX_URL;
if (!convexUrl) {
  console.error(
    "VITE_CONVEX_URL is not set. Export it before running this script:\n" +
      "  VITE_CONVEX_URL=https://<deployment>.convex.cloud \\\n" +
      "  SITE_URL=https://<public-host> bun scripts/generate-sitemap.mjs",
  );
  process.exit(1);
}

const client = new ConvexHttpClient(convexUrl);

// `sitemapEntries` applies the same isActive + live-subscription rule as the
// product and shop pages themselves, so every URL below is actually renderable.
const { products = [], shops = [] } = await client.query(
  "catalog:sitemapEntries",
  { limit: 5000 },
);

const staticPaths = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/search", priority: "0.8", changefreq: "daily" },
  { path: "/how-it-works", priority: "0.6", changefreq: "monthly" },
  { path: "/faq", priority: "0.6", changefreq: "monthly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/refund", priority: "0.3", changefreq: "yearly" },
];

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Slugs are Arabic, so they are percent-encoded before going into a <loc>.
const url = (path) => new URL(path, `${SITE}/`).href.replace(/&/g, "&amp;");

const urls = [
  ...staticPaths.map(({ path, priority, changefreq }) => ({
    loc: url(path),
    changefreq,
    priority,
  })),
  ...products.map((product) => ({
    loc: url(`/product/${encodeURIComponent(product.slug)}`),
    lastmod: day(product.updatedAt),
    changefreq: "weekly",
    priority: product.isWinning ? "0.9" : "0.7",
  })),
  ...shops.map((shop) => ({
    loc: url(`/shop/${encodeURIComponent(shop.slug)}`),
    lastmod: day(shop.createdAt),
    changefreq: "weekly",
    priority: "0.6",
  })),
];

const today = day(Date.now());
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod ?? today}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

writeFileSync(join(root, "public", "sitemap.xml"), xml, "utf8");
console.log(
  `wrote public/sitemap.xml: ${urls.length} URLs ` +
    `(${products.length} products, ${shops.length} shops)`,
);
