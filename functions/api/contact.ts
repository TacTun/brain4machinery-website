/**
 * Cloudflare Pages Function: POST /api/contact
 *
 * Receives the contact form payload, verifies the Cloudflare Turnstile
 * challenge (if configured), persists the submission to D1 (if bound),
 * forwards the message to contact@tactun.com via Resend, and optionally
 * pushes the submission to the tactun-core CRM (if its endpoint env vars
 * are set).
 *
 * To activate:
 *   1. Sign up at resend.com, verify the tactun.com domain.
 *   2. Add Cloudflare Pages env vars:
 *      - RESEND_API_KEY (secret)
 *      - CONTACT_TO_EMAIL (default: contact@tactun.com)
 *      - CONTACT_FROM_EMAIL (must match a verified domain, e.g. forms@brain4machinery.com)
 *      - PUBLIC_TURNSTILE_SITE_KEY (plaintext, exposed to client)
 *      - TURNSTILE_SECRET_KEY (secret)
 *      - TACTUN_CORE_URL (optional, e.g. https://core.tactun.com — when set,
 *        every submission is POSTed to {TACTUN_CORE_URL}/v1/inbound/contact-form)
 *      - TACTUN_CORE_INBOUND_KEY (secret, shared with the tactun-core endpoint)
 *   3. Create a D1 database and bind it as DB (see wrangler.toml + schema.sql).
 *   4. Redeploy.
 *
 * Every guard below is a soft-fail: until the env var / binding is set, the
 * corresponding feature is skipped so the form keeps working during phased setup.
 */

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TACTUN_CORE_URL?: string;
  TACTUN_CORE_INBOUND_KEY?: string;
  DB?: D1Database;
}

interface ContactPayload {
  name: string;
  email: string;
  company?: string;
  message: string;
}

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sanitize(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 5000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface CrmPushResult {
  ok: boolean;
  contactId?: string;
}

async function pushToCrm(
  url: string,
  inboundKey: string,
  payload: { name: string; email: string; company?: string; message: string; submissionId: number | null },
): Promise<CrmPushResult> {
  try {
    // The tactun-core endpoint is expected to be POST {TACTUN_CORE_URL}/v1/inbound/contact-form
    // with header X-Tactun-Inbound-Key, body { name, email, company, message, source, submission_id },
    // returning { contact_id: string }.
    const endpoint = `${url.replace(/\/+$/, '')}/v1/inbound/contact-form`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tactun-Inbound-Key': inboundKey,
      },
      body: JSON.stringify({
        name: payload.name,
        email: payload.email,
        company: payload.company ?? null,
        message: payload.message,
        source: 'brain4machinery.com',
        submission_id: payload.submissionId,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[contact-form] tactun-core CRM push failed:', res.status, errText.slice(0, 200));
      return { ok: false };
    }
    const data = (await res.json().catch(() => ({}))) as { contact_id?: string };
    return { ok: true, contactId: data.contact_id };
  } catch (err) {
    console.error('[contact-form] tactun-core CRM push threw:', err);
    return { ok: false };
  }
}

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as TurnstileVerifyResponse;
    return data.success === true;
  } catch (err) {
    console.error('[contact-form] Turnstile verify error:', err);
    return false;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const form = await context.request.formData();
    const payload: ContactPayload = {
      name: sanitize(form.get('name')),
      email: sanitize(form.get('email')),
      company: sanitize(form.get('company')) || undefined,
      message: sanitize(form.get('message')),
    };

    if (!payload.name || !payload.email || !payload.message) {
      return jsonResponse({ success: false, message: 'Please fill in all required fields.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return jsonResponse({ success: false, message: 'Please enter a valid email address.' }, 400);
    }

    const ip = context.request.headers.get('CF-Connecting-IP');
    const country = context.request.headers.get('CF-IPCountry');
    const userAgent = context.request.headers.get('User-Agent');

    let turnstilePassed = 0;
    const turnstileSecret = context.env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      const token = sanitize(form.get('cf-turnstile-response'));
      if (!token) {
        return jsonResponse({ success: false, message: 'Verification challenge missing. Please reload and try again.' }, 400);
      }
      const ok = await verifyTurnstile(turnstileSecret, token, ip);
      if (!ok) {
        return jsonResponse({ success: false, message: 'Verification failed. Please reload and try again.' }, 400);
      }
      turnstilePassed = 1;
    }

    let submissionId: number | null = null;
    if (context.env.DB) {
      try {
        const result = await context.env.DB
          .prepare(
            `INSERT INTO submissions (name, email, company, message, ip, country, user_agent, turnstile_passed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
          )
          .bind(
            payload.name,
            payload.email,
            payload.company ?? null,
            payload.message,
            ip,
            country,
            userAgent,
            turnstilePassed,
          )
          .first<{ id: number }>();
        submissionId = result?.id ?? null;
      } catch (err) {
        console.error('[contact-form] D1 insert error:', err);
      }
    }

    const apiKey = context.env.RESEND_API_KEY;
    const toEmail = context.env.CONTACT_TO_EMAIL ?? 'contact@tactun.com';
    const fromEmail = context.env.CONTACT_FROM_EMAIL ?? 'forms@brain4machinery.com';

    if (!apiKey) {
      console.log('[contact-form] RESEND_API_KEY not set. Submission:', JSON.stringify(payload), 'D1 id:', submissionId);
      return jsonResponse({ success: true });
    }

    const subject = `New brain4machinery.com inquiry from ${payload.name}`;
    const html = [
      `<h2>New inquiry from brain4machinery.com</h2>`,
      `<p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>`,
      payload.company ? `<p><strong>Company:</strong> ${escapeHtml(payload.company)}</p>` : '',
      `<p><strong>Message:</strong></p>`,
      `<blockquote style="border-left:3px solid #6D28D9;padding-left:1rem;color:#374151;">${escapeHtml(payload.message).replace(/\n/g, '<br>')}</blockquote>`,
    ]
      .filter(Boolean)
      .join('\n');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `brain4machinery contact form <${fromEmail}>`,
        to: [toEmail],
        reply_to: payload.email,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[contact-form] Resend error:', res.status, errText);
      return jsonResponse({ success: false, message: 'Could not send message. Please email contact@tactun.com directly.' }, 502);
    }

    if (submissionId !== null && context.env.DB) {
      try {
        const resendData = (await res.json()) as { id?: string };
        if (resendData.id) {
          await context.env.DB
            .prepare(`UPDATE submissions SET resend_id = ? WHERE id = ?`)
            .bind(resendData.id, submissionId)
            .run();
        }
      } catch (err) {
        console.error('[contact-form] Resend id update error:', err);
      }
    }

    // Phase 3a: optional auto-push to tactun-core CRM. Best-effort; never
    // blocks a successful submission. Activates when both env vars are set
    // AND the endpoint at {TACTUN_CORE_URL}/v1/inbound/contact-form exists.
    const coreUrl = context.env.TACTUN_CORE_URL;
    const coreKey = context.env.TACTUN_CORE_INBOUND_KEY;
    if (coreUrl && coreKey) {
      const crm = await pushToCrm(coreUrl, coreKey, {
        name: payload.name,
        email: payload.email,
        company: payload.company,
        message: payload.message,
        submissionId,
      });
      if (crm.ok && submissionId !== null && context.env.DB) {
        try {
          await context.env.DB
            .prepare(`UPDATE submissions SET status = 'crm_pushed', crm_contact_id = ? WHERE id = ?`)
            .bind(crm.contactId ?? null, submissionId)
            .run();
        } catch (err) {
          console.error('[contact-form] D1 crm_contact_id update error:', err);
        }
      }
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[contact-form] Handler crashed:', err);
    return jsonResponse({ success: false, message: 'Unexpected error. Please email contact@tactun.com directly.' }, 500);
  }
};
