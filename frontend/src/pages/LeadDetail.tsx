import { useState } from "react";
import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  updateLead,
  reassignLead,
  addNote,
  sendEmail,
  sendSms,
  sendWhatsApp,
  sendWhatsAppTemplate,
  markPaymentPaid,
  getLead,
} from "../api/client";
import { useLead } from "../hooks/useLead";
import { useFieldMappings } from "../hooks/useFieldMappings";
import { useTemplates } from "../hooks/useTemplates";
import { useAuth } from "../context/AuthContext";
import { buildTemplateValues } from "../lib/templateValues";
import { usePlatformPlan } from "../hooks/usePlatformPlan";
import type { MessageTemplate } from "../types";
import { useAssignableUsers } from "../hooks/useAssignableUsers";
import { OwnerCell } from "../components/leads/OwnerCell";
import { StageStepper } from "../components/leadDetail/StageStepper";
import { Composer } from "../components/leadDetail/Composer";
import { UnifiedTimeline } from "../components/leadDetail/UnifiedTimeline";
import { DealValueCard } from "../components/leadDetail/DealValueCard";
import { UpNextCard } from "../components/leadDetail/UpNextCard";
import { FollowUpCard } from "../components/leadDetail/FollowUpCard";
import { FormsSection } from "../components/leadDetail/FormsSection";
import { SendFormDialog } from "../components/leadDetail/SendFormDialog";
import { useFormSubmissions } from "../hooks/useFormSubmissions";
import { HierarchyCard } from "../components/leadDetail/HierarchyCard";
import { EditEmailsModal } from "../components/leadDetail/EditEmailsModal";
import { mergeTimeline } from "../lib/timeline";
import type { LeadStage } from "../types";
import { Header } from "../components/layout/Header";
import { StatusBadge } from "../components/shared/StatusBadge";
import { WhatsAppIcon } from "../components/shared/WhatsAppIcon";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Skeleton } from "../components/ui/skeleton";
import { Separator } from "../components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "../components/ui/tooltip";
import {
  Mail,
  Phone,
  BookOpen,
  MapPin,
  User,
  Globe,
  Megaphone,
  Layers,
  Tag,
  Calendar,
  Languages,
  AlertCircle,
  ClipboardList,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDateTime } from "../lib/utils";
import { openExternal } from "../lib/platform";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

const CUSTOM_FIELD_LABELS: Record<string, string> = {
  currentStatus: "Current Status",
  motivation: "Learning Goal",
  startTimeline: "Start Timeline",
  liveClassAvailable: "Live Class Available",
};

function scoreClasses(score: number) {
  if (score >= 70)
    return "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/40";
  if (score >= 40)
    return "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/40";
  return "text-muted-foreground bg-muted/60 border-border";
}

function InfoRow({
  icon,
  value,
  className,
}: {
  icon: React.ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { lead, refetch } = useLead(id);
  const { mapping: orgFieldMapping } = useFieldMappings();
  const [composerBusy, setComposerBusy] = useState(false);
  const [editEmailsOpen, setEditEmailsOpen] = useState(false);
  const [sendFormOpen, setSendFormOpen] = useState(false);
  const { submissions, loading: submissionsLoading } = useFormSubmissions({
    leadId: id,
  });
  const newestFirstSubmissions = useMemo(
    () => [...submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [submissions],
  );
  const { users } = useAssignableUsers();
  const { templates } = useTemplates();
  const whatsappTemplates = useMemo(
    () => templates.filter((t) => t.channel === "WHATSAPP"),
    [templates],
  );
  const emailTemplates = useMemo(
    () => templates.filter((t) => t.channel === "EMAIL"),
    [templates],
  );
  const { user } = useAuth();
  const defaultPlan = usePlatformPlan(user?.org?.isPlatformOrg === true);
  const templateValues = useMemo(
    () =>
      lead
        ? buildTemplateValues(lead, {
            orgName: user?.org?.name,
            orgWebsite: user?.org?.website,
            repName: user?.name,
            defaultPlan,
          })
        : {},
    [lead, user, defaultPlan],
  );

  const timelineEvents = useMemo(
    () => (lead ? mergeTimeline(lead) : []),
    [lead],
  );

  async function changeStage(stage: LeadStage) {
    if (!lead) return;
    try {
      await updateLead(lead.id, { stage });
      refetch();
      toast.success(Messages.leadDetail.stageUpdated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.stageUpdateFailed));
    }
  }

  async function changeOwner(userId: string | null) {
    if (!lead) return;
    try {
      if (userId) {
        await reassignLead(lead.id, userId);
      } else {
        await updateLead(lead.id, { assignedToId: null });
      }
      refetch();
      toast.success(Messages.leadDetail.ownerUpdated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.ownerUpdateFailed));
    }
  }

  async function saveFollowUp(followUpAt: string | null, followUpNote?: string) {
    if (!lead) return;
    try {
      await updateLead(lead.id, { followUpAt, ...(followUpNote !== undefined && { followUpNote }) });
      refetch();
      toast.success(followUpAt ? Messages.leadDetail.followUpSaved : Messages.leadDetail.followUpCleared);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.followUpFailed));
    }
  }

  async function saveEmails(payload: { email: string; altEmail: string }) {
    if (!lead) return;
    try {
      await updateLead(lead.id, payload);
      refetch();
      toast.success(Messages.leadDetail.emailsUpdated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.emailsUpdateFailed));
    }
  }

  async function saveNote(note: string) {
    if (!lead) return;
    setComposerBusy(true);
    try {
      await addNote(lead.id, note);
      refetch();
      toast.success(Messages.leadDetail.noteAdded);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.noteFailed));
    } finally {
      setComposerBusy(false);
    }
  }

  async function logCall(note: string) {
    if (!lead) return;
    setComposerBusy(true);
    try {
      await addNote(lead.id, note, "CALL_LOG");
      refetch();
      toast.success(Messages.leadDetail.callLogged);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.callLogFailed));
    } finally {
      setComposerBusy(false);
    }
  }

  // Meta's Cloud API often accepts an out-of-window free-form WhatsApp send synchronously
  // (200 OK) and only reports the real failure (e.g. 24h customer-service window violation)
  // asynchronously via its status webhook, which lands within a few seconds in practice. A
  // single delayed re-check — rather than a polling loop — catches that and swaps the
  // false-positive "sent" toast for the real failure reason instead of leaving the rep to
  // discover it only on a manual refresh.
  function recheckWhatsAppDelivery(leadId: string, communicationId: string) {
    setTimeout(() => {
      void (async () => {
        try {
          const freshLead = await getLead(leadId);
          const comm = freshLead.communications?.find((c) => c.id === communicationId);
          if (comm?.status === "failed") {
            toast.error(Messages.leadDetail.whatsappDeliveryFailed(comm.metadata?.error));
            refetch();
          }
        } catch {
          // Best-effort — a failed recheck just means the rep won't get the early heads-up;
          // the timeline still reflects the real status next time the lead is refetched.
        }
      })();
    }, 8000);
  }

  async function sendComm(
    type: "EMAIL" | "SMS" | "WHATSAPP",
    body: string,
    subject?: string,
    attachmentIds?: string[],
  ) {
    if (!lead) return;
    setComposerBusy(true);
    try {
      if (type === "EMAIL")
        await sendEmail({
          leadId: lead.id,
          subject: subject ?? "",
          body,
          attachmentIds,
        });
      else if (type === "SMS")
        await sendSms({ leadId: lead.id, message: body });
      else {
        const comm = await sendWhatsApp({
          leadId: lead.id,
          message: body,
          attachmentIds,
        });
        recheckWhatsAppDelivery(lead.id, comm.id);
      }
      refetch();
      toast.success(Messages.leadDetail.messageSent);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.messageFailed));
    } finally {
      setComposerBusy(false);
    }
  }

  async function sendWaTemplate(template: MessageTemplate, params: string[]) {
    if (!lead || !template.metaTemplateName) return;
    setComposerBusy(true);
    try {
      await sendWhatsAppTemplate({
        leadId: lead.id,
        templateName: template.metaTemplateName,
        language: template.language ?? "en_US",
        params,
      });
      refetch();
      toast.success(Messages.leadDetail.messageSent);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.messageFailed));
    } finally {
      setComposerBusy(false);
    }
  }

  // Mark a still-pending payment as paid (e.g. collected offline). Fires the invoice.
  async function markPaid(paymentId: string) {
    try {
      await markPaymentPaid(paymentId);
      toast.success(Messages.leadDetail.markedPaid);
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leadDetail.markPaidFailed));
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(Messages.leadDetail.linkCopied);
    } catch {
      toast.error(Messages.leadDetail.linkCopyFailed);
    }
  }

  if (!lead)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="space-y-3 w-full max-w-2xl px-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );

  const hasAttribution =
    lead.sourceCampaign || lead.sourceAdSet || lead.sourceAd;
  const customFields = lead.customFields ?? {};
  const knownCustomKeys = Object.keys(CUSTOM_FIELD_LABELS);
  const hasQualification = knownCustomKeys.some((k) => customFields[k]);
  const extraCustomFields = Object.entries(customFields).filter(
    ([k]) => !knownCustomKeys.includes(k),
  );
  // Org-defined custom fields (Administration > Field Mappings) are stored on the lead
  // keyed by the definition's stable id — resolve back to the org's current label so a
  // rename there doesn't leave leads showing a stale name or a raw id.
  const orgCustomFieldNames = Object.fromEntries(
    (orgFieldMapping?.customFieldDefs ?? []).map((def) => [def.id, def.name]),
  );
  const pendingPayments = (lead.payments ?? []).filter(
    (p) => p.status !== "PAID",
  );

  return (
    <>
      <Header
        title={lead.name}
        subtitle={lead.course ?? lead.phone}
        showBackButton
        actions={
          <div className="flex items-center gap-2 flex-nowrap justify-end">
            {/* Fixed max-width + truncate keeps this pill from ever pushing the score
                badge onto a wrapped line (or squeezing it into an unreadable sliver) on a
                narrow phone screen when the stage label is long, e.g. "Enrollment
                pending" (see SCRUM-36 header layout). shrink-0 on both pills stops the
                flex row from compressing either one instead of truncating the text. */}
            <StatusBadge
              status={lead.stage}
              title={lead.stage.replace(/_/g, " ")}
              className="max-w-[130px] shrink-0 truncate"
            />
            <span
              className={cn(
                "shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold border tabular-nums",
                scoreClasses(lead.score),
              )}
            >
              {lead.score}
            </span>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <StageStepper
          currentStage={lead.stage}
          onChange={(s) => void changeStage(s)}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] gap-4">
          {/* ── Left rail ── */}
          <div className="space-y-4 min-w-0">
            {/* Profile + contact */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-4 mb-4">
                <Avatar className="w-14 h-14 flex-shrink-0">
                  <AvatarFallback className="text-lg bg-primary/10 text-primary font-bold">
                    {lead.name
                      .split(" ")
                      .map((n: string) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="min-w-0 font-semibold text-foreground truncate">
                        {lead.name}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent>{lead.name}</TooltipContent>
                  </Tooltip>
                  <StatusBadge status={lead.stage} className="mt-1" />
                </div>
              </div>

              <Separator className="my-3" />

              {/* Contact details */}
              <div className="space-y-2">
                <InfoRow
                  icon={<Phone className="w-3.5 h-3.5" />}
                  value={lead.phone}
                />
                {lead.altPhone && (
                  <InfoRow
                    icon={<Phone className="w-3.5 h-3.5 opacity-50" />}
                    value={`${lead.altPhone} (alt)`}
                  />
                )}
                {(lead.email || lead.altEmail) && (
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      {lead.email && (
                        <InfoRow
                          icon={<Mail className="w-3.5 h-3.5" />}
                          value={lead.email}
                        />
                      )}
                      {lead.altEmail && (
                        <InfoRow
                          icon={<Mail className="w-3.5 h-3.5 opacity-50" />}
                          value={`${lead.altEmail} (alt)`}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Edit email addresses"
                      onClick={() => setEditEmailsOpen(true)}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {!lead.email && !lead.altEmail && (
                  <button
                    type="button"
                    onClick={() => setEditEmailsOpen(true)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Add email
                  </button>
                )}
                {lead.location && (
                  <InfoRow
                    icon={<MapPin className="w-3.5 h-3.5" />}
                    value={lead.location}
                  />
                )}
                {lead.language && (
                  <InfoRow
                    icon={<Languages className="w-3.5 h-3.5" />}
                    value={lead.language}
                  />
                )}
                {lead.course && (
                  <InfoRow
                    icon={<BookOpen className="w-3.5 h-3.5" />}
                    value={lead.course}
                  />
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="mt-0.5 flex-shrink-0">
                    <User className="w-3.5 h-3.5" />
                  </span>
                  <OwnerCell
                    value={lead.assignedTo ?? null}
                    onChange={changeOwner}
                    users={users}
                  />
                </div>
              </div>

              <Separator className="my-3" />

              {/* Source + score row */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={lead.source} />
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-semibold border tabular-nums",
                    scoreClasses(lead.score),
                  )}
                >
                  Score {lead.score}
                </span>
                {lead.interestedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold border tabular-nums bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    Interested {lead.interestedCount}×
                  </span>
                )}
              </div>

              {/* Tags */}
              {lead.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {lead.tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Created date */}
              <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                Added {formatDateTime(lead.createdAt)}
              </div>

              {/* Not-interested reason */}
              {(lead.stage === "NOT_INTERESTED" || lead.stage === "DROPPED") &&
                lead.notInterestedReason && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{lead.notInterestedReason}</span>
                  </div>
                )}

              {/* Action buttons */}
              <div className="flex gap-2 mt-4">
                <a
                  href={`https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${lead.name}, this is a follow-up regarding your enquiry${lead.course ? ` for ${lead.course}` : ""}. How can I assist you?`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 text-green-600 border border-green-500/20 text-xs font-medium hover:bg-green-500/20 transition-colors"
                >
                  <WhatsAppIcon className="w-3.5 h-3.5" />
                  WhatsApp
                </a>
                {lead.email && (
                  <a
                    href={`mailto:${lead.email}?subject=Regarding your enquiry${lead.course ? ` for ${lead.course}` : ""}`}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-medium hover:bg-primary/20 transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Email
                  </a>
                )}
              </div>
            </div>

            {/* Form responses */}
            <div className="bg-card border border-card-border rounded-xl p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Form responses</p>
                  {submissions.length > 0 && (
                    <span className="rounded-full bg-muted px-[7px] py-px text-[11px] font-semibold text-muted-foreground">
                      {submissions.length}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 whitespace-nowrap"
                  onClick={() => setSendFormOpen(true)}
                >
                  Send form
                </Button>
              </div>
              <FormsSection key={lead.id} submissions={newestFirstSubmissions} loading={submissionsLoading} />
            </div>

            {/* Attribution — collapsible, only when any attribution data exists */}
            {hasAttribution && (
              <details
                className="bg-card border border-card-border rounded-xl p-5 group"
                open
              >
                <summary className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer list-none">
                  Ad Attribution
                </summary>
                <div className="space-y-2 mt-3">
                  {lead.sourceCampaign && (
                    <InfoRow
                      icon={<Megaphone className="w-3.5 h-3.5" />}
                      value={lead.campaign?.name || lead.sourceCampaign}
                    />
                  )}
                  {lead.sourceAdSet && (
                    <InfoRow
                      icon={<Layers className="w-3.5 h-3.5" />}
                      value={`Ad Set: ${lead.adSet?.name || lead.sourceAdSet}`}
                    />
                  )}
                  {lead.sourceAd && (
                    <InfoRow
                      icon={<Globe className="w-3.5 h-3.5" />}
                      value={`Ad: ${lead.ad?.name || lead.sourceAd}`}
                    />
                  )}
                </div>
              </details>
            )}

            {/* Qualification (custom fields from lead form) — collapsible */}
            {(hasQualification || extraCustomFields.length > 0) && (
              <details
                className="bg-card border border-card-border rounded-xl p-5 group"
                open
              >
                <summary className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer list-none">
                  Qualification
                </summary>
                <div className="space-y-3 mt-3">
                  {knownCustomKeys.map((key) => {
                    const val = customFields[key];
                    if (!val) return null;
                    return (
                      <div key={key}>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {CUSTOM_FIELD_LABELS[key]}
                        </p>
                        <p className="text-sm text-foreground mt-0.5">{val}</p>
                      </div>
                    );
                  })}
                  {extraCustomFields.map(([key, val]) => (
                    <div key={key}>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {orgCustomFieldNames[key] ?? key.replace(/_/g, " ")}
                      </p>
                      <p className="text-sm text-foreground mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* ── Center column ── */}
          <div className="space-y-4 min-w-0">
            <Composer
              onSaveNote={(note) => saveNote(note)}
              onSendComm={(type, body, subject, attachmentIds) =>
                sendComm(type, body, subject, attachmentIds)
              }
              onLogCall={(note) => logCall(note)}
              whatsappTemplates={whatsappTemplates}
              emailTemplates={emailTemplates}
              templateValues={templateValues}
              onSendWhatsAppTemplate={(template, params) =>
                sendWaTemplate(template, params)
              }
              whatsappConversationOpen={lead.whatsappConversationOpen}
              onRecordingUploaded={refetch}
              saving={composerBusy}
              leadId={lead.id}
              leadPhone={lead.phone}
            />

            <UnifiedTimeline events={timelineEvents} />

            {/* Payments — action-only; paid payments already appear in the timeline above */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <p className="text-sm font-semibold text-foreground mb-3">
                Payments
              </p>
              <Button
                type="button"
                onClick={() => navigate(`/register/new?leadId=${lead.id}`)}
              >
                <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                Register Student
              </Button>

              {pendingPayments.length > 0 && (
                <div className="space-y-2 mt-4 pt-4 border-t border-card-border">
                  {pendingPayments.map((p) => (
                    <div
                      key={p.id}
                      className="bg-muted/40 border border-card-border rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground tabular-nums">
                            ₹{p.amount.toLocaleString()}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {p.gateway}
                          </span>
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {p.paymentLink && (
                          <>
                            <button
                              type="button"
                              onClick={() => void openExternal(p.paymentLink!)}
                              className="text-xs text-primary hover:underline"
                            >
                              Open link →
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyLink(p.paymentLink!)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Copy link
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => void markPaid(p.id)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Mark as paid
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Right rail ── */}
          <div className="space-y-4 min-w-0">
            <DealValueCard lead={lead} />
            <FollowUpCard
              key={`${lead.id}-${lead.followUpAt ?? "none"}`}
              followUpAt={lead.followUpAt}
              followUpNote={lead.followUpNote}
              onSave={(at, note) => saveFollowUp(at, note)}
              onClear={() => saveFollowUp(null)}
            />
            <UpNextCard lead={lead} />
            <HierarchyCard chain={lead.assignmentChain} />
          </div>
        </div>
      </div>
      {sendFormOpen && (
        <SendFormDialog
          leadId={lead.id}
          open
          onOpenChange={setSendFormOpen}
        />
      )}
      <EditEmailsModal
        open={editEmailsOpen}
        onOpenChange={setEditEmailsOpen}
        email={lead.email ?? ""}
        altEmail={lead.altEmail ?? ""}
        onSubmit={saveEmails}
      />
    </>
  );
}
