// Single source of truth for the default "Welcome New Leads" sequence. Used both by
// NurturingService.createDefaultWelcomeSequence (provisioned on org signup) and by the
// prisma/backfill-welcome-sequences.ts script (for existing orgs). Kept dependency-free
// so the backfill can import it without booting the Nest app.

export const WELCOME_SEQUENCE_TRIGGER = 'lead_created';

// Builds the Prisma `create` payload for an org's default welcome sequence: a single
// email step that fires immediately (delayDays 0). Placeholders are interpolated by the
// engine at send time (see NurturingService.interpolate). Provisioned inactive — the org
// opts in by activating it from the Nurturing page, so no automated emails go out by default.
export const welcomeSequenceCreateData = (orgId: string) => ({
  name: 'Welcome New Leads',
  description: "Automatically emails new leads a welcome message as soon as they're received.",
  triggerEvent: WELCOME_SEQUENCE_TRIGGER,
  isActive: false,
  orgId,
  steps: {
    create: [
      {
        stepOrder: 0,
        type: 'email',
        delayDays: 0,
        subject: "Welcome! We've received your enquiry",
        body:
          '<p>Hi {{name}},</p>' +
          "<p>Thank you for reaching out to us! We've received your enquiry and one of our " +
          'counselors will get in touch with you shortly.</p>' +
          '<p>Best regards,<br>{{org}}</p>',
      },
    ],
  },
});
