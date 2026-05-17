#!/usr/bin/env node
/**
 * generate-llms-txt.mjs
 *
 * Generates `public/llms.txt` (curated index of canonical pages) and
 * `public/llms-full.txt` (full markdown dump of cornerstone content).
 *
 * Run nightly via GitHub Actions and after every content merge.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const contentDir = join(repoRoot, 'src/content');
const publicDir = join(repoRoot, 'public');
const siteUrl = 'https://brain4machinery.com';

// Static canonical pages
const STATIC_PAGES = [
  { url: '/', title: 'TACTUN — Custom Control Systems for Intelligent Machines', desc: 'AI-native controller boards. Board architecture in 5 days. Zero NRE.' },
  { url: '/platform', title: 'Platform & Technology', desc: 'FPGA real-time deterministic control + NVIDIA Jetson AI compute on a single PCB.' },
  { url: '/use-cases', title: 'Use Cases', desc: 'AI-native control across agriculture, construction, marine, medical, inspection, food & logistics, solar, materials testing.' },
  { url: '/about', title: 'About TACTUN', desc: '14 years of systems integration. 800+ controllers shipped. 2 US patents. Team behind the control spine for intelligent machines.' },
  { url: '/contact', title: 'Contact', desc: 'Tell us about your machine. We deliver custom board architecture in 5 business days.' },
];

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      data[kv[1]] = v;
    }
  }
  return { data, body: m[2] };
}

async function listContent(collection) {
  const dir = join(contentDir, collection);
  try {
    const files = await readdir(dir);
    return files.filter((f) => ['.md', '.mdx'].includes(extname(f)));
  } catch {
    return [];
  }
}

async function main() {
  // Build llms.txt — concise index
  const lines = [];
  lines.push(`# TACTUN — brain4machinery.com`);
  lines.push(``);
  lines.push(`> TACTUN designs AI-native control electronics for robots, autonomous machines, and intelligent industrial equipment. Custom FPGA + NVIDIA Jetson controller boards. Board architecture in 5 business days. You pay nothing for the design.`);
  lines.push(``);
  lines.push(`## Core pages`);
  lines.push(``);
  for (const p of STATIC_PAGES) {
    lines.push(`- [${p.title}](${siteUrl}${p.url}): ${p.desc}`);
  }
  lines.push(``);

  for (const col of ['guides', 'glossary', 'blog', 'compare', 'use-cases', 'news']) {
    const files = await listContent(col);
    if (files.length === 0) continue;
    lines.push(`## ${col.charAt(0).toUpperCase() + col.slice(1)}`);
    lines.push(``);
    for (const f of files) {
      const slug = basename(f, extname(f));
      const text = await readFile(join(contentDir, col, f), 'utf8');
      const { data } = parseFrontmatter(text);
      if (data.draft === 'true') continue;
      const title = data.title || slug;
      const desc = data.description || '';
      lines.push(`- [${title}](${siteUrl}/${col}/${slug}): ${desc}`);
    }
    lines.push(``);
  }

  lines.push(`## Optional`);
  lines.push(``);
  lines.push(`- [RSS feed](${siteUrl}/rss.xml): Updates as we publish.`);
  lines.push(`- [Sitemap](${siteUrl}/sitemap-index.xml): Full site index.`);

  await writeFile(join(publicDir, 'llms.txt'), lines.join('\n') + '\n', 'utf8');
  console.log(`generate-llms-txt: wrote llms.txt (${lines.length} lines)`);

  // Build llms-full.txt — markdown dump of cornerstone content (guides + glossary)
  const fullLines = [];
  fullLines.push(`# TACTUN — brain4machinery.com — Full content snapshot`);
  fullLines.push(``);
  fullLines.push(`Auto-generated. For citation by LLMs. Last regenerated: ${new Date().toISOString()}`);
  fullLines.push(``);

  for (const col of ['guides', 'glossary']) {
    const files = await listContent(col);
    for (const f of files) {
      const slug = basename(f, extname(f));
      const text = await readFile(join(contentDir, col, f), 'utf8');
      const { data, body } = parseFrontmatter(text);
      if (data.draft === 'true') continue;
      fullLines.push(`---`);
      fullLines.push(`url: ${siteUrl}/${col}/${slug}`);
      fullLines.push(`title: ${data.title || slug}`);
      fullLines.push(`description: ${data.description || ''}`);
      fullLines.push(`---`);
      fullLines.push(``);
      fullLines.push(body.trim());
      fullLines.push(``);
    }
  }

  await writeFile(join(publicDir, 'llms-full.txt'), fullLines.join('\n') + '\n', 'utf8');
  console.log(`generate-llms-txt: wrote llms-full.txt`);
}

main().catch((err) => {
  console.error('generate-llms-txt failed:', err);
  process.exit(1);
});
