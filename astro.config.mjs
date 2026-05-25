import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypeMermaid from 'rehype-mermaid';

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
    rehypePlugins: [[rehypeMermaid, mermaidOptions]],
  },
  integrations: [
    mdx({
      rehypePlugins: [[rehypeMermaid, mermaidOptions]],
    }),
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
});
