/**
 * Cloudflare Pages Function: GET/POST /admin
 *
 * Lists contact-form submissions stored in D1 (binding `DB`) and supports
 * status updates (mark-spam, mark-replied, mark-crm-pushed).
 *
 * Auth: requires Cloudflare Access in front of /admin*. The function reads
 * the `Cf-Access-Authenticated-User-Email` header that Access injects after
 * a successful auth. Without that header the function returns 401 with
 * setup instructions.
 *
 * Set up Cloudflare Access:
 *   Zero Trust dashboard → Access → Applications → Add self-hosted app
 *     - Application domain: brain4machinery.com
 *     - Path: /admin*
 *     - Policy: Include — emails ending @tactun.com (or specific addresses)
 *     - Identity provider: Google SSO / One-time PIN
 */

interface Env {
  DB?: D1Database;
}

interface Submission {
  id: number;
  created_at: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  ip: string | null;
  country: string | null;
  user_agent: string | null;
  turnstile_passed: number;
  status: string;
  resend_id: string | null;
  crm_contact_id: string | null;
}

const VALID_STATUS = ['new', 'spam', 'replied', 'crm_pushed'] as const;
type Status = typeof VALID_STATUS[number];

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function requireAuth(request: Request): { email: string } | Response {
  // Cloudflare Access can identify the user in two ways:
  //   (a) the convenience header `Cf-Access-Authenticated-User-Email`
  //   (b) a signed JWT in `Cf-Access-Jwt-Assertion` (claims include the email)
  // Cloudflare strips any client-supplied Cf-* headers at the edge before the
  // request reaches us, so trusting these without re-verifying the signature
  // is safe inside a Pages Function fronted by an Access policy.
  let email =
    request.headers.get('Cf-Access-Authenticated-User-Email')?.trim() ||
    null;

  if (!email) {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (jwt) {
      const payload = decodeJwtPayload(jwt);
      const claim =
        (payload?.email as string | undefined) ??
        (payload?.identity as string | undefined) ??
        (payload?.sub as string | undefined) ??
        null;
      if (typeof claim === 'string' && claim.includes('@')) {
        email = claim.trim();
      }
    }
  }

  if (email) return { email };

  // No email could be derived. Dump the cf-* headers so we can see what
  // Access is (or isn't) sending.
  const cfHeaders: string[] = [];
  request.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('cf-')) {
      const v = value.length > 96 ? value.slice(0, 96) + '…' : value;
      cfHeaders.push(
        `<li><code>${escapeHtml(key)}</code>: <code>${escapeHtml(v)}</code></li>`,
      );
    }
  });
  const diagnostics = cfHeaders.length
    ? `<h3>Headers received (for debugging)</h3><ul>${cfHeaders.join('')}</ul>`
    : `<p><em>No <code>cf-*</code> headers reached this function — Cloudflare Access is not intercepting this URL. Check Zero Trust → Access → Applications: the application's domain must be <code>brain4machinery.com</code> and the path must be <code>/admin*</code> (or <code>admin*</code>).</em></p>`;

  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>Admin — not configured</title>
     <style>body{font-family:system-ui;max-width:720px;margin:4rem auto;color:#1f2937;line-height:1.5}
     code{background:#f3f4f6;padding:.15rem .4rem;border-radius:.25rem;font-size:.85em;word-break:break-all}
     ul{font-size:.85em}</style>
     <h1>Admin is locked.</h1>
     <p>This page is only reachable through Cloudflare Access. Until an Access
     policy is configured for <code>/admin*</code>, or until that policy is
     forwarding the authenticated user's identity, no one (including you) can
     reach the submission list.</p>
     <p>Set it up in Zero Trust → Access → Applications.</p>
     ${diagnostics}`,
    401,
  );
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(rows: Submission[], filterStatus: string, viewerEmail: string): string {
  const statusBadge = (s: string) => {
    const color = s === 'new' ? '#6D28D9' : s === 'spam' ? '#9ca3af' : s === 'replied' ? '#059669' : '#0369a1';
    return `<span style="background:${color};color:#fff;padding:.1rem .5rem;border-radius:.25rem;font-size:.75rem">${escapeHtml(s)}</span>`;
  };

  const filterLinks = ['all', ...VALID_STATUS]
    .map((s) => {
      const href = s === 'all' ? '/admin' : `/admin?status=${s}`;
      const active = (filterStatus === s) || (filterStatus === '' && s === 'all');
      const style = active ? 'font-weight:600;color:#6D28D9' : 'color:#6b7280';
      return `<a href="${href}" style="${style};margin-right:.75rem">${s}</a>`;
    })
    .join('');

  const rowsHtml = rows
    .map((r) => {
      const created = new Date(r.created_at + 'Z').toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
      const turnstile = r.turnstile_passed ? '✓' : '—';
      const resend = r.resend_id ? '✓' : '—';
      const crmPrompt = `Create a CRM contact: name="${escapeHtml(r.name)}", email="${escapeHtml(r.email)}", company="${escapeHtml(r.company)}". Then create an interaction of type \\"inbound_form\\" with body: ${escapeHtml(r.message).replace(/\n/g, ' \\\\n ')}. Source: brain4machinery.com (submission id ${r.id}).`;
      return `<tr>
        <td>${r.id}</td>
        <td><time>${escapeHtml(created)}</time></td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a></td>
        <td>${escapeHtml(r.company)}</td>
        <td><details><summary>view (${r.message.length} chars)</summary><pre style="white-space:pre-wrap;background:#f9fafb;padding:.75rem;border-radius:.25rem;max-width:48ch">${escapeHtml(r.message)}</pre></details></td>
        <td>${escapeHtml(r.country)}<br><small style="color:#9ca3af">${escapeHtml(r.ip)}</small></td>
        <td style="text-align:center">${turnstile}</td>
        <td style="text-align:center">${resend}</td>
        <td>${statusBadge(r.status)}</td>
        <td><div class="actions">
          <button data-action="mark-replied" data-id="${r.id}">replied</button>
          <button data-action="mark-spam" data-id="${r.id}">spam</button>
          <button data-action="push-crm" data-id="${r.id}" data-prompt="${escapeHtml(crmPrompt)}">push to CRM</button>
        </div></td>
      </tr>`;
    })
    .join('');

  const empty = rows.length === 0 ? '<p style="color:#6b7280">No submissions match this filter.</p>' : '';

  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8">
    <title>Contact submissions — brain4machinery admin</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:system-ui,-apple-system,sans-serif;margin:1.5rem;color:#1f2937}
      h1{font-size:1.25rem;margin:0 0 .5rem}
      .meta{color:#6b7280;font-size:.85rem;margin-bottom:1rem}
      .filters{margin-bottom:1rem}
      table{width:100%;border-collapse:collapse;font-size:.85rem}
      th,td{border-bottom:1px solid #e5e7eb;padding:.5rem;vertical-align:top;text-align:left}
      th{background:#f9fafb;font-weight:600}
      .actions{display:flex;flex-direction:column;gap:.25rem}
      .actions button{cursor:pointer;border:1px solid #d1d5db;background:#fff;padding:.25rem .5rem;border-radius:.25rem;font-size:.75rem}
      .actions button:hover{background:#f3f4f6}
      dialog{border:none;border-radius:.5rem;padding:1.5rem;max-width:36rem;box-shadow:0 10px 30px rgba(0,0,0,.2)}
      dialog textarea{width:100%;min-height:10rem;font-family:ui-monospace,monospace;font-size:.8rem;padding:.5rem}
      dialog .row{display:flex;gap:.5rem;margin-top:.75rem;align-items:center}
    </style>
  </head><body>
    <h1>Contact submissions</h1>
    <p class="meta">Logged in as <strong>${escapeHtml(viewerEmail)}</strong>. ${rows.length} row${rows.length === 1 ? '' : 's'} shown.</p>
    <div class="filters">${filterLinks}</div>
    ${empty}
    <table><thead><tr>
      <th>id</th><th>received</th><th>name</th><th>email</th><th>company</th>
      <th>message</th><th>country/IP</th><th>turnstile</th><th>resend</th><th>status</th><th>actions</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table>

    <dialog id="crm-dialog">
      <h2 style="margin-top:0;font-size:1rem">Push to CRM</h2>
      <p style="font-size:.85rem;color:#374151">Copy the prompt below, paste it into a Claude Code session that has the
      <code>tactun-core</code> MCP loaded, run it, then come back and click "Mark CRM-pushed".</p>
      <textarea id="crm-prompt" readonly></textarea>
      <div class="row">
        <button id="crm-copy">Copy</button>
        <button id="crm-mark">Mark CRM-pushed</button>
        <button id="crm-cancel">Close</button>
        <span id="crm-status" style="color:#059669;font-size:.85rem"></span>
      </div>
    </dialog>

    <script>
      const dialog = document.getElementById('crm-dialog');
      const promptEl = document.getElementById('crm-prompt');
      const statusEl = document.getElementById('crm-status');
      let currentId = null;

      async function postAction(action, id, extra) {
        const res = await fetch('/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, id, ...(extra || {}) }),
        });
        if (!res.ok) {
          alert('Action failed: ' + res.status);
          return false;
        }
        return true;
      }

      document.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const id = Number(btn.dataset.id);
          const action = btn.dataset.action;
          if (action === 'push-crm') {
            currentId = id;
            promptEl.value = btn.dataset.prompt;
            statusEl.textContent = '';
            dialog.showModal();
            return;
          }
          if (await postAction(action, id)) location.reload();
        });
      });

      document.getElementById('crm-copy').addEventListener('click', async () => {
        await navigator.clipboard.writeText(promptEl.value);
        statusEl.textContent = 'Copied. Paste into Claude.';
      });
      document.getElementById('crm-mark').addEventListener('click', async () => {
        if (currentId && await postAction('mark-crm-pushed', currentId)) {
          dialog.close();
          location.reload();
        }
      });
      document.getElementById('crm-cancel').addEventListener('click', () => dialog.close());
    </script>
  </body></html>`;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const auth = requireAuth(ctx.request);
  if (auth instanceof Response) return auth;

  if (!ctx.env.DB) {
    return htmlResponse(
      `<!doctype html><meta charset="utf-8"><title>Admin — D1 not bound</title>
       <h1>D1 binding missing.</h1>
       <p>Bind the <code>brain4machinery-contact</code> D1 database as <code>DB</code>
       in Cloudflare Pages → Settings → Functions. See <code>wrangler.toml</code>.</p>`,
      503,
    );
  }

  const url = new URL(ctx.request.url);
  const statusFilter = (url.searchParams.get('status') ?? '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

  let query: string;
  let params: unknown[];
  if (VALID_STATUS.includes(statusFilter as Status)) {
    query = `SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params = [statusFilter, limit, offset];
  } else {
    query = `SELECT * FROM submissions ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params = [limit, offset];
  }

  const result = await ctx.env.DB.prepare(query).bind(...params).all<Submission>();
  const rows = result.results ?? [];
  return htmlResponse(renderPage(rows, statusFilter, auth.email));
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const auth = requireAuth(ctx.request);
  if (auth instanceof Response) return auth;
  if (!ctx.env.DB) return jsonResponse({ success: false, message: 'DB not bound' }, 503);

  let body: { action?: string; id?: number; crm_contact_id?: string };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return jsonResponse({ success: false, message: 'Bad JSON' }, 400);
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse({ success: false, message: 'Invalid id' }, 400);
  }

  const ACTION_TO_STATUS: Record<string, Status> = {
    'mark-spam': 'spam',
    'mark-replied': 'replied',
    'mark-crm-pushed': 'crm_pushed',
  };
  const nextStatus = ACTION_TO_STATUS[body.action ?? ''];
  if (!nextStatus) {
    return jsonResponse({ success: false, message: 'Unknown action' }, 400);
  }

  if (nextStatus === 'crm_pushed' && body.crm_contact_id) {
    await ctx.env.DB
      .prepare(`UPDATE submissions SET status = ?, crm_contact_id = ? WHERE id = ?`)
      .bind(nextStatus, body.crm_contact_id, id)
      .run();
  } else {
    await ctx.env.DB
      .prepare(`UPDATE submissions SET status = ? WHERE id = ?`)
      .bind(nextStatus, id)
      .run();
  }
  return jsonResponse({ success: true });
};
