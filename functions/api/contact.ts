/**
 * Cloudflare Pages Function: POST /api/contact
 *
 * Receives the contact form payload and forwards it to Rafayel's inbox
 * via Resend (https://resend.com — generous free tier).
 *
 * To activate:
 *   1. Sign up at resend.com, verify the tactun.com domain.
 *   2. Add Cloudflare Pages env vars:
 *      - RESEND_API_KEY (secret)
 *      - CONTACT_TO_EMAIL (default: contact@tactun.com)
 *      - CONTACT_FROM_EMAIL (must match a verified domain, e.g. forms@brain4machinery.com)
 *   3. Redeploy.
 *
 * Until env vars are set, this function returns success but logs the
 * submission to Cloudflare logs — so the form is non-blocking during setup.
 */

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
}

interface ContactPayload {
  name: string;
  email: string;
  company?: string;
  message: string;
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

    const apiKey = context.env.RESEND_API_KEY;
    const toEmail = context.env.CONTACT_TO_EMAIL ?? 'contact@tactun.com';
    const fromEmail = context.env.CONTACT_FROM_EMAIL ?? 'forms@brain4machinery.com';

    if (!apiKey) {
      // Soft-fail mode: log the submission, return success.
      console.log('[contact-form] RESEND_API_KEY not set. Submission:', JSON.stringify(payload));
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

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[contact-form] Handler crashed:', err);
    return jsonResponse({ success: false, message: 'Unexpected error. Please email contact@tactun.com directly.' }, 500);
  }
};
