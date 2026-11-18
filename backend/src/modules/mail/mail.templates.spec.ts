import {
  verifyEmailTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
  teamInviteTemplate,
  leadsAssignedTemplate,
} from './mail.templates';

describe('mail.templates', () => {
  it('passwordResetTemplate includes the heading, the url, and a dark-mode block', () => {
    const html = passwordResetTemplate('Rahul', 'https://x/y');
    expect(html).toContain('Reset your password');
    expect(html).toContain('https://x/y');
    expect(html).toContain('prefers-color-scheme');
  });

  it('verifyEmailTemplate includes the heading and the url', () => {
    const html = verifyEmailTemplate('Rahul', 'https://verify/abc');
    expect(html).toContain('Verify your email');
    expect(html).toContain('https://verify/abc');
  });

  it('welcomeTemplate includes the heading and the org name', () => {
    const html = welcomeTemplate('Rahul', 'Acme');
    expect(html).toContain('Welcome to GenX CRM');
    expect(html).toContain('Acme');
  });

  it('passwordChangedTemplate includes the confirmation heading', () => {
    expect(passwordChangedTemplate('Rahul')).toContain('Your password was changed');
  });

  it('teamInviteTemplate renders the login email and set-password CTA', () => {
    const html = teamInviteTemplate('Rahul', 'rep@acme.com', 'https://app/reset-password?token=abc');
    expect(html).toContain('rep@acme.com');
    expect(html).toContain('https://app/reset-password?token=abc');
    expect(html).toContain('Set your password');
    expect(html).toContain('prefers-color-scheme');
  });

  it('drops the old off-brand indigo button colour', () => {
    expect(passwordResetTemplate('Rahul', 'https://x/y')).not.toContain('#4f46e5');
  });

  it('leadsAssignedTemplate uses a singular heading and the lead name for one lead', () => {
    const html = leadsAssignedTemplate('Rahul', [{ name: 'Acme Corp' }]);
    expect(html).toContain('You have a new lead');
    expect(html).toContain('Acme Corp');
  });

  it('leadsAssignedTemplate uses a plural heading and lists every lead name for a batch', () => {
    const html = leadsAssignedTemplate('Rahul', [{ name: 'Acme' }, { name: 'Globex' }, { name: 'Initech' }]);
    expect(html).toContain('You have 3 new leads');
    expect(html).toContain('Acme');
    expect(html).toContain('Globex');
    expect(html).toContain('Initech');
  });

  it('leadsAssignedTemplate escapes user-controlled lead names', () => {
    const html = leadsAssignedTemplate('Rahul', [{ name: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
