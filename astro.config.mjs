import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypeMermaid from 'rehype-mermaid';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// rehype-mermaid with strategy:'inline-svg' renders ```mermaid blocks to
// inline SVG at build time via a headless Chromium (Playwright). Zero runtime
// JS — pure SVG shipped to readers. CI installs chromium before `astro build`.
//
// `excludeLangs: ['mermaid']` is critical: Astro's built-in Shiki highlighter
// would otherwise transform ```mermaid blocks into <pre class="astro-code">
// before rehype-mermaid runs, and rehype-mermaid wouldn't recognize them.
// Skipping Shiki for mermaid leaves <pre><code class="language-mermaid"> intact
// for rehype-mermaid to convert.
const mermaidOptions = {
  strategy: 'inline-svg',
  mermaidConfig: {
    theme: 'neutral', // theme-agnostic — works in both light + dark modes
  },
};

// rehype-mermaid emits each diagram as <svg width="100%" style="max-width:Npx">,
// which shrinks-to-fit the ~760px article column. A wide flowchart (e.g. a
// decision tree at 1455px) then scales to ~48% and its labels become unreadable.
// This plugin wraps every mermaid SVG in a <div class="mermaid-scroll"> and pins
// the SVG to its natural viewBox width, so CSS can render it at legible size and
// scroll horizontally (and break out past the text column) instead of shrinking.
function rehypeMermaidScroll() {
  return (tree) => {
    const wrap = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.map((child) => {
        if (
          child.type === 'element' &&
          child.tagName === 'svg' &&
          child.properties &&
          typeof child.properties.id === 'string' &&
          child.properties.id.startsWith('mermaid-')
        ) {
          const vb = String(child.properties.viewBox || child.properties.viewbox || '')
            .trim()
            .split(/\s+/);
          const w = parseFloat(vb[2]);
          delete child.properties.width; // drop width="100%"
          child.properties.style = Number.isFinite(w)
            ? `width:${Math.ceil(w)}px;max-width:${Math.ceil(w)}px;height:auto;`
            : 'height:auto;';
          return {
            type: 'element',
            tagName: 'div',
            properties: { className: ['mermaid-scroll'] },
            children: [child],
          };
        }
        wrap(child);
        return child;
      });
    };
    wrap(tree);
  };
}

// --- Sitemap lastmod from real content dates -------------------------------
// @astrojs/sitemap otherwise stamps every URL with the build time, which sends
// search engines a noisy "everything changed" signal. We map each
// /collection/slug/ to its frontmatter updatedDate||publishedDate, and fall
// back to build time only for static pages that have no content date.
const BUILD_TIME = new Date().toISOString();
const contentRoot = fileURLToPath(new URL('./src/content', import.meta.url));

function listDirs(p) {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
function listContentFiles(p) {
  try {
    return readdirSync(p).filter((f) => /\.mdx?$/.test(f));
  } catch {
    return [];
  }
}

const CONTENT_LASTMOD = new Map();
for (const col of listDirs(contentRoot)) {
  for (const file of listContentFiles(`${contentRoot}/${col}`)) {
    const slug = file.replace(/\.mdx?$/, '');
    const fm = readFileSync(`${contentRoot}/${col}/${file}`, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const raw = (fm[1].match(/^updatedDate:\s*(.+)$/m) || fm[1].match(/^publishedDate:\s*(.+)$/m) || [])[1];
    const d = raw ? new Date(raw.trim().replace(/^['"]|['"]$/g, '')) : null;
    if (d && !Number.isNaN(d.getTime())) CONTENT_LASTMOD.set(`/${col}/${slug}/`, d.toISOString());
  }
}

// The compare landing page is excluded from the sitemap while the collection
// is empty (thin page). It auto-returns once a comparison is published.
const COMPARE_EMPTY = listContentFiles(`${contentRoot}/compare`).length === 0;

export default defineConfig({
  site: 'https://brain4machinery.com',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid'],
    },
    rehypePlugins: [[rehypeMermaid, mermaidOptions], rehypeMermaidScroll],
  },
  integrations: [
    mdx({
      rehypePlugins: [[rehypeMermaid, mermaidOptions], rehypeMermaidScroll],
    }),
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      filter: (page) => !(COMPARE_EMPTY && page === 'https://brain4machinery.com/compare/'),
      serialize(item) {
        try {
          const path = new URL(item.url).pathname;
          item.lastmod = CONTENT_LASTMOD.get(path) || BUILD_TIME;
        } catch {
          item.lastmod = BUILD_TIME;
        }
        return item;
      },
    }),
  ],
});
