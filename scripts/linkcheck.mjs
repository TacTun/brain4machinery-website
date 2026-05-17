#!/usr/bin/env node
/**
 * linkcheck.mjs
 *
 * Validates internal links in built `dist/` HTML output. Catches broken /paths
 * before deploy. Does NOT hit external URLs (too slow + flaky in CI).
 *
 * Run AFTER `astro build`.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const distDir = join(repoRoot, 'dist');

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveInternalLink(href) {
  // Strip query and hash
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return true; // pure-fragment link (#section) is fine

  // Try direct file match
  const direct = join(distDir, clean);
  if (await pathExists(direct)) return true;

  // Try with .html appended
  if (await pathExists(direct + '.html')) return true;

  // Try as directory with index.html
  if (await pathExists(join(direct, 'index.html'))) return true;

  return false;
}

const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/gi;

async function main() {
  if (!(await pathExists(distDir))) {
    console.error(`linkcheck: dist/ not found. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const broken = [];
  let totalLinks = 0;
  let filesScanned = 0;

  for await (const file of walk(distDir)) {
    if (extname(file) !== '.html') continue;
    filesScanned++;
    const html = await readFile(file, 'utf8');
    const rel = file.replace(distDir + '/', '');

    for (const match of html.matchAll(HREF_RE)) {
      const href = match[1];
      totalLinks++;
      // Skip external, mailto, tel, javascript
      if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      // Only validate site-rooted internal links
      if (!href.startsWith('/')) continue;
      const ok = await resolveInternalLink(href);
      if (!ok) broken.push({ from: rel, href });
    }
  }

  if (broken.length > 0) {
    console.error(`linkcheck: ${broken.length} broken internal link(s):`);
    for (const b of broken) console.error(`  ${b.from}  ->  ${b.href}`);
    process.exit(1);
  }
  console.log(`linkcheck: scanned ${filesScanned} file(s), ${totalLinks} link(s) checked, all internal links valid.`);
}

main().catch((err) => {
  console.error('linkcheck failed:', err);
  process.exit(2);
});
