# Deployment & ops — brain4machinery.com

Non-secret reference for how this site builds, deploys, and is guarded. No
tokens or secret values live here — only names and behavior.

## Hosting

- **Cloudflare Pages**, project **`brain4machinery-website`**.
- Production domain: `https://brain4machinery.com` (apex). `www` and `http`
  redirect to the apex over https.
- Deploys run from **GitHub Actions** (`.github/workflows/deploy.yml`) via
  `cloudflare/wrangler-action` (`pages deploy dist`). We do **not** use
  Cloudflare's native Git integration — the build needs Playwright/Chromium to
  render `mermaid` blocks to inline SVG (`rehype-mermaid`), which the Action
  installs explicitly.

## Build

`npm ci` → `npx playwright install --with-deps chromium` → `npm run build`
(Astro, `output: directory`, `trailingSlash: 'always'`). The link checker scans
the built `dist/` HTML.

## Deploy triggers

| Event | Result |
|---|---|
| push to `main` (human/PAT merge) | **production** deploy (`--branch=main`) |
| `workflow_dispatch` on `main` | production deploy (used by the deploy watchdog below) |
| push to `article/**`, or any PR | **preview** deploy at `<branch>.brain4machinery-website.pages.dev` |

**Production gate:** on production, `lint:facts` + `lint:links` run **before**
the Cloudflare publish, so broken facts/links can't go live. Previews publish
*before* lint so a reviewer can inspect a broken article in context.

**The GITHUB_TOKEN deploy gap (important):** a PR merged by the auto-merge
workflow uses `GITHUB_TOKEN`, and GitHub's loop-prevention emits **no events**
for that merge — not the `push:main` that `deploy.yml` listens for, and not a
`pull_request: closed` either. So neither `deploy.yml` nor any event-triggered
listener fires for a bot merge. (An earlier `deploy-on-merge.yml` tried the
`pull_request_target: closed` route; it was suppressed for the same reason and
silently never ran for bot merges — which is what left a merged guide 404 in
production, confirmed again on PR #41, 2026-06-04.)

`.github/workflows/deploy-on-merge.yml` now covers this as a **scheduled
watchdog** (every 15 min): it checks whether main's current HEAD already has a
production deploy run and, if not, dispatches `deploy.yml` via
`workflow_dispatch` (the one event type allowed from a `GITHUB_TOKEN` context).
It is merge-method-agnostic — human/PAT merges deploy instantly via `push:main`
and the watchdog then finds nothing to do; bot merges go live within ~one
interval. A given SHA is dispatched at most once, so a failing deploy can't
loop (its failure surfaces in the engine's failing-workflow digest instead).

## Branch protection & review

- `main` requires the **`build`** status check (the CI workflow:
  `astro check` + `lint:facts` + `build` + `lint:links`). A red PR cannot merge.
- **No required human review.** `.github/workflows/agent-review.yml` runs an
  independent Claude review on every PR and posts a verdict. To enforce it as a
  no-human merge gate: add an `ANTHROPIC_API_KEY` repo secret, then add
  `agent-review` to the required status checks. Until the secret exists,
  agent-review passes neutrally so it can't block the pipeline.
- `auto-merge.yml` enables GitHub native auto-merge for PRs labeled
  `auto-merge-ok` (applied by the engine's PR Builder). It waits for the
  required checks, then squash-merges.

## Secrets & variables (names only)

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Variables: `ENGINE_REPO` (= `TacTun/brain4machinery-engine`).
- Optional / not yet set: `ENGINE_DISPATCH_TOKEN` (engine "website-deployed"
  notifier — the notify step is skipped while unset), `ANTHROPIC_API_KEY`
  (enables the agent-review gate).

## Forbidden-claims rules (one source of truth)

`engine/style/forbidden_claims.yaml` (engine repo) is the source of truth. The
engine vendors it to **`scripts/forbidden_claims.json`** on every content PR;
`scripts/factual-linter.mjs` reads that JSON (falling back to a hardcoded list
if the file is missing, unparseable, or empty). Edit rules in the engine YAML,
never here.

## Monitoring

- Engine `indexing-health.yml` (daily) checks every live sitemap URL for 404s,
  redirects, and canonical mismatches, enriched with the GSC URL Inspection API.
- Post-deploy smoke: the website dispatches `website-deployed` to the engine,
  which re-runs the live check against production and alerts on any problem.

**Google Search Console mail is not a monitor.** It arrives weeks-to-months
after the fact and most of it needs no action. See
[`search-console-triage.md`](search-console-triage.md) for which reasons to
ignore, which to act on, and why "fixing" one can trigger a fresh notice.
