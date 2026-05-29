#!/usr/bin/env node
/**
 * factual-linter.mjs
 *
 * Scans MDX / Astro content for forbidden claims that must never appear
 * on brain4machinery.com. Single source of truth is forbidden_claims.yaml,
 * vendored from the engine repo.
 *
 * Exits non-zero on any match. Run in CI on every PR.
 *
 * Usage:
 *   node scripts/factual-linter.mjs                # full scan
 *   node scripts/factual-linter.mjs path/to/file   # single file scan
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

// FALLBACK rules — used ONLY if the vendored forbidden_claims.json is missing
// or unparseable. The real source of truth is engine/style/forbidden_claims.yaml,
// which the engine vendors to scripts/forbidden_claims.json on every content PR
// (see loadRules below). Keeping a fallback means CI never silently passes with
// zero rules. Each entry: { name, pattern, reason }.
const FALLBACK_FORBIDDEN = [
  { name: 'vibe-coding claim', pattern: /\bvibe[- ]coding\b/i, reason: 'Master Prompt: avoid "first vibe-coding controller"' },
  { name: 'no custom firmware', pattern: /no custom firmware/i, reason: 'Master Prompt: avoid "no custom firmware needed"' },
  { name: '10x faster claim', pattern: /\b10x faster\b/i, reason: 'Master Prompt: avoid "10x faster development"' },
  { name: '60-80% elimination', pattern: /60[\s\-–]?80\s*%[^\n]*(eliminat|development)/i, reason: 'Master Prompt: avoid "60-80% of development work eliminated"' },
  { name: 'TAM/SAM/SOM', pattern: /\b(TAM|SAM|SOM)\b/, reason: 'WEBSITE_PRD: no TAM/SAM/SOM on website (investor data)' },
  { name: '$46B figure', pattern: /\$\s*46\s*B/i, reason: 'Master Prompt: $46B TAM is investor-only' },
  { name: '$5M+ pipeline', pattern: /\$\s*5\s*M\+?\s*pipeline/i, reason: 'Master Prompt: avoid "$5M+ pipeline" on public site' },
  { name: '$100M ARR claim', pattern: /\$\s*100\s*M\s*ARR/i, reason: 'Master Prompt: avoid "$100M ARR from 170 customers"' },
  { name: '170 customers claim', pattern: /\b170\s*customers\b/i, reason: 'Master Prompt: avoid "$100M ARR from 170 customers"' },
  { name: 'subscription tomorrow', pattern: /subscription tomorrow/i, reason: 'Master Prompt: avoid "subscription tomorrow"' },
  { name: 'controller-as-a-service price', pattern: /controller[- ]as[- ]a[- ]service|\bcaaS\b/i, reason: 'Master Prompt: avoid "controller-as-a-service $1K"' },
  { name: '10 full-stack engineers', pattern: /10\s*full[- ]stack\s*engineers/i, reason: 'Master Prompt: avoid "10 full-stack engineers"' },
  { name: 'ruggedized at scale claim', pattern: /fully\s*ruggedized\s*field[- ]robotics\s*(platform|product)?\s*at\s*scale/i, reason: 'Master Prompt: do NOT claim ruggedized field-robotics platform at scale' },
  { name: 'Frank Bacon revenue mention', pattern: /Frank\s+Bacon[^.\n]*?\$/i, reason: 'Master Prompt: do not mention Frank Bacon revenue figure' },
  { name: 'solar customer name (placeholder)', pattern: /\b(SolarBotix|SunSweep|HelioRobotics)\b/, reason: 'Master Prompt: do NOT publicly name the solar robotics customer' },
  { name: 'revenue figure $200K on public page', pattern: /\$\s*200\s*[Kk]\s*(annual|revenue|in\s*revenue)/i, reason: 'WEBSITE_PRD: $200K revenue is investor-only' },
];

// The real rule set, vendored from the engine (forbidden_claims.json). Build
// RegExp objects from {pattern, flags}; fall back to the hardcoded list above
// if the file is missing/unparseable so CI is never left without rules.
async function loadRules() {
  try {
    const raw = await readFile(join(__dirname, 'forbidden_claims.json'), 'utf8');
    const data = JSON.parse(raw);
    const rules = (data.rules || [])
      .filter((r) => r && r.id && r.pattern)
      .map((r) => ({
        name: r.id,
        pattern: new RegExp(r.pattern, r.flags || ''),
        reason: r.reason || '',
      }));
    if (rules.length > 0) return rules;
    console.warn('factual-linter: forbidden_claims.json had no rules — using fallback list.');
  } catch (err) {
    console.warn(
      `factual-linter: could not load forbidden_claims.json (${err.message}) — using fallback list.`
    );
  }
  return FALLBACK_FORBIDDEN;
}

// Filename extensions to scan
const SCAN_EXTS = new Set(['.mdx', '.md', '.astro', '.html']);

// Directories to scan from repo root
const SCAN_DIRS = ['src/pages', 'src/content', 'src/components', 'public'];

const args = process.argv.slice(2);
const targets = args.length > 0 ? args.map((a) => resolve(a)) : null;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (entry.isFile() && SCAN_EXTS.has(extname(entry.name))) {
      yield full;
    }
  }
}

async function collectFiles() {
  if (targets) return targets;
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = join(repoRoot, dir);
    try {
      for await (const f of walk(full)) files.push(f);
    } catch {
      // skip missing dirs
    }
  }
  return files;
}

async function lintFile(file, rules) {
  const text = await readFile(file, 'utf8');
  const violations = [];
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (match) {
      // find line number
      const idx = text.indexOf(match[0]);
      const line = text.slice(0, idx).split('\n').length;
      violations.push({ rule: rule.name, reason: rule.reason, line, match: match[0] });
    }
  }
  return violations;
}

async function main() {
  const rules = await loadRules();
  const files = await collectFiles();
  let total = 0;
  for (const file of files) {
    const violations = await lintFile(file, rules);
    if (violations.length > 0) {
      const rel = file.replace(repoRoot + '/', '');
      for (const v of violations) {
        console.error(`${rel}:${v.line}  [${v.rule}]  matched "${v.match}"  — ${v.reason}`);
        total++;
      }
    }
  }
  if (total > 0) {
    console.error(`\nfactual-linter: ${total} forbidden-claim violation(s) found.`);
    process.exit(1);
  }
  console.log(
    `factual-linter: scanned ${files.length} file(s) against ${rules.length} rule(s), no forbidden claims found.`
  );
}

main().catch((err) => {
  console.error('factual-linter failed:', err);
  process.exit(2);
});
