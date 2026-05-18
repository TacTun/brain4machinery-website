/**
 * Cloudflare Pages Function: POST /api/contact
 *
 * Receives the contact form payload, verifies the Cloudflare Turnstile
 * challenge (if configured), persists the submission to D1 (if bound),
 * and forwards the message to contact@tactun.com via Resend.
 *
 * To activate:
 *   1. Sign up at resend.com, verify the tactun.com domain.
 *   2. Add Cloudflare Pages env vars:
 *      - RESEND_API_KEY (secret)
 *      - CONTACT_TO_EMAIL (default: contact@tactun.com)
 *      - CONTACT_FROM_EMAIL (must match a verified domain, e.g. forms@brain4machinery.com)
 *      - PUBLIC_TURNSTILE_SITE_KEY (plaintext, exposed to client)
 *      - TURNSTILE_SECRET_KEY (secret)
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

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[contact-form] Handler crashed:', err);
    return jsonResponse({ success: false, message: 'Unexpected error. Please email contact@tactun.com directly.' }, 500);
  }
};
