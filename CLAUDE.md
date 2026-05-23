# Claude Code context — brain4machinery-website

## What this repo is

The public Astro site at brain4machinery.com. TACTUN's corporate site for AI-native control systems.

Content lives in `src/content/<collection>/*.mdx`. Static pages live in `src/pages/`. Visual system is ported verbatim from the legacy static HTML site — purple `#6D28D9`, Inter font, real product photos only.

## Hard rules

1. **Never publish content containing forbidden claims.** See `scripts/factual-linter.mjs`. The source of truth lives in the engine repo at `engine/style/forbidden_claims.yaml`. CI blocks merges that violate them.
2. **Never name the solar robotics customer publicly.**
3. **Never publish revenue figures, gross margins, or TAM/SAM/SOM.** The website is engineer-facing; numbers go on `/about` only if they're in the approved list (e.g., "800+ controllers shipped").
4. **Voice:** restrained, technical, engineer-to-engineer. No marketing fluff. See `engine/style/voice_guide.md` for the full guide.
5. **Migrate, don't redesign.** Phase 0 migrated 6 pages 1:1 to Astro. Don't redesign without a Strategist + Rafayel decision.
6. **Every content collection MUST be reachable from the home page.** When you add a new content collection (e.g., `src/content/case-studies/`), in the same PR you MUST update: (a) the "Browse by section" row in `src/pages/index.astro` to include the new collection's landing page, and (b) consider whether `src/components/Nav.astro` should also surface it. The home-page Insights cards auto-surface latest entries from all collections — but the LANDING page for each collection has to be hand-linked or visitors can't browse the whole section. Caught 2026-05-23 when the custom-jetson guide shipped but `/guides/` was unreachable from the home page.

## Routine tasks

- Add a blog post: write `src/content/blog/<slug>.mdx` with the frontmatter from `src/content/config.ts`.
- Add a glossary entry: same, in `src/content/glossary/`.
- Add a new page: create `src/pages/<name>.astro`, wrap content in `<BaseLayout>`.
- Regenerate `llms.txt` after content changes: `npm run build:llms`.

## Verification before commit

```sh
npm run check && npm run lint:facts && npm run build && npm run lint:links
```

## The engine

The agents that auto-publish to this repo live in the sibling [brain4machinery-engine](../brain4machinery-engine/) (private). The engine opens PRs to this repo via a fine-grained PAT. Look for PRs from `tactun-content-bot` — they'll have either the `auto-merge-ok` label (trivial, can be auto-merged by GH Actions) or `human-review` (Rafayel reviews).
