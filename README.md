# brain4machinery-website

The public site at **https://brain4machinery.com**. TACTUN's corporate site for AI-native control systems for robots, autonomous machines, and intelligent industrial equipment.

Static Astro 4.x site. MDX content collections. Hosted on Cloudflare Pages.

## Quick start

```sh
npm install
npm run dev          # http://localhost:4321
```

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server (HMR) |
| `npm run build` | Build to `dist/` |
| `npm run preview` | Preview the built site |
| `npm run check` | TypeScript / Astro check |
| `npm run lint:facts` | Run the factual linter (forbidden-claims regex) |
| `npm run lint:links` | Validate internal links in `dist/` (run after build) |
| `npm run build:llms` | Regenerate `public/llms.txt` and `public/llms-full.txt` |

## Architecture

```
src/
├── content/         # MDX content collections — populated by the engine
│   ├── blog/        # Long-form posts
│   ├── guides/      # Cornerstone technical guides
│   ├── glossary/    # Definitional pages (GEO-rich)
│   ├── compare/     # "X vs Y" comparison pages
│   ├── use-cases/   # Vertical use-case pages
│   └── news/        # Short updates
├── components/      # Astro components (Nav, Footer, SEO, ComparisonTable)
├── layouts/         # BaseLayout, ArticleLayout
├── pages/           # Static + dynamic routes
│   ├── index.astro, platform.astro, use-cases.astro, about.astro, contact.astro, privacy.astro
│   ├── blog/[...slug].astro, guides/[...slug].astro, glossary/[...slug].astro, compare/[...slug].astro
│   └── rss.xml.js
└── styles/          # global.css (ported verbatim from legacy site)

public/
├── assets/          # Logos, board/team photos
├── scripts/main.js  # Sticky nav, hamburger, form handler
├── llms.txt         # LLM-citation index
├── llms-full.txt    # Full markdown dump of cornerstone content
├── robots.txt       # Allow-list for GPTBot, ClaudeBot, Google-Extended, etc.
├── _redirects       # Legacy /platform.html → /platform redirects
└── _headers         # Cache + security headers

functions/api/contact.ts   # Cloudflare Pages Function for contact form

scripts/
├── factual-linter.mjs     # Forbidden-claims regex scan
├── linkcheck.mjs          # Internal link validation
└── generate-llms-txt.mjs  # Build llms.txt + llms-full.txt
```

## Deployment

Pushes to `main` → GitHub Actions → Cloudflare Pages. See [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

### Required GitHub repo secrets

- `CLOUDFLARE_API_TOKEN` — token with Pages deploy permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID
- `ENGINE_DISPATCH_TOKEN` *(optional)* — PAT for notifying the engine repo on deploy

### Required repo variables

- `ENGINE_REPO` — e.g. `TACTUN/brain4machinery-engine` (the private engine repo)

## Contact form

The form posts to `/api/contact` (a Cloudflare Pages Function in `functions/api/contact.ts`). It forwards via Resend.

To activate, add Pages environment variables:
- `RESEND_API_KEY` (secret)
- `CONTACT_TO_EMAIL` (default `contact@tactun.com`)
- `CONTACT_FROM_EMAIL` (must match a verified Resend domain)

Until `RESEND_API_KEY` is set, the function returns success and logs the submission to Cloudflare logs (soft-fail mode — useful during initial setup).

## CI

Every PR runs `astro check`, `factual-linter`, `astro build`, and `linkcheck`. The factual linter blocks merges containing forbidden claims (e.g. `TAM`, `vibe-coding`, `10x faster`).

The full forbidden-claims source-of-truth is `forbidden_claims.yaml` in the [engine repo](../brain4machinery-engine/engine/style/forbidden_claims.yaml). The engine vendors it here on update.

## Initial setup checklist (Phase 0)

1. `npm install`
2. Create a new GitHub repo `brain4machinery-website`, push.
3. Sign up at https://dash.cloudflare.com → Pages → Create project → connect to GitHub → select this repo.
4. Add repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
5. In Cloudflare Pages project settings, add custom domain `brain4machinery.com` and follow DNS instructions (move nameservers OR add CNAME on a2hosting DNS).
6. (Optional) Resend setup for contact form: sign up, verify `tactun.com` domain, add `RESEND_API_KEY` to Pages env.
7. Verify all legacy URLs work via the redirects in `public/_redirects`.
