/**
 * Email Service — transactional email delivery via SMTP.
 *
 * When SMTP_HOST is not set the service runs in "disabled" mode:
 * no emails are sent but tokens are generated and logged to the console
 * (for development environments).
 *
 * Supported email types:
 *   - Email verification (signup verify)
 *   - Password reset
 *   - Magic link
 */

import nodemailer from "nodemailer";
import { config } from "../config/env.js";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.SMTP_HOST) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined,
  });

  return transporter;
}

/**
 * Sends an email. Writes to the console in development mode when SMTP is not configured.
 */
export async function sendEmail(opts: EmailOptions): Promise<void> {
  const t = getTransporter();

  if (!t) {
    // Dev mode: no SMTP, log the token
    console.log(`[EmailService] SMTP not configured — would send email:`);
    console.log(`  To:      ${opts.to}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Body:    ${opts.text ?? "(html only)"}`);
    return;
  }

  await t.sendMail({
    from: config.SMTP_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

// ── Email templates ───────────────────────────────────────────────────────────

export function buildVerifyEmail(opts: {
  appUrl: string;
  database: string;
  token: string;
  email: string;
}): EmailOptions {
  const url = `${opts.appUrl}/db/${opts.database}/auth/verify?token=${opts.token}`;
  return {
    to: opts.email,
    subject: "Verify your email address",
    text: `Click this link to verify your email address: ${url}`,
    html: emailTemplate({
      title: "Email Verification",
      preheader: "Activate your Postgrify account.",
      body: `
        <p>Hello,</p>
        <p>Click the button below to verify your email address.</p>
        <p>This link is valid for <strong>24 hours</strong>.</p>
      `,
      ctaUrl: url,
      ctaText: "Verify my email address",
    }),
  };
}

export function buildPasswordResetEmail(opts: {
  appUrl: string;
  database: string;
  token: string;
  email: string;
  redirectTo?: string;
}): EmailOptions {
  const params = new URLSearchParams({ token: opts.token });
  if (opts.redirectTo) params.set("redirect_to", opts.redirectTo);
  // Link goes to app reset UI (or API verify path); keep token + optional redirect_to
  const url = `${opts.appUrl}/reset-password?${params.toString()}&database=${encodeURIComponent(opts.database)}`;
  return {
    to: opts.email,
    subject: "Password reset request",
    text: `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`,
    html: emailTemplate({
      title: "Password reset",
      preheader: "Reset your password",
      body: `
        <p>Hello,</p>
        <p>We received a request to reset your password.</p>
        <p style="color:#888;font-size:12px;">If you did not request this, you can ignore this email.</p>
      `,
      ctaUrl: url,
      ctaText: "Reset password",
    }),
  };
}

export function buildMagicLinkEmail(opts: {
  appUrl: string;
  database: string;
  token: string;
  email: string;
}): EmailOptions {
  const url = `${opts.appUrl}/db/${opts.database}/auth/magic-link/verify?token=${opts.token}`;
  return {
    to: opts.email,
    subject: "Your sign-in link",
    text: `Click this link to sign in: ${url}\n\nThis link is valid for 15 minutes.`,
    html: emailTemplate({
      title: "Passwordless Sign-In",
      preheader: "Sign in with a single click.",
      body: `
        <p>Hello,</p>
        <p>Click the button below to sign in without a password.</p>
        <p>This link is valid for <strong>15 minutes</strong> and can only be used once.</p>
      `,
      ctaUrl: url,
      ctaText: "Sign In",
    }),
  };
}

// ── HTML template helper ─────────────────────────────────────────────────────

function emailTemplate(opts: {
  title: string;
  preheader: string;
  body: string;
  ctaUrl: string;
  ctaText: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${opts.preheader}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:40px;">
          <tr>
            <td style="padding-bottom:24px;border-bottom:1px solid #27272a;margin-bottom:24px;">
              <span style="font-size:20px;font-weight:700;color:#fafafa;">◈ Postgrify</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;">
              <h1 style="font-size:18px;font-weight:600;color:#fafafa;margin:0 0 16px;">${opts.title}</h1>
              <div style="font-size:14px;color:#a1a1aa;line-height:1.6;">
                ${opts.body}
              </div>
              <div style="margin:28px 0;">
                <a href="${opts.ctaUrl}"
                   style="display:inline-block;background:#fafafa;color:#09090b;font-size:14px;font-weight:600;padding:10px 24px;border-radius:6px;text-decoration:none;">
                  ${opts.ctaText}
                </a>
              </div>
              <p style="font-size:12px;color:#52525b;margin:0;">
                If the button does not work, copy this URL:<br>
                <a href="${opts.ctaUrl}" style="color:#71717a;word-break:break-all;">${opts.ctaUrl}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}