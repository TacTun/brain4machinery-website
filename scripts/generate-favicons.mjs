#!/usr/bin/env node
// Rasterizes public/favicon.svg to PNG fallbacks for clients that
// don't support SVG favicons (older iOS Safari, some link previewers,
// Add-to-Homescreen tile generators). Run after editing favicon.svg:
//
//   node scripts/generate-favicons.mjs
//
// Outputs:
//   public/favicon-32.png       — standard fallback for browser tabs
//   public/apple-touch-icon.png — 180x180 for iOS home-screen
//
// Uses Playwright (already pulled in for rehype-mermaid SSR), so no
// new dependency.

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'public/favicon.svg');
const sizes = [
  { out: 'public/favicon-32.png', px: 32 },
  { out: 'public/apple-touch-icon.png', px: 180 },
];

const svg = await readFile(svgPath, 'utf8');
const browser = await chromium.launch();
try {
  for (const { out, px } of sizes) {
    const ctx = await browser.newContext({
      viewport: { width: px, height: px },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const html = `<!doctype html><html><body style="margin:0;background:transparent">
      <div style="width:${px}px;height:${px}px">${svg.replace(/width="[^"]*"\s*height="[^"]*"/, `width="${px}" height="${px}"`)}</div>
      </body></html>`;
    await page.setContent(html);
    const buf = await page.screenshot({ omitBackground: true, type: 'png' });
    await writeFile(join(root, out), buf);
    await ctx.close();
    console.log(`wrote ${out} (${px}x${px})`);
  }
} finally {
  await browser.close();
}
