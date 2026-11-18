/**
 * Pure HTML email templates — no logic, no external template engine.
 *
 * Each returns a complete, inline-styled, table-based HTML document with the
 * GenX CRM brand lockup, one CTA button, and a monospace link fallback.
 * A `@media (prefers-color-scheme: dark)` block (plus Outlook `[data-ogsc]`
 * selectors) gives a graceful, intentional dark-client rendering instead of
 * the auto-inverted mess clients produce on a bare white email.
 *
 * Drop-in compatible: same exported function names + signatures as before.
 */

// ── Brand + environment ──────────────────────────────────────────────
const APP_URL = (process.env.FRONTEND_URL ?? 'https://app.genxcrm.co.in').replace(/\/$/, '');
// Teal logomark already copied to frontend/public/logo-mark.png (see sidebar-logo addendum).
// Override with EMAIL_LOGO_URL if you host it on a CDN.
const LOGO_URL = process.env.EMAIL_LOGO_URL ?? `${APP_URL}/logo-mark.png`;

const GRADIENT = 'linear-gradient(115deg,#2487b8 0%,#1ba3b4 55%,#14c2b6 100%)';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// ── Building blocks ──────────────────────────────────────────────────
const button = (label: string, url: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
    <tr><td align="center" bgcolor="#1aa6ab" style="border-radius:11px;background:#1aa6ab;background-image:${GRADIENT};">
      <a href="${url}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:#04232b;text-decoration:none;letter-spacing:.2px;">${label}</a>
    </td></tr>
  </table>`;

const linkFallback = (url: string): string => `
  <p class="gx-muted" style="margin:22px 0 8px;font-family:${FONT};font-size:13px;line-height:1.5;color:#7b8895;">Or paste this link into your browser:</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td class="gx-box" style="background:#f4f7f8;border:1px solid #e6ebec;border-radius:10px;padding:13px 15px;">
      <a href="${url}" class="gx-boxlink" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:#108e86;text-decoration:none;word-break:break-all;">${url}</a>
    </td></tr>
  </table>`;

/**
 * Full email document.
 * @param heading   H1 shown in the body
 * @param preheader hidden inbox-preview line
 * @param bodyHtml  the paragraphs / button / fallback markup
 */
const shell = (heading: string, preheader: string, bodyHtml: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${heading}</title>
<style>
  /* dark-client rendering — opt into an intentional dark theme */
  @media (prefers-color-scheme: dark) {
    .gx-bg      { background:#101216 !important; }
    .gx-card    { background:#0e1b22 !important; border-color:#1d3540 !important; }
    .gx-h1      { color:#eaf3f4 !important; }
    .gx-text    { color:#aebcc5 !important; }
    .gx-muted   { color:#7f909b !important; }
    .gx-box     { background:#11252f !important; border-color:#1d3540 !important; }
    .gx-boxlink { color:#54d8cd !important; }
    .gx-divider { border-color:#162a33 !important; }
    .gx-wm      { color:#eaf3f4 !important; }
    .gx-footmut { color:#6f8089 !important; }
  }
  /* Outlook.com dark mode */
  [data-ogsc] .gx-card  { background:#0e1b22 !important; }
  [data-ogsc] .gx-h1    { color:#eaf3f4 !important; }
  [data-ogsc] .gx-text  { color:#aebcc5 !important; }
  [data-ogsc] .gx-box   { background:#11252f !important; }
</style>
</head>
<body class="gx-bg" style="margin:0;padding:0;background:#eceff1;">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="gx-bg" style="background:#eceff1;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" class="gx-card" style="width:520px;max-width:520px;background:#ffffff;border:1px solid #e6ebec;border-radius:18px;overflow:hidden;">

        <!-- brand header band -->
        <tr><td style="background:#1aa6ab;background-image:${GRADIENT};padding:24px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="vertical-align:middle;padding-right:12px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border-radius:9px;padding:6px;line-height:0;">
                <img src="${LOGO_URL}" width="26" height="26" alt="GenX CRM" style="display:block;width:26px;height:26px;">
              </td></tr></table>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-family:'Poppins',${FONT};font-size:22px;font-weight:700;letter-spacing:-0.3px;color:#ffffff;line-height:1;">Gen<span style="color:#cdfdf6;">X</span>Crm</div>
            </td>
          </tr></table>
        </td></tr>

        <!-- body -->
        <tr><td style="padding:38px 32px 10px;">
          <h1 class="gx-h1" style="margin:0 0 18px;font-family:${FONT};font-size:23px;line-height:1.25;font-weight:700;letter-spacing:-0.4px;color:#0f2a3a;">${heading}</h1>
          ${bodyHtml}
        </td></tr>

        <!-- footer -->
        <tr><td style="padding:24px 32px 30px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td class="gx-divider" style="border-top:1px solid #eef1f2;padding-top:22px;">
              <p class="gx-wm" style="margin:0 0 5px;font-family:'Poppins',${FONT};font-size:14px;font-weight:700;letter-spacing:-0.2px;color:#0f2a3a;">Gen<span style="color:#16c1b9;">X</span>Crm</p>
              <p class="gx-footmut" style="margin:0 0 14px;font-family:${FONT};font-size:12.5px;line-height:1.5;color:#9aa6b2;">Building trust, attracting growth.</p>
              <p class="gx-footmut" style="margin:0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:#9aa6b2;">You received this email because an account is registered with this address. This is a transactional message about your account security.</p>
            </td></tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// paragraph helper — keeps body copy consistent
const p = (html: string): string =>
  `<p class="gx-text" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:#44515f;">${html}</p>`;
const note = (html: string): string =>
  `<p class="gx-muted" style="margin:22px 0 4px;font-family:${FONT};font-size:13px;line-height:1.6;color:#7b8895;">${html}</p>`;

// ── Templates ────────────────────────────────────────────────────────
export const verifyEmailTemplate = (name: string, url: string): string =>
  shell(
    'Verify your email',
    'Confirm your email to finish setting up your GenX CRM account.',
    `${p(`Hi ${name},`)}
     ${p('Welcome to GenX CRM. Confirm your email address to finish setting up your account and unlock your workspace.')}
     ${button('Verify email', url)}
     ${linkFallback(url)}
     ${note('This link expires in <b>24 hours</b>. If you didn&rsquo;t create a GenX CRM account, no action is needed.')}`,
  );

export const welcomeTemplate = (name: string, orgName: string): string =>
  shell(
    'Welcome to GenX CRM',
    'Your workspace is ready — capture leads and track every deal to close.',
    `${p(`Hi ${name},`)}
     ${p(`Your organization <b>${orgName}</b> is ready to go. Capture leads, assign them to your team, and track every deal to close &mdash; all in one place.`)}
     ${button('Open your dashboard', `${APP_URL}/dashboard`)}
     ${note('Need a hand getting started? Just reply to this email and our team will help you out.')}`,
  );

export const passwordResetTemplate = (name: string, url: string): string =>
  shell(
    'Reset your password',
    'Reset your GenX CRM password — this link expires in 1 hour.',
    `${p(`Hi ${name},`)}
     ${p('We received a request to reset the password for your GenX CRM account. Click the button below to choose a new one.')}
     ${button('Reset password', url)}
     ${linkFallback(url)}
     ${note('This link expires in <b>1 hour</b>. If you didn&rsquo;t request a reset, you can safely ignore this email &mdash; your password won&rsquo;t change.')}`,
  );

export const mfaResetRequestTemplate = (name: string, url: string): string =>
  shell(
    'Reset your two-factor authentication',
    'Reset 2FA on your GenX CRM account — this link expires in 1 hour.',
    `${p(`Hi ${name},`)}
     ${p('We received a request to reset two-factor authentication on your GenX CRM account because you no longer have access to your authenticator app. Click below to turn it off, then sign in and set it up again.')}
     ${button('Reset two-factor authentication', url)}
     ${linkFallback(url)}
     ${note('This link expires in <b>1 hour</b>. If you didn&rsquo;t request this, you can safely ignore this email &mdash; your account is unaffected.')}`,
  );

// Monospace highlight box for a credential the recipient must read/copy
// (e.g. a temporary password). Reuses the gx-box dark-mode styling.
const credentialBox = (label: string, value: string): string => `
  <p class="gx-muted" style="margin:18px 0 6px;font-family:${FONT};font-size:13px;line-height:1.5;color:#7b8895;">${label}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td class="gx-box" style="background:#f4f7f8;border:1px solid #e6ebec;border-radius:10px;padding:13px 15px;">
      <span class="gx-boxlink" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;line-height:1.6;color:#108e86;word-break:break-all;letter-spacing:.3px;">${value}</span>
    </td></tr>
  </table>`;

export const teamInviteTemplate = (name: string, email: string, setupUrl: string): string =>
  shell(
    'You&rsquo;ve been added to GenX CRM',
    'Set your password to activate your GenX CRM account.',
    `${p(`Hi ${name},`)}
     ${p('You&rsquo;ve been added to your team on <b>GenX CRM</b>. Set a password to activate your account and sign in.')}
     ${credentialBox('Login email', email)}
     ${button('Set your password', setupUrl)}
     ${linkFallback(setupUrl)}
     ${note('This link expires in <b>72 hours</b>. If you weren&rsquo;t expecting this invitation, you can safely ignore this email.')}`,
  );

// Escapes user-controlled text (lead / rep names) before it is interpolated into
// the email HTML, so a name like `<script>` or `Smith & Co` can't break the markup.
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const leadsAssignedTemplate = (repName: string, leads: { name: string }[]): string => {
  const name = escapeHtml(repName);
  const url = `${APP_URL}/leads`;

  if (leads.length === 1) {
    return shell(
      'You have a new lead',
      'A new lead has been assigned to you in GenX CRM.',
      `${p(`Hi ${name},`)}
       ${p(`A new lead <b>${escapeHtml(leads[0].name)}</b> has just been assigned to you. Reach out while it&rsquo;s hot.`)}
       ${button('View your leads', url)}`,
    );
  }

  const items = leads
    .map(
      (lead) =>
        `<li style="margin:0 0 7px;font-family:${FONT};font-size:15px;line-height:1.5;color:#44515f;">${escapeHtml(lead.name)}</li>`,
    )
    .join('');

  return shell(
    `You have ${leads.length} new leads`,
    `${leads.length} new leads have been assigned to you in GenX CRM.`,
    `${p(`Hi ${name},`)}
     ${p(`<b>${leads.length}</b> new leads have just been assigned to you:`)}
     <ul class="gx-text" style="margin:0 0 14px;padding-left:20px;">${items}</ul>
     ${button('View your leads', url)}`,
  );
};

export const passwordChangedTemplate = (name: string): string =>
  shell(
    'Your password was changed',
    'This confirms your GenX CRM password was just changed.',
    `${p(`Hi ${name},`)}
     ${p('This is a confirmation that the password for your GenX CRM account was just changed.')}
     ${button('Sign in', `${APP_URL}/login`)}
     ${note('If you <b>didn&rsquo;t</b> make this change, your account may be at risk &mdash; reset your password immediately or contact <a href="mailto:support@genxcrm.co.in" style="color:inherit;">support@genxcrm.co.in</a>.')}`,
  );

export const mfaResetConfirmedTemplate = (name: string): string =>
  shell(
    'Your two-factor authentication was reset',
    'This confirms two-factor authentication was just turned off on your GenX CRM account.',
    `${p(`Hi ${name},`)}
     ${p('This is a confirmation that two-factor authentication for your GenX CRM account was just turned off. You can sign in with your password and set it up again from Account settings.')}
     ${button('Sign in', `${APP_URL}/login`)}
     ${note('If you <b>didn&rsquo;t</b> request this, your account may be at risk &mdash; sign in immediately, re-enable two-factor authentication, and contact <a href="mailto:support@genxcrm.co.in" style="color:inherit;">support@genxcrm.co.in</a>.')}`,
  );
