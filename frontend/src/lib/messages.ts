// Centralized, user-facing toast/notification strings.
//
// - Error fallbacks here are the *last resort* — error toasts should call
//   `apiErrorMessage(err, Messages.<area>.<fallback>)` so the real, friendly
//   backend message is shown when present and these only fill in for network
//   errors or unexpected failures.
// - Success/info strings (including dynamic, count-based ones) live here too as
//   plain strings or small template functions, so wording stays consistent and
//   is never hardcoded at the call site.

// Pluralization helper for "1 lead" / "3 leads"-style messages.
const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;

export const Messages = {
  common: {
    genericError: "Something went wrong. Please try again.",
  },

  admin: {
    saveFailed: "Could not save changes. Please try again.",
    orgProfileSaved: "Organization profile saved",
    securitySaved: "Security settings saved",
    invalidSessionTimeout: "Session timeout must be between 5 minutes and 7 days (10,080 minutes).",
    ssoConnected: "SSO connected",
    ssoDisconnected: "SSO disconnected",
    notificationsSaved: "Notification preferences saved",
    routingSaved: "Lead routing settings saved",
    paymentsSaved: "Payment settings saved",
    mappingSaved: "Field mapping saved",
    backfillDone: (updated: number, scanned: number) =>
      `Backfill complete — updated ${updated} of ${scanned} leads`,
    backfillFailed: "Couldn't backfill your leads. Please try again.",
    exportRequested: "Data export requested",
    erasureProcessed: (email: string) => `PII erased for ${email}`,
    apiKeyRegenerated: "API key regenerated",
    copied: "Copied to clipboard",
    logoUploaded: "Logo uploaded",
    logoUploadFailed: "Could not upload logo. Please try again.",
    logoTooLarge: "Logo must be 2MB or smaller.",
    logoInvalidType: "Logo must be a PNG or JPEG image.",
  },

  // Inline "couldn't load this data" states (not toasts).
  load: {
    followUps: "Could not load follow-ups. Please try again.",
    leads: "Could not load leads. Please try again.",
    lead: "Could not load this lead. Please try again.",
    users: "Could not load users. Please try again.",
    teams: "Could not load teams. Please try again.",
    payments: "Could not load payments. Please try again.",
    report: "Could not load this report. Please try again.",
    pipeline: "Could not load the pipeline. Please try again.",
    templates: "Could not load templates. Please try again.",
    mappingTemplates: "Could not load mapping templates. Please try again.",
    orgSettings: "Could not load organization settings. Please try again.",
    billing: "Could not load billing information. Please try again.",
    impersonatableUsers: "Could not load users. Please try again.",
    calls: "Could not load calls. Please try again.",
    invoices: "Could not load invoices. Please try again.",
    courses: "Could not load courses. Please try again.",
    tutors: "Could not load tutors. Please try again.",
    paymentGateways: "Could not load payment gateways. Please try again.",
    fieldMappings: "Could not load field mappings. Please try again.",
    auditLog: "Could not load the audit log. Please try again.",
    apiKey: "Could not load the API key. Please try again.",
  },

  auth: {
    invalidCredentials: "Incorrect email or password.",
    registrationFailed: "Could not complete registration. Please try again.",
    emailExists: "An account with this email already exists",
  },

  mfa: {
    setupFailed: "Could not start two-factor setup. Please try again.",
    verifyFailed: "That code isn't correct. Please try again.",
    challengeFailed: "That code isn't correct. Please try again.",
    disableFailed: "Could not disable two-factor authentication. Please try again.",
    enabled: "Two-factor authentication is now on.",
    disabled: "Two-factor authentication is now off.",
  },

  account: {
    saved: "Account updated.",
    saveFailed: "Could not save. Check your current password and try again.",
    passwordUpdateFailed: "Could not update your password. Please try again.",
  },

  register: {
    orgSaveFailed:
      "Could not save your organization details. Please try again.",
  },

  communications: {
    callAlertSent: "Call alert sent to your phone.",
    callAlertFailed: "Couldn't reach your phone — dial the number directly.",
  },

  leads: {
    created: "Lead created successfully",
    createFailed: "Could not create the lead. Please try again.",
    invalidPhone: "Enter a valid 10-digit phone number.",
    invalidEmail: "Enter a valid email address.",
    nameRequired: "Enter a name.",
    nameTooLong: "Name must be 100 characters or fewer.",
    nameAtLimit: "Maximum length reached (100 characters).",
    archivedOne: "Lead archived",
    archived: (n: number) => `${plural(n, "lead")} archived`,
    archiveFailed: "Could not archive the lead. Please try again.",
    archiveManyFailed: "Could not archive the leads. Please try again.",
    assigned: (n: number) => `${plural(n, "lead")} assigned`,
    assignFailed: "Could not assign the leads. Please try again.",
    markedNotInterested: (n: number) =>
      `${plural(n, "lead")} marked as not interested`,
    updateManyFailed: "Could not update the leads. Please try again.",
    stageUpdateFailed: "Could not update the stage. Please try again.",
    ownerUpdateFailed: "Could not update the owner. Please try again.",
    movedToStage: (n: number, stage: string) =>
      `${plural(n, "lead")} moved to ${stage.replace(/_/g, " ").toLowerCase()}`,
    // Auto-assign / round-robin
    autoAssignFailed: "Could not auto-assign the leads. Please try again.",
    noRepAvailable: "No sales rep available to assign leads to",
    nothingUnassigned: "Nothing to auto-assign — no unassigned leads",
    nothingToAutoAssign:
      "Nothing to auto-assign — selected leads are already assigned or have no team",
    autoAssigning: (queued: number) =>
      `Auto-assigning ${plural(queued, "lead")} via round robin`,
    autoAssigningSome: (queued: number, skipped: number) =>
      `Auto-assigning ${plural(queued, "lead")} (${skipped} skipped — already assigned or no team)`,
    enrollComingSoon: "Enroll is coming soon",
    exportComingSoon: "Export is coming soon",
  },

  leadDetail: {
    followUpSaved: "Follow-up scheduled",
    followUpCleared: "Follow-up cleared",
    followUpFailed: "Could not update the follow-up. Please try again.",
    stageUpdated: "Stage updated",
    stageUpdateFailed: "Could not update the stage. Please try again.",
    ownerUpdated: "Owner updated",
    ownerUpdateFailed: "Could not update the owner. Please try again.",
    emailsUpdated: "Email addresses updated",
    emailsUpdateFailed: "Could not update the email addresses. Please try again.",
    noteAdded: "Note added",
    noteFailed: "Could not add the note. Please try again.",
    callLogged: "Call logged",
    callLogFailed: "Could not log the call. Please try again.",
    recordingUploaded: "Recording uploaded",
    recordingUploadFailed: "Could not upload the recording. Please try again.",
    messageSent: "Message sent",
    messageFailed: "Could not send the message. Please try again.",
    whatsappDeliveryFailed: (reason?: string) =>
      reason ? `WhatsApp message failed to deliver: ${reason}` : "WhatsApp message failed to deliver",
    paymentLinkCreated: "Payment link created",
    paymentLinkSentTo: (email: string) => `Payment link sent to ${email}`,
    paymentLinkFailed: "Could not create the payment link. Please try again.",
    markedPaid: "Marked as paid",
    markPaidFailed: "Could not mark this as paid. Please try again.",
    linkCopied: "Link copied",
    linkCopyFailed: "Could not copy the link.",
  },

  nurturing: {
    sequenceCreated: "Sequence created",
    sequenceCreateFailed: "Could not create the sequence. Please try again.",
    sequenceDeleted: "Sequence deleted",
    sequenceDeleteFailed: "Could not delete the sequence. Please try again.",
    sequenceLoadFailed: "Could not load the sequence. Please try again.",
    sequencesLoadFailed: "Could not load sequences. Please try again.",
    sequencePaused: "Sequence paused",
    sequenceActivated: "Sequence activated",
    sequenceUpdateFailed: "Could not update the sequence. Please try again.",
    stepAdded: "Step added",
    stepUpdated: "Step updated",
    stepSaveFailed: "Could not save the step. Please try again.",
    leadEnrolled: "Lead enrolled",
    enrollFailed: "Could not enroll the lead. Please try again.",
    stepRemoved: "Step removed",
    enrollmentRemoved: "Enrollment removed",
    removeFailed: "Could not remove. Please try again.",
  },

  team: {
    memberAdded:
      "Member added — an invite email to set their password was sent",
    memberAddFailed: "Could not add the member. Please try again.",
    seatsInUse: "All paid seats are in use.",
    memberUpdated: "Member updated",
    memberUpdateFailed: "Could not update the member. Please try again.",
    memberRemoved: "Member removed from team",
    memberRemoveFailed: "Could not remove the member. Please try again.",
    memberAddedToTeam: "Member added to team",
    memberAddToTeamFailed:
      "Could not add the member to the team. Please try again.",
    managerUpdated: "Manager updated",
    managerUpdateFailed: "Could not update the manager. Please try again.",
    teamCreated: (name: string) => `Team "${name}" created`,
    teamCreateFailed: "Could not create the team. Please try again.",
    teamRenamed: "Team renamed",
    teamRenameFailed: "Could not rename the team. Please try again.",
  },

  impersonation: {
    startFailed: "Could not start impersonation. Please try again.",
  },

  users: {
    deactivated: (name: string) => `${name} deactivated`,
    deactivateFailed: "Could not deactivate the member. Please try again.",
    teamDeleted: (name: string) => `"${name}" deleted`,
    teamDeleteFailed: "Could not delete the team. Please try again.",
    inviteResent: (name: string) => `Invite resent to ${name}`,
    resendInviteFailed: "Could not resend the invite. Please try again.",
    mfaReset: (name: string) => `Two-factor authentication reset for ${name}`,
    mfaResetFailed: "Could not reset two-factor authentication. Please try again.",
  },

  billing: {
    subscriptionActivating:
      "Payment successful! Your subscription is being activated — this may take a few seconds.",
    seatsUpdated: "Seat count updated.",
    subscriptionCanceled: "Subscription will cancel at end of billing period.",
    genericFailed: "Something went wrong with billing. Please try again.",
    seatsUpdateFailed: "Could not update seats. Please try again.",
    cancelFailed: "Could not cancel the subscription. Please try again.",
    addonFailed: "Could not start the add-on purchase. Please try again.",
    subscriptionFailed: "Could not start your subscription. Please try again.",
    invalidCoupon: "Invalid or expired coupon code.",
    registrationPaymentFailed:
      "Your account was created, but we couldn't confirm payment. Please contact support or try subscribing from Billing after signing in.",
  },

  integrations: {
    connectFromWeb: (label: string) =>
      `Connect ${label} from the web dashboard.`,
    connected: (label: string) => `${label} connected`,
    connectedWith: (label: string, account: string) =>
      `${label} connected — ${account}`,
    connectFailed: (label: string) => `Couldn’t connect ${label}.`,
    connectCancelled: (label: string) => `${label} connection cancelled.`,
    connectStartFailed: (label: string) =>
      `Couldn’t start the ${label} connection.`,
    statusesLoadFailed:
      "Could not load integration statuses. Please try again.",
    oauthStartFailed: "Could not start the connection. Please try again.",
    disconnected: (label: string) => `${label} disconnected.`,
    adAccountsLoadFailed: "Could not load ad accounts. Please try again.",
    adAccountConnected: (name: string) => `Ad account connected — ${name}`,
    insightsSyncQueued: "Refreshing spend from Facebook…",
    insightsSyncFailed:
      "Could not refresh spend from Facebook. Please try again.",
    backfillQueued: "Recovering leads from Facebook — this can take a minute.",
    backfillFailed: "Could not start lead recovery. Please try again.",
    renamed: "Renamed",
    renameFailed: "Could not rename. Please try again.",
    deleted: "Deleted",
    deleteFailed: "Could not delete. Please try again.",
    templateSaved: (name: string) => `Template "${name}" saved`,
    templateApplied: (name: string) => `Applied "${name}"`,
    templateWillApply: (name: string) =>
      `Template "${name}" will be applied after upload`,
    dragFromExplorer:
      "Drag from Windows Explorer, not from VS Code or another editor.",
    templateNameRequired: "Enter a template name",
    templateSaveFailed: "Could not save the template. Please try again.",
    fileTooShort: "File must have at least a header row and one data row",
    csvParseFailed: "Could not parse the CSV file. Please check the format.",
    excelParseFailed:
      "Could not parse the Excel file. Please check the format.",
    fileReadFailed: "Could not read the file. Please try again.",
    unsupportedFile: "Please upload a CSV or Excel file",
    importFailed: "Import failed — check your data and try again",
  },

  templates: {
    updated: "Template updated",
    created: "Template created",
    saveFailed: "Could not save the template. Please try again.",
    copyCreated: "Copy created",
    copyFailed: "Could not copy the template. Please try again.",
    deleted: "Template deleted",
    deleteFailed: "Could not delete the template. Please try again.",
    submitted: "Submitted to WhatsApp for approval",
    submitFailed: "Could not submit the template. Please try again.",
    refreshed: "Statuses updated",
    refreshFailed: "Could not refresh statuses. Please try again.",
  },

  invoices: {
    created: "Invoice created",
    createFailed: "Could not create the invoice. Please try again.",
    updated: "Invoice updated",
    updateFailed: "Could not update the invoice. Please try again.",
    sent: "Invoice sent",
    sendFailed: "Could not send the invoice. Please try again.",
    deleted: "Invoice deleted",
    deleteFailed: "Could not delete the invoice. Please try again.",
    registrationPaymentRecorded: "Registration payment recorded",
    registrationPaymentFailed:
      "Could not record the registration payment. Please try again.",
    registrationLinkSent: "Registration payment link sent",
    registrationLinkFailed:
      "Could not send the registration payment link. Please try again.",
    registrationFeeMarkedPaid: "Registration fee marked as paid",
    registrationFeeMarkPaidFailed:
      "Could not mark the registration fee as paid. Please try again.",
    emiPlanCreated: "EMI plan created",
    emiPlanFailed: "Could not create the EMI plan. Please try again.",
    emiMandateCreated: "Auto-debit mandate created — send the link to the student to authorize it",
    emiMandateFailed: "Could not set up the auto-debit mandate. Please try again.",
    installmentReminderSent: "Reminder sent",
    installmentReminderFailed: "Could not send the reminder. Please try again.",
    installmentMarkedPaid: "Installment marked as paid",
    installmentMarkPaidFailed:
      "Could not mark the installment as paid. Please try again.",
    screenshotUploadFailed:
      "Could not upload the screenshot. Please try again.",
    pdfDownloadFailed: "Could not download the invoice PDF. Please try again.",
    razorpayNotConfigured:
      "Razorpay isn't connected for your organization yet. Connect it in Integrations, or use a custom link instead.",
  },

  courses: {
    created: "Course created",
    createFailed: "Could not create the course. Please try again.",
    updateFailed: "Could not save the course. Please try again.",
    removeFailed: "Could not remove the course. Please try again.",
    addBatchFailed: "Could not add the batch. Please try again.",
    removeBatchFailed: "Could not remove the batch. Please try again.",
  },

  tutors: {
    createFailed: "Could not add the tutor. Please try again.",
    updateFailed: "Could not save the tutor. Please try again.",
  },

  googleForms: {
    loadFailed: "Couldn't load your forms. Please try again.",
    addFailed: "Couldn't add the form. Please check the details and try again.",
    added: "Form added",
    deleted: "Form deleted",
    deleteFailed: "Couldn't delete the form. Please try again.",
    toggleFailed: "Couldn't update the form. Please try again.",
    popupBlocked: "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
    connectStartFailed: "Couldn't start the Google sign-in. Please try again.",
    connected: "Google connected",
    connectFailed: "Couldn't connect Google. Please try again.",
    disconnected: "Google disconnected",
    disconnectFailed: "Couldn't disconnect Google. Please try again.",
    pickerFailed: "Couldn't open the Google picker. Please try again.",
    notConfigured: "Google Forms isn't set up on this server yet.",
    reconnectNeeded: "Google access was removed. Reconnect to keep receiving responses.",
    syncNowFailed: "Couldn't check for new responses. Please try again.",
    syncedNow: (n: number) => (n === 0 ? "No new responses" : `${n} new response${n === 1 ? "" : "s"}`),
    waiting: "Waiting for the student's response…",
    received: "Received",
    noFormConnected: "No Google form is connected yet. Ask a director to add one under Integrations › Google Forms.",
    submissionsFailed: "Couldn't load form responses. Please try again.",
    sendFailed: "Couldn't send the form. Please try again.",
    sent: "Form sent",
    linkCopied: "Form link copied",
    noActiveForms: "Add a form under Integrations › Google Forms first.",
    copyFailed: "Couldn't copy to the clipboard. Please copy it manually.",
    noResponses: "No responses yet. Send a form and the answers will appear here.",
  },
} as const;
