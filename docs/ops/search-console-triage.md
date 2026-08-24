# Search Console triage — brain4machinery.com

**Audience:** whoever reads `admin@tactun.com`.
**Last updated:** 2026-08-24.

Google Search Console mails this property regularly about page-indexing
"issues". **Most of those emails need no action** — they describe non-canonical
URLs behaving exactly as intended. This page is the rule for telling the two
apart without re-investigating each time.

---

## TL;DR

1. **Look up the affected URL. Is it in `sitemap-0.xml`?**
   - **No** → almost certainly noise. Check the table below and archive.
   - **Yes** → worth investigating. A sitemap URL should always be indexable.
2. **The real alarm is the daily `indexing-health` run going red**, not the
   email. GSC mail arrives weeks-to-months after the fact; the monitor checks
   production every day.

---

## Which reasons to ignore

These describe URLs Google *correctly decided not to index*. The Page indexing
report is largely an inventory of such URLs, and it is **supposed** to be
populated.

| Reason | Why it's expected here |
|---|---|
| **Page with redirect** | The `www`, `http`, legacy `.html` and no-trailing-slash duplicates all 301/308 to their canonical form. That is the intended end state. |
| **Alternate page with proper canonical tag** | A duplicate URL correctly pointing at its canonical. |
| **Blocked by robots.txt** | `/api/`, `/admin` and `/contact.php` are disallowed on purpose (see below). |
| **Duplicate without user-selected canonical** | Google picked a canonical for a URL we don't advertise. |
| **Excluded by 'noindex' tag** | `/compare/` carries `noindex,nofollow` while the collection is empty (`astro.config.mjs` also drops it from the sitemap). |

## Which reasons to act on

Investigate when any of these hits a URL **that is in the sitemap**:

| Reason | Likely cause |
|---|---|
| **Not found (404)** | A published page didn't reach production — the failure mode `indexing-health` exists to catch. |
| **Server error (5xx)** | Cloudflare Pages or a Function is failing. |
| **Soft 404** | A page renders but is thin or empty. |
| **Crawled – currently not indexed** | Quality/thinness signal on a page we want ranked. |
| **Redirect error** | A redirect loop or chain that doesn't resolve. |

---

## "Excluded" is not "broken"

There is no configuration in which `/admin` or `/contact.php` disappear from
the Page indexing report. `/admin` must keep answering real admins, so it can't
return `410`; every available option — redirect, robots-blocked, `noindex` —
parks the URL in *some* excluded bucket. The bucket changes; the presence
doesn't.

⚠️ **A fix can therefore trigger a fresh "new reason" email.** `Disallow`
doesn't remove a URL from the report, it **moves** it. PR #51 disallowed
`/admin` and `/contact.php`, so both are expected to leave *Page with redirect*
and appear under *Blocked by robots.txt* — which, if that reason wasn't already
present on the property, GSC reports as a **new reason** and mails about.
Same template, different reason string, no actual problem.

## Why the "new reason" mails recur

They arrive in pairs, and both halves describe one re-crawl. On 2026-08-23 a
*"New reasons … Page with redirect"* mail landed in the same minute as
*"Page indexing issues successfully fixed — Alternate page with proper
canonical tag"* (6 → 2 affected, 4 validated). Those are the same URLs changing
bucket: duplicates that used to be served `200` + a canonical tag now
**redirect** instead, so Google reclassified them. A redirect is the *stronger*
signal — Google prefers it over canonical-only.

The same pair fired in **May 2026**, on **12/15 Jun 2026**, and again on
**23 Aug 2026** — routine aftermath of the trailing-slash work (PR #35) and the
sitemap alias (PR #49). Google's re-crawl lags the deploy by months, so the mail
always arrives long after the change that caused it.

**No `Validate Fix` click is needed for any of the ignore-list reasons.**

---

## The deliberate redirect inventory

Every redirect on this site is intentional. Verified against production
2026-08-24:

| From | To | Code |
|---|---|---|
| `www.brain4machinery.com/*` | apex | 301 (`functions/_middleware.ts`) |
| `http://*` | `https://*` | 301 (Cloudflare) |
| `/*.html` (legacy a2hosting) | clean path | 301 (`public/_redirects`) |
| `/path` (no trailing slash) | `/path/` | 308 (Astro `trailingSlash: 'always'`) |
| `/sitemap.xml` | `/sitemap-index.xml` | 301 |
| `/contact.php` | `/api/contact` | 308 (kept for legacy POSTs) |
| `/admin` | Cloudflare Access login | 302 |

`http://www.` → `https://www.` → apex is a **2-hop chain**. TLS terminates
before the Pages Function runs, so collapsing it needs a Cloudflare Redirect
Rule in the dashboard, not repo code. Cosmetic; left as is.

---

## Verifying by hand

If an email does look real, this is the check — it's what
`engine/tools/indexing_health.py` automates:

```bash
curl -s https://brain4machinery.com/sitemap-0.xml \
  | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' \
  | while read u; do
      printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"
    done
```

Every line must read `200`. (20 URLs as of 2026-08-24.)

⚠️ **Don't verify a `robots.txt` change on a Pages preview URL.** Cloudflare
replaces `robots.txt` wholesale on `*.pages.dev` with its own managed
content-signals policy — the repo's `User-agent`/`Disallow`/`Sitemap` lines are
absent entirely, so a robots-only PR looks like it did nothing. Diff
`dist/robots.txt` against `public/robots.txt` instead (Astro copies `public/`
verbatim), then re-check production after the merge deploy.

## Related

- [`deployment.md`](deployment.md) — hosting, deploy triggers, monitoring.
- `engine/tools/indexing_health.py` + `.github/workflows/indexing-health.yml`
  (engine repo) — the daily monitor, 13:17 UTC.
