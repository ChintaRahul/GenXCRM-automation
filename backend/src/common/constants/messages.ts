// Centralized, user-facing exception messages.
//
// Every `throw new *Exception(...)` in a service/controller should pull its
// message from here rather than hardcoding a string inline. This keeps the
// wording friendly, consistent, and easy to audit/translate. Messages that
// embed a value are exposed as small template functions.
//
// Keep these phrased for end users: clear, blame-free, and free of internal
// jargon (no "signed_request", "HMAC", stack-trace terms, etc.).

export const ErrorMessages = {
  leads: {
    duplicate: 'A lead with this phone number or email already exists.',
    notFound: 'This lead could not be found.',
    invalidPhone: 'Enter a valid phone number (at least 10 digits).',
    invalidEmail: 'Enter a valid email address.',
  },

  auth: {
    invalidCredentials: 'Incorrect email or password.',
    usesSso: 'This account uses single sign-on. Please sign in with Google or GitHub.',
    emailNotVerified: 'Please verify your email before signing in.',
    emailInUse: 'This email is already registered.',
    noProviderEmail: 'We couldn’t get an email from that provider. Please allow email access and try again.',
    invalidOrExpiredToken: 'This link is invalid or has expired. Please request a new one.',
    userNotFound: 'We couldn’t find your account.',
    orgAlreadyConfigured: 'Your organization has already been set up.',
    termsNotAccepted: 'You must agree to the Terms of Service to create an account.',
    noOrgLinked: 'No organization is linked to this account.',
    // Provider handshake / integration setup failures (Facebook signed_request, etc.)
    facebookNotConfigured: 'Facebook sign-in isn’t set up yet. Please contact support.',
    facebookSignatureInvalid: 'We couldn’t verify the Facebook sign-in request. Please try again.',
    verificationFailed: 'Verification failed. Please try again.',
    impersonationNotAllowed: 'You don’t have permission to impersonate users.',
    cannotImpersonateSelf: 'You can’t impersonate yourself.',
    alreadyImpersonating: 'End your current impersonation session before starting another.',
    notImpersonating: 'You’re not currently impersonating anyone.',
    invalidRegistrationPayment: 'We couldn’t verify this payment.',
    registrationNotFound: 'We couldn’t find that registration.',
    mfaInvalidOrExpiredToken: 'This verification session has expired. Please start again.',
    mfaInvalidCode: 'That code isn’t correct. Please try again.',
    mfaAlreadyEnabled: 'Two-factor authentication is already enabled.',
    mfaNotEnabled: 'Two-factor authentication isn’t enabled.',
  },

  users: {
    notFound: 'This user could not be found.',
    emailInUse: 'This email is already registered.',
    managerCreateRepOnly: 'Managers can only add Sales Reps.',
    managerOwnTeamOnly: 'Managers can only assign users to their own team.',
    managerCannotChangeRoles: 'Managers can’t change user roles.',
    managerCannotAssignMfgRole: 'Managers can’t assign manufacturing roles — only Directors can.',
    managerAssignManagedOnly: 'Managers can only assign users to teams they manage.',
    managerModifyManagedOnly: 'You can only modify users in the teams you manage.',
    cannotDemoteLastDirector: 'You can’t remove the last Director.',
    managerMemberTeamsOnly: 'Managers can only create Member teams.',
    teamNotFound: 'This team could not be found.',
    teamRoleMismatch: (isManagerTeam: boolean) =>
      isManagerTeam ? 'A Manager team only accepts Managers.' : 'A Member team only accepts Sales Reps.',
    currentPasswordRequired: 'Enter your current password to set a new one.',
    incorrectCurrentPassword: 'Your current password is incorrect.',
    ssoNoPassword: 'This account signs in via single sign-on and has no password to change.',
    inviteAlreadyAccepted: 'This member has already accepted their invite.',
    resendInviteFailed: 'We couldn’t resend the invite. Please check your email quota and try again.',
  },

  billing: {
    noOrg: 'No organization is associated with your account.',
    planNotFound: 'We couldn’t find that plan.',
    planNotConfigured: 'This plan isn’t available yet. Please contact support.',
    subscriptionCreateFailed: 'We couldn’t start your subscription right now. Please try again or contact support.',
    subscriptionNotFound: 'No subscription was found for your account.',
    subscriptionMismatch: 'This subscription doesn’t match your account.',
    noActiveSubscription: 'You don’t have an active subscription.',
    orgExempt: 'This organization is not billable.',
    invalidWebhookSignature: 'We couldn’t verify this request.',
    seatIncreaseRequiresPayment: 'Increasing seats requires payment. Please use the seat update dialog.',
    seatCheckoutFailed: 'We couldn’t start payment for the seat update. Please try again.',
    invalidSeatPayment: 'We couldn’t verify this payment.',
    seatCountOutOfRange: 'That seat count is outside the allowed range for this plan.',
    seatCountBelowActiveUsers: (active: number) =>
      `Your organization has ${active} active user${active === 1 ? '' : 's'}. Choose at least ${active} seat${active === 1 ? '' : 's'}.`,
    addonCheckoutFailed: 'We couldn’t start the add-on purchase. Please try again.',
    invalidCoupon: 'Invalid or expired coupon code.',
    couponNotApplicable: 'This coupon isn’t valid for the selected plan.',
    couponAlreadyRedeemed: 'This coupon has already been used on this account.',
  },

  nurturing: {
    sequenceNotFound: 'This sequence could not be found.',
    stepNotFound: 'This step could not be found.',
    enrollmentNotFound: 'This enrollment could not be found.',
    alreadyEnrolled: 'This lead is already enrolled in this sequence.',
    sequenceCapReached: (limit: number) =>
      `You can create at most ${limit} sequences. Delete one you no longer need to add another.`,
  },

  payments: {
    leadNotFound: 'This lead could not be found.',
    paymentNotFound: 'This payment could not be found.',
    razorpayNotConfigured: 'Online payments aren’t set up yet. Please contact your administrator.',
    cashfreeNotConfigured: 'Cashfree isn’t connected yet. Connect it under Integrations, or choose another gateway.',
    paymentLinkFailed: (reason: string) => `We couldn’t create the payment link. ${reason}`,
    invalidWebhookSignature: 'We couldn’t verify this request.',
  },

  invoices: {
    notFound: 'This invoice could not be found.',
    leadNotFound: 'This lead could not be found.',
    orgRequired: 'Your account isn’t linked to an organization.',
    registrationPaymentRequired:
      'Cannot send an invoice generated from registration until the registration payment has been recorded.',
    unsupportedGateway: 'Only Razorpay and Cashfree are supported for payment links.',
    mandateCoversPayment:
      'This invoice already has an active auto-debit mandate — Razorpay collects installments automatically, so no separate payment link is needed.',
    customUrlRequired: 'A custom payment link URL is required.',
    screenshotNotFound: 'No registration screenshot has been uploaded for this invoice.',
    installmentNotFound: 'This installment could not be found.',
    invalidLineItem: 'Line item quantity and unit price must be zero or a positive number.',
    invalidGstRate: 'GST rate must be between 0 and 100.',
    invalidDiscountValue: 'Discount value must be zero or a positive number.',
    invalidRegistrationFee: 'Registration fee must be zero or a positive number.',
    invalidTenure: 'EMI tenure must be a whole number of months between 1 and 60.',
    invalidStartDate: 'The EMI start date is not a valid date.',
    mandateAlreadyExists: 'An auto-debit mandate already exists for this invoice — cancel it in Razorpay before creating a new EMI plan.',
    mandateCreateFailed: (reason: string) => `Could not set up the auto-debit mandate: ${reason}`,
    numberCollision: 'Could not allocate a unique invoice number — please try again.',
    leadEmailRequired: 'This lead has no email address on file — add one before sending the invoice.',
    paidInvoiceLocked: 'This invoice is already paid and can no longer be edited.',
    cannotCancelPaidInvoice: 'A paid invoice cannot be voided.',
  },

  courses: {
    notFound: 'This course could not be found.',
    orgRequired: 'Your account isn’t linked to an organization.',
    batchNotFound: 'This batch could not be found.',
    tutorNotFound: 'This tutor could not be found.',
  },

  tutors: {
    orgRequired: 'Your account isn’t linked to an organization.',
    notFound: 'This tutor could not be found.',
  },

  templates: {
    notFound: 'This template could not be found.',
    defaultCannotEdit: 'Default templates can’t be edited — make a copy first.',
    defaultCannotDelete: 'Default templates can’t be deleted — make a copy instead.',
    pendingCannotEdit: 'This template is awaiting WhatsApp approval and can’t be edited yet.',
    notConfigured: 'WhatsApp Business account isn’t configured, so the template can’t be submitted yet.',
    notWhatsapp: 'Only WhatsApp templates can be submitted for approval.',
    whatsappNeedsApproved:
      'WhatsApp nurturing steps must use an approved template. Submit and get the template approved first.',
  },

  importMappings: {
    notFound: 'This import mapping could not be found.',
    notOwner: 'You don’t have access to this mapping template.',
  },

  organizations: {
    noOrgLinked: 'No organization is linked to this account.',
    notFound: 'This organization could not be found.',
    invalidSessionTimeout: 'Session timeout must be between 5 minutes and 7 days (10,080 minutes).',
    invalidEmiReminderTemplate: 'That template is not an approved WhatsApp template owned by your organization.',
    invalidEmiReminderEmailTemplate: 'That template is not an email template owned by your organization.',
  },

  integrations: {
    unknownOrg: 'We couldn’t identify this organization.',
    invalidSignature: 'Signature check failed. The signature header must be an HMAC-SHA256 of the exact request body, computed with your webhook secret.',
    unknownProvider: 'This integration isn’t supported.',
    directorOnly: 'Only a Director can manage this integration — it holds your organization’s own credentials.',
    verificationFailed: 'Verification failed. Please try again.',
    facebookNotConfigured:'Facebook isn’t set up yet. Please contact support.',
    facebookSelectionExpired: 'Your selection expired. Please reconnect Facebook.',
    facebookPageUnavailable: 'That Page is no longer available. Please reconnect.',
    facebookPageNotConnected: 'Connect a Facebook Page before connecting an ad account.',
    facebookNotConnectedForBackfill: 'Connect a Facebook Page before recovering missed leads.',
    facebookAdAccountUnavailable: 'That ad account is no longer available. Please refresh and try again.',
    facebookAdAccountsListFailed:
      'Facebook rejected the request to list ad accounts. Check server logs for the exact reason (often a missing permission in the app’s Login for Business configuration).',
    googleNotConfigured: 'Google Ads isn’t set up yet. Please contact support.',
    googleCredsMissing: 'Google Ads credentials aren’t configured. Please contact support.',
    oauthStateInvalid: 'Your connection request is invalid or has expired. Please try again.',
    oauthStateExpired: 'Your connection request expired. Please try again.',
    orgNotFound: 'This organization could not be found.',
    whatsappCredentialsInvalid:
      'We couldn’t verify these WhatsApp credentials with Meta. Check the Phone Number ID and Access Token and try again.',
    whatsappBusinessAccountInvalid:
      'We couldn’t verify this WhatsApp Business Account ID with Meta. Check the ID and try again.',
    whatsappEmbeddedSignupNotConfigured: 'WhatsApp Embedded Signup isn’t set up yet. Please contact support.',
    smtpVerificationFailed:
      'We couldn’t connect to that SMTP server. Check the host, port, username and password, then try again.',
    emailNotConnected: 'Connect an email sending method before checking its status.',
    emailDomainVerificationFailed: 'We couldn’t start domain verification with AWS SES. Please try again.',
    cashfreeCredentialsInvalid:
      'We couldn’t verify these Cashfree credentials. Check the App ID and Secret Key, then try again.',
    razorpayCredentialsInvalid:
      'We couldn’t verify these Razorpay credentials. Check the Key ID and Key Secret, then try again.',
  },

  googleForms: {
    noOrg: 'Your account isn’t linked to an organization.',
    formNotFound: 'We couldn’t find that form.',
    leadNotFound: 'We couldn’t find that lead.',
    inactiveForm: 'This form is turned off. Turn it on to send it.',
    invalidFormUrl: 'Use the full form link that ends in /viewform.',
    invalidEntryId: 'The Lead ID question id should be digits only, e.g. 1234567890.',
    notConfigured: 'Google Forms isn’t set up yet. Please contact support.',
    notConnected: 'Connect your Google account first.',
    reconnectNeeded: 'Google access was removed. Please reconnect Google.',
    formAlreadyConnected: 'That form is already connected.',
    formUnavailable:
      'We couldn’t open that form. Pick it again in the Google window, using a Google account that can edit it.',
    sheetUnavailable: 'We couldn’t open that sheet. Pick it again in the Google window.',
    sheetChoiceRequired: 'Pick a sheet, or choose “Create a sheet for me”.',
    oauthStateInvalid: 'This Google connection link is invalid or has expired. Please try connecting again.',
    oauthCodeMissing: 'Google did not return an authorization code. Please try connecting again.',
    oauthExchangeFailed: 'We couldn’t complete the Google connection. Please try again.',
    noRefreshToken:
      'Google did not grant offline access. Remove GenXCRM from your Google account permissions and connect again.',
    legacyReactivate: 'This form was set up with the old script method. Connect it again through Google to turn it on.',
    googleUnavailable: 'Google is not responding right now. Please try again in a moment.',
    entryIdUnavailable: 'We couldn’t prepare this form for sending links. Please try again.',
  },

  communications: {
    notConfigured: 'WhatsApp isn’t set up yet. Please contact your administrator.',
    noPhone: 'This lead has no phone number on file, so the message couldn’t be sent.',
    publicTestOnlyTemplate:
      'This template can only be sent from WhatsApp’s test number, not your connected business number. Create your own template to send to leads.',
    sendFailed:
      'We couldn’t send the WhatsApp message. Please try again, or contact your administrator if this continues.',
    whatsappQuotaExceeded:
      'You’ve used up your free WhatsApp messages. Connect your own WhatsApp Business number or buy WhatsApp credits to keep sending.',
    tooManyAttachments: 'You can attach up to 5 files per email.',
    attachmentNotFound: 'One or more attachments could not be found or haven’t finished uploading.',
    attachmentTypeNotAllowed: 'Only PDF, image, CSV, Excel, and Word files can be attached.',
  },

  trial: {
    orgNotFound: 'This organization could not be found.',
    expired: 'Your 14-day trial has expired. Please upgrade to continue.',
    seatLimit: (limit: number) => `All ${limit} paid seats are in use. Add more seats to invite additional users.`,
    limitReached: (limit: number, resource: string) =>
      `Trial limit reached: you can have at most ${limit} ${resource}. Upgrade to add more.`,
    planLimitReached: (limit: number, resource: string) =>
      `Plan limit reached: you can have at most ${limit} ${resource} on your current plan.`,
  },
} as const;
