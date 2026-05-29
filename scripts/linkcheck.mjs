#!/usr/bin/env node
/**
 * linkcheck.mjs
 *
 * Validates the built `dist/` HTML output before deploy:
 *   1. Internal <a href> links resolve (no 404s).
 *   2. Internal links are trailing-slash FINAL (no 308 redirects). The site is
 *      trailingSlash:'always', so a bare "/blog" 308-redirects to "/blog/".
 *      Google flags those as "Page with redirect" and wastes crawl budget.
 *   3. Referenced assets exist: <img src>, srcset candidates, and the
 *      og:image / twitter:image meta tags. A missing /assets/... file renders
 *      as a broken image and fails richer SERP/GEO extraction.
 *
 * Does NOT hit external URLs (too slow + flaky in CI). Run AFTER `astro build`.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const distDir = join(repoRoot, 'dist');
const SITE_HOST = 'brain4machinery.com';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// Classify an internal <a href>: 'ok' | 'broken' | 'redirect'
async function classifyHref(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return 'ok';
  const direct = join(distDir, clean);
  if (await isFile(direct)) return 'ok'; // e.g. /rss.xml, /sitemap-index.xml
  if (await isFile(direct + '.html')) return 'ok';
  if (await isFile(join(direct, 'index.html'))) {
    // Resolves as a directory page. Must end with "/" or it 308-redirects.
    if (!clean.endsWith('/') && extname(clean) === '') return 'redirect';
    return 'ok';
  }
  return 'broken';
}

// Resolve an asset reference (site-rooted or absolute same-host) to a dist file.
// Returns 'ok' | 'broken' | 'external' (external/relative are not our concern).
async function classifyAsset(ref) {
  let p = ref.trim();
  if (!p) return 'external';
  if (/^(data:|mailto:|tel:|javascript:)/i.test(p)) return 'external';
  if (/^https?:\/\//i.test(p)) {
    let u;
    try {
      u = new URL(p);
    } catch {
      return 'external';
    }
    if (u.host !== SITE_HOST) return 'external';
    p = u.pathname;
  }
  if (!p.startsWith('/')) return 'external'; // relative path — skip
  p = p.split('#')[0].split('?')[0];
  return (await isFile(join(distDir, p))) ? 'ok' : 'broken';
}

// Pull the URL candidates out of a srcset value: "a.png 1x, b.png 2x" -> [a,b]
function srcsetUrls(value) {
  return value
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
}

const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/gi;
const SRCSET_RE = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
const META_IMG_RE =
  /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*>/gi;
const CONTENT_RE = /\bcontent\s*=\s*["']([^"']+)["']/i;

async function main() {
  if (!(await isFile(join(distDir, 'index.html')))) {
    console.error(`linkcheck: dist/ not found or empty. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const broken = [];
  const redirects = [];
  const missingAssets = [];
  let totalLinks = 0;
  let totalAssets = 0;
  let filesScanned = 0;

  for await (const file of walk(distDir)) {
    if (extname(file) !== '.html') continue;
    filesScanned++;
    const html = await readFile(file, 'utf8');
    const rel = file.replace(distDir + '/', '');

    for (const m of html.matchAll(HREF_RE)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      if (!href.startsWith('/')) continue;
      totalLinks++;
      const cls = await classifyHref(href);
      if (cls === 'broken') broken.push({ from: rel, href });
      else if (cls === 'redirect') redirects.push({ from: rel, href });
    }

    const assetRefs = [];
    for (const m of html.matchAll(SRC_RE)) assetRefs.push(m[1]);
    for (const m of html.matchAll(SRCSET_RE)) assetRefs.push(...srcsetUrls(m[1]));
    for (const tag of html.matchAll(META_IMG_RE)) {
      const c = tag[0].match(CONTENT_RE);
      if (c) assetRefs.push(c[1]);
    }
    for (const ref of assetRefs) {
      const cls = await classifyAsset(ref);
      if (cls === 'external') continue;
      totalAssets++;
      if (cls === 'broken') missingAssets.push({ from: rel, ref });
    }
  }

  let failed = false;
  if (broken.length) {
    failed = true;
    console.error(`linkcheck: ${broken.length} broken internal link(s):`);
    for (const b of broken) console.error(`  ${b.from}  ->  ${b.href}`);
  }
  if (redirects.length) {
    failed = true;
    console.error(
      `linkcheck: ${redirects.length} internal link(s) missing a trailing slash (308 redirect):`
    );
    for (const r of redirects) console.error(`  ${r.from}  ->  ${r.href}  (use ${r.href}/)`);
  }
  if (missingAssets.length) {
    failed = true;
    console.error(`linkcheck: ${missingAssets.length} missing asset reference(s):`);
    for (const a of missingAssets) console.error(`  ${a.from}  ->  ${a.ref}`);
  }

  if (failed) process.exit(1);
  console.log(
    `linkcheck: scanned ${filesScanned} file(s), ${totalLinks} link(s) + ${totalAssets} asset(s) checked — all valid, all trailing-slash final.`
  );
}

main().catch((err) => {
  console.error('linkcheck failed:', err);
  process.exit(2);
});
