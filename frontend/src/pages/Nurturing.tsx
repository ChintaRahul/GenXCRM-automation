import { useCallback, useEffect, useState } from "react";
import {
  Zap,
  Plus,
  Trash2,
  Edit2,
  Mail,
  MessageCircle,
  Clock,
  Users,
  ChevronRight,
  Loader2,
  UserPlus,
  Search,
} from "lucide-react";
import { Spinner } from "../components/ui/Spinner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Header } from "../components/layout/Header";
import { EmptyState } from "../components/shared/EmptyState";
import { StatusBadge } from "../components/shared/StatusBadge";
import { Pagination } from "../components/ui/pagination";
import {
  getSequences,
  createSequence,
  getSequence,
  updateSequence,
  deleteSequence,
  addStep,
  updateStep,
  deleteStep,
  enrollLead,
  removeEnrollment,
  getSequenceEnrollments,
  getLeads,
  getTemplates,
  getAttachmentsMeta,
} from "../api/client";
import { AttachmentPicker } from "../components/AttachmentPicker";
import { useAttachments } from "../hooks/useAttachments";
import type {
  NurturingSequence,
  NurturingStep,
  NurturingEnrollment,
  Lead,
  MessageTemplate,
} from "../types";
import { toast } from "sonner";
import { cn, initials, formatDateTime } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

// ─── Step type config ─────────────────────────────────────────────────────────

// SMS is temporarily disabled. WhatsApp delivers only within 24h of the lead's last inbound message
// (free-form text); outside that window Meta requires an approved template, which isn't built yet.
const STEP_TYPES = [
  {
    key: "email",
    label: "Email",
    icon: Mail,
    color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    color: "text-green-500 bg-green-500/10 border-green-500/20",
  },
  {
    key: "wait",
    label: "Wait",
    icon: Clock,
    color: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  },
] as const;

type StepType = "email" | "whatsapp" | "wait";

const STEP_TEMPLATES: Record<StepType, { subject?: string; body: string }> = {
  email: {
    subject: "Following up on your enquiry",
    body: `Hi {{name}},\n\nThank you for your interest in {{course}}. I'd love to schedule a quick call to answer any questions you have.\n\nBest regards,\nGenX Team`,
  },
  whatsapp: {
    body: `Hi {{name}}, thanks for your interest in {{course}}! When's a good time for a quick call to answer your questions? — {{org}}`,
  },
  wait: { body: "" },
};

function stepTypeConfig(type: string) {
  return STEP_TYPES.find((t) => t.key === type) ?? STEP_TYPES[0];
}

// ─── Trigger label ─────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  INTERESTED: "Interested",
  RINGING_NOT_REACHABLE: "Ringing, not reachable",
  FOLLOW_UP_REQUIRED: "Follow up required",
  CALL_BACK: "Call back",
  CALL_NOT_RECEIVED: "Call not received",
  SWITCHED_OFF: "Switch off",
  WHATSAPP_SENT: "Whatsapp sent",
  DEMO_SCHEDULED: "Demo",
  DEMO_ATTENDED: "Demo attended",
  NEGOTIATION: "Negotiation",
  ENROLLMENT_PENDING: "Enrollment pending",
  ENROLLED: "Enrolled",
  NOT_INTERESTED: "Not interested",
  DROPPED: "Dropped",
  CLOSED_WON: "Won",
  CLOSED_LOST: "Lost",
};

function triggerLabel(event: string, stage?: string | null) {
  const map: Record<string, string> = {
    manual: "Manual",
    lead_created: "On Lead Created",
    stage_change: "On Stage Change",
    mfg_lead_created: "When a lead is created",
    mfg_lead_nurture: "When a lead moves to Nurture",
    quotation_sent: "When a quotation is sent",
    opportunity_lost: "When a deal is postponed or lost",
    amc_due_soon: "When AMC/warranty is due for renewal",
  };
  const base = map[event] ?? event;
  if (event === "stage_change" && stage) {
    return `${base} → ${STAGE_LABELS[stage] ?? stage}`;
  }
  return base;
}

// ─── Confirm Dialog (shared destructive-action guard) ─────────────────────────

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={loading} onClick={onConfirm}>
            {loading ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Sequence Dialog ───────────────────────────────────────────────────

function CreateSequenceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (seq: NurturingSequence) => void;
}) {
  const { user } = useAuth();
  const isManufacturing = user?.org?.workspaceType === "MANUFACTURING";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState("manual");
  const [triggerStage, setTriggerStage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const seq = await createSequence({
        name: name.trim(),
        description: description.trim() || undefined,
        triggerEvent: trigger,
        triggerStage: trigger === "stage_change" && triggerStage ? triggerStage : undefined,
      });
      onCreated(seq as NurturingSequence);
      setName("");
      setDescription("");
      setTrigger("manual");
      setTriggerStage("");
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.sequenceCreateFailed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Nurturing Sequence</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MBA Welcome Sequence"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual enrollment</SelectItem>
                {isManufacturing ? (
                  <>
                    <SelectItem value="mfg_lead_created">When a lead is created</SelectItem>
                    <SelectItem value="mfg_lead_nurture">When a lead moves to Nurture</SelectItem>
                    <SelectItem value="quotation_sent">When a quotation is sent</SelectItem>
                    <SelectItem value="opportunity_lost">When a deal is postponed or lost</SelectItem>
                    <SelectItem value="amc_due_soon">When AMC/warranty is due for renewal</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="lead_created">
                      When lead is created
                    </SelectItem>
                    <SelectItem value="stage_change">When stage changes</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          {trigger === "stage_change" && (
            <div className="space-y-1.5">
              <Label>Stage equals</Label>
              <Select
                value={triggerStage || "any"}
                onValueChange={(v) => setTriggerStage(v === "any" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="any">Any stage</SelectItem>
                  {Object.entries(STAGE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : null}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step Dialog ──────────────────────────────────────────────────────────────

function StepDialog({
  open,
  sequenceId,
  editStep,
  stepCount,
  onClose,
  onSaved,
}: {
  open: boolean;
  sequenceId: string;
  editStep: NurturingStep | null;
  stepCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<StepType>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delayDays, setDelayDays] = useState(0);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [waTemplateId, setWaTemplateId] = useState<string>("");
  const attachments = useAttachments();

  // Load saved templates so the user can prefill an email step or pick an approved WhatsApp template.
  useEffect(() => {
    if (!open) return;
    void getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [open]);

  // Email steps may prefill from any email template; WhatsApp steps require an APPROVED template.
  const emailTemplates = templates.filter((t) => t.channel === "EMAIL");
  const approvedWaTemplates = templates.filter(
    (t) => t.channel === "WHATSAPP" && t.status === "APPROVED",
  );
  const selectedWa = approvedWaTemplates.find((t) => t.id === waTemplateId) ?? null;

  const applySavedTemplate = (id: string) => {
    const tmpl = emailTemplates.find((t) => t.id === id);
    if (!tmpl) return;
    if (tmpl.subject) setSubject(tmpl.subject);
    setBody(tmpl.body);
  };

  useEffect(() => {
    if (editStep) {
      setType((editStep.type as StepType) ?? "email");
      setSubject(editStep.subject ?? "");
      setBody(editStep.body ?? "");
      setDelayDays(editStep.delayDays ?? 0);
      const existingIds = editStep.attachmentIds ?? [];
      if (existingIds.length > 0) {
        void getAttachmentsMeta(existingIds).then(attachments.replaceAll);
      } else {
        attachments.reset();
      }
    } else {
      setType("email");
      setSubject("");
      setBody("");
      setDelayDays(0);
      setWaTemplateId("");
      attachments.reset();
    }
    // attachments' functions are stable across renders (setState setters) — omitting
    // it from deps avoids re-running this hydration on every keystroke it triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStep, open]);

  // Once templates load, preselect the WhatsApp template an edited step already references.
  useEffect(() => {
    if (editStep?.templateName && templates.length) {
      const match = templates.find((t) => t.metaTemplateName === editStep.templateName);
      if (match) setWaTemplateId(match.id);
    }
  }, [editStep, templates]);

  const applyTemplate = () => {
    const tmpl = STEP_TEMPLATES[type];
    if (tmpl.subject !== undefined) setSubject(tmpl.subject);
    setBody(tmpl.body);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        type,
        subject: type === "email" ? subject : undefined,
        body: type === "email" ? body : undefined,
        delayDays,
        stepOrder: editStep?.stepOrder ?? stepCount,
        attachmentIds:
          type === "email" && attachments.attachmentIds.length > 0
            ? attachments.attachmentIds
            : undefined,
        ...(type === "whatsapp" && selectedWa
          ? {
              templateName: selectedWa.metaTemplateName ?? undefined,
              templateLang: selectedWa.language ?? "en_US",
              templateParams: (selectedWa.variables ?? []).map((v) => `{{${v}}}`),
            }
          : {}),
      };
      if (editStep) {
        await updateStep(editStep.id, payload);
      } else {
        await addStep(sequenceId, payload);
      }
      toast.success(editStep ? Messages.nurturing.stepUpdated : Messages.nurturing.stepAdded);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.stepSaveFailed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editStep ? "Edit Step" : "Add Step"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-2">
          {/* Type selector */}
          <div className="space-y-1.5">
            <Label>Step Type</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STEP_TYPES.map(({ key, label, icon: Icon, color }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all",
                    type === key
                      ? `border-2 ${color}`
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick starter (built-in copy) — email only */}
          {type === "email" && (
            <button
              type="button"
              onClick={applyTemplate}
              className="text-xs text-primary hover:underline"
            >
              Use starter copy
            </button>
          )}

          {/* Prefill an email step from a saved email template */}
          {type === "email" && emailTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Use a saved template</Label>
              <Select onValueChange={applySavedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template to prefill…" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {emailTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.isSystem ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Subject (email only) */}
          {type === "email" && (
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>
          )}

          {/* Body (email only) */}
          {type === "email" && (
            <div className="space-y-1.5">
              <Label>Message</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="HTML supported. Use {{name}}, {{course}}, {{org}} as variables"
                rows={5}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              />
              <p className="text-xs text-muted-foreground">
                HTML supported. Variables: {"{{name}}"}, {"{{course}}"},{" "}
                {"{{email}}"}, {"{{phone}}"}, {"{{org}}"}
              </p>
            </div>
          )}

          {/* Attachments (email only) — reused for every enrollment that reaches this step */}
          {type === "email" && (
            <div className="space-y-1.5">
              <Label>Attachments</Label>
              <AttachmentPicker
                attachments={attachments.attachments}
                uploading={attachments.uploading}
                onAddFiles={(files) => void attachments.addFiles(files)}
                onRemove={attachments.remove}
              />
            </div>
          )}

          {/* WhatsApp — pick an approved Meta template (free-form WhatsApp can't reach cold leads) */}
          {type === "whatsapp" && (
            <div className="space-y-1.5">
              <Label>WhatsApp template</Label>
              {approvedWaTemplates.length === 0 ? (
                <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-3">
                  No approved WhatsApp templates yet. Create one on the{" "}
                  <span className="font-medium text-foreground">Templates</span> page and wait for
                  WhatsApp approval — only approved templates can be used here.
                </p>
              ) : (
                <>
                  <Select value={waTemplateId} onValueChange={setWaTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an approved template…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {approvedWaTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.isSystem ? " (Default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedWa && (
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {selectedWa.body}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Variables are filled per lead from {"{{name}}"}, {"{{course}}"}, {"{{org}}"}.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Delay */}
          <div className="space-y-1.5">
            <Label>
              Wait{" "}
              {delayDays === 0
                ? "(send immediately)"
                : `${delayDays} day(s) after previous step`}
            </Label>
            <Input
              type="number"
              min={0}
              value={delayDays}
              onChange={(e) => setDelayDays(Number(e.target.value))}
              className="w-32"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (type === "whatsapp" && !selectedWa)}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : null}
              {editStep ? "Save" : "Add Step"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Enroll Lead Dialog ───────────────────────────────────────────────────────

function EnrollDialog({
  open,
  sequenceId,
  onClose,
  onEnrolled,
}: {
  open: boolean;
  sequenceId: string;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void getLeads({ limit: 50, search: search || undefined })
      .then((res) => setLeads(res.data))
      .finally(() => setLoading(false));
  }, [open, search]);

  const submit = async () => {
    if (!selected) return;
    setEnrolling(true);
    try {
      await enrollLead(sequenceId, selected);
      toast.success(Messages.nurturing.leadEnrolled);
      onEnrolled();
      setSelected(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.enrollFailed));
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enroll a Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads…"
              className="pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1 border border-border rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : leads.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No leads found
              </p>
            ) : (
              leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => setSelected(lead.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    selected === lead.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/50",
                  )}
                >
                  <Avatar className="w-7 h-7 flex-shrink-0">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {initials(lead.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {lead.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {lead.email ?? lead.phone}
                    </p>
                  </div>
                  <StatusBadge status={lead.stage} />
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!selected || enrolling}
              onClick={() => void submit()}
            >
              {enrolling ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <UserPlus className="w-4 h-4 mr-1" />
              )}
              Enroll
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sequence Card (list view) ────────────────────────────────────────────────

function SequenceCard({
  seq,
  onClick,
  onDelete,
}: {
  seq: NurturingSequence;
  onClick: () => void;
  onDelete: () => void;
}) {
  const steps = seq.steps ?? [];
  const enrolledCount = seq._count?.enrollments ?? seq.enrollments?.length ?? 0;
  const stepCount = seq._count?.steps ?? steps.length;

  return (
    <div
      className="bg-card border border-card-border rounded-xl p-5 cursor-pointer hover:shadow-md transition-all group relative"
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{seq.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {triggerLabel(seq.triggerEvent, seq.triggerStage)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full border font-medium",
              seq.isActive
                ? "bg-green-500/10 text-green-600 border-green-500/20"
                : "bg-muted text-muted-foreground border-border",
            )}
          >
            {seq.isActive ? "Active" : "Paused"}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Delete sequence"
            title="Delete sequence"
            className="p-2 md:p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors md:opacity-0 md:group-hover:opacity-100"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {seq.description && (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
          {seq.description}
        </p>
      )}

      {/* Step type pills */}
      <div className="flex gap-1.5 flex-wrap mb-4 min-h-[24px]">
        {steps.slice(0, 6).map((s) => {
          const cfg = stepTypeConfig(s.type);
          const Icon = cfg.icon;
          return (
            <div
              key={s.id}
              className={cn(
                "w-6 h-6 rounded-md border flex items-center justify-center",
                cfg.color,
              )}
              title={cfg.label}
            >
              <Icon className="w-3 h-3" />
            </div>
          );
        })}
        {stepCount > 6 && (
          <div className="w-6 h-6 rounded-md border border-border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
            +{stepCount - 6}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </span>
        <span>{enrolledCount} enrolled</span>
        <ChevronRight className="w-3.5 h-3.5 ml-auto" />
      </div>
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

const ENROLLMENTS_PAGE_SIZE = 20;

function SequenceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [seq, setSeq] = useState<NurturingSequence | null>(null);
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<NurturingStep | null>(null);
  const [toggling, setToggling] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: "step" | "enrollment";
    id: string;
    title: string;
    body: string;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [enrollments, setEnrollments] = useState<NurturingEnrollment[]>([]);
  const [enrollmentsTotal, setEnrollmentsTotal] = useState(0);
  const [enrollmentsPage, setEnrollmentsPage] = useState(1);
  const [enrollmentsPages, setEnrollmentsPages] = useState(1);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await getSequence(id);
      setSeq(s);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.sequenceLoadFailed));
    }
  }, [id]);

  const loadEnrollments = useCallback(
    async (page: number) => {
      setEnrollmentsLoading(true);
      try {
        const res = await getSequenceEnrollments(id, page, ENROLLMENTS_PAGE_SIZE);
        setEnrollments(res.data);
        setEnrollmentsTotal(res.total);
        setEnrollmentsPages(res.pages);
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.nurturing.sequenceLoadFailed));
      } finally {
        setEnrollmentsLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadEnrollments(enrollmentsPage);
  }, [loadEnrollments, enrollmentsPage]);

  const handleToggle = async () => {
    if (!seq) return;
    setToggling(true);
    try {
      await updateSequence(seq.id, { isActive: !seq.isActive });
      await load();
      toast.success(seq.isActive ? Messages.nurturing.sequencePaused : Messages.nurturing.sequenceActivated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.sequenceUpdateFailed));
    } finally {
      setToggling(false);
    }
  };

  const runConfirm = async () => {
    if (!confirmTarget) return;
    setConfirmLoading(true);
    try {
      if (confirmTarget.kind === "step") {
        await deleteStep(confirmTarget.id);
        await load();
      } else {
        await removeEnrollment(confirmTarget.id);
        await Promise.all([load(), loadEnrollments(enrollmentsPage)]);
      }
      toast.success(
        confirmTarget.kind === "step"
          ? Messages.nurturing.stepRemoved
          : Messages.nurturing.enrollmentRemoved,
      );
      setConfirmTarget(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.removeFailed));
    } finally {
      setConfirmLoading(false);
    }
  };

  if (!seq)
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );

  const enrolledCount = seq._count?.enrollments ?? enrollmentsTotal;

  return (
    <>
      <Header
        title={seq.name}
        subtitle={`${seq.steps.length} steps · ${enrolledCount} enrolled`}
        onBack={onBack}
      />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {[
            { label: "Enrolled", value: String(enrolledCount) },
            { label: "Completion", value: "—" },
            { label: "Reply rate", value: "—" },
            { label: "Converted", value: "—" },
          ].map((tile) => (
            <div
              key={tile.label}
              className="bg-card border border-card-border rounded-xl p-3"
            >
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                {tile.label}
              </p>
              <p className="font-mono text-lg font-bold text-foreground mt-0.5">
                {tile.value}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {/* Left — Steps */}
          <div className="md:col-span-3 space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-foreground">Steps</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={toggling}
                    onClick={() => void handleToggle()}
                  >
                    {toggling ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : seq.isActive ? (
                      "Pause"
                    ) : (
                      "Activate"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEnrollDialogOpen(true);
                    }}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1" />
                    Enroll Lead
                  </Button>
                </div>
              </div>

              {seq.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No steps yet. Add the first step below.
                </p>
              ) : (
                <div className="space-y-1">
                  {seq.steps.map((step, idx) => {
                    const cfg = stepTypeConfig(step.type);
                    const Icon = cfg.icon;
                    return (
                      <div key={step.id}>
                        <div className="flex items-start gap-3 p-3 rounded-xl border border-transparent hover:border-border hover:bg-muted/20 group transition-all">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0",
                              cfg.color,
                            )}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {cfg.label}
                              {step.delayDays > 0 && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  after {step.delayDays}d
                                </span>
                              )}
                            </p>
                            {step.subject && (
                              <p className="text-xs text-muted-foreground truncate">
                                {step.subject}
                              </p>
                            )}
                            {step.body && step.type !== "wait" && (
                              <p className="text-xs text-muted-foreground truncate">
                                {step.body}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingStep(step);
                                setStepDialogOpen(true);
                              }}
                              aria-label="Edit step"
                              title="Edit step"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() =>
                                setConfirmTarget({
                                  kind: "step",
                                  id: step.id,
                                  title: "Remove step",
                                  body: "This step will be permanently removed from the sequence.",
                                })
                              }
                              aria-label="Delete step"
                              title="Delete step"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {idx < seq.steps.length - 1 && (
                          <div className="w-px h-3 bg-border ml-7" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => {
                  setEditingStep(null);
                  setStepDialogOpen(true);
                }}
                className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Step
              </button>
            </div>
          </div>

          {/* Right — Enrollments + Info */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <p className="font-semibold text-foreground">Enrolled Leads</p>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {enrolledCount}
                </span>
              </div>
              {enrollmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="sm" />
                </div>
              ) : enrollments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No leads enrolled yet
                </p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {enrollments.map((enrollment: NurturingEnrollment) => (
                    <div
                      key={enrollment.id}
                      className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/30 group"
                    >
                      <Avatar className="w-7 h-7 flex-shrink-0">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {initials(enrollment.lead?.name ?? "?")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {enrollment.lead?.name ?? enrollment.leadId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Step {enrollment.currentStep + 1} ·{" "}
                          <span
                            className={cn(
                              enrollment.status === "active"
                                ? "text-green-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {enrollment.status}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          setConfirmTarget({
                            kind: "enrollment",
                            id: enrollment.id,
                            title: "Remove enrollment",
                            body: `Remove ${enrollment.lead?.name ?? "this lead"} from the sequence?`,
                          })
                        }
                        aria-label="Remove enrollment"
                        title="Remove enrollment"
                        className="p-1 rounded opacity-60 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {enrollmentsPages > 1 && (
                <Pagination
                  page={enrollmentsPage}
                  totalPages={enrollmentsPages}
                  onPageChange={setEnrollmentsPage}
                  className="justify-center mt-3 pt-3 border-t border-card-border"
                />
              )}
            </div>

            <div className="bg-card border border-card-border rounded-xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Sequence Info
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trigger</span>
                  <span className="text-foreground font-medium">
                    {triggerLabel(seq.triggerEvent, seq.triggerStage)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={cn(
                      "font-medium",
                      seq.isActive ? "text-green-600" : "text-muted-foreground",
                    )}
                  >
                    {seq.isActive ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Steps</span>
                  <span className="text-foreground font-medium">
                    {seq.steps.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground font-medium">
                    {formatDateTime(seq.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <StepDialog
        open={stepDialogOpen}
        sequenceId={seq.id}
        editStep={editingStep}
        stepCount={seq.steps.length}
        onClose={() => {
          setStepDialogOpen(false);
          setEditingStep(null);
        }}
        onSaved={() => {
          setStepDialogOpen(false);
          setEditingStep(null);
          void load();
        }}
      />

      <EnrollDialog
        open={enrollDialogOpen}
        sequenceId={seq.id}
        onClose={() => setEnrollDialogOpen(false)}
        onEnrolled={() => {
          setEnrollDialogOpen(false);
          void Promise.all([load(), loadEnrollments(enrollmentsPage)]);
        }}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget?.title ?? ""}
        body={confirmTarget?.body ?? ""}
        confirmLabel="Remove"
        loading={confirmLoading}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirmTarget(null)}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NurturingPage() {
  const [sequences, setSequences] = useState<NurturingSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NurturingSequence | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const seqs = await getSequences();
      setSequences(seqs);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.sequencesLoadFailed));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSequence(deleteTarget.id);
      setSequences((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      toast.success(Messages.nurturing.sequenceDeleted);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.nurturing.sequenceDeleteFailed));
    } finally {
      setDeleting(false);
    }
  };

  if (view === "detail" && selectedId) {
    return (
      <SequenceDetail
        id={selectedId}
        onBack={() => {
          setView("list");
          setSelectedId(null);
          void load();
        }}
      />
    );
  }

  return (
    <>
      <Header
        title="Lead Nurturing"
        subtitle="Build sequences to guide leads through your pipeline"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Sequence
          </Button>
        }
      />

      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Spinner size="lg" />
          </div>
        ) : sequences.length === 0 ? (
          <EmptyState
            title="No sequences yet"
            description="Create your first nurturing sequence to guide leads automatically."
            icon={<Zap className="w-6 h-6" />}
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                New Sequence
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sequences.map((seq) => (
              <SequenceCard
                key={seq.id}
                seq={seq}
                onClick={() => {
                  setSelectedId(seq.id);
                  setView("detail");
                }}
                onDelete={() => setDeleteTarget(seq)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete sequence"
        body={`Delete "${deleteTarget?.name ?? ""}"? Its steps and enrollments will be removed.`}
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <CreateSequenceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(seq) => {
          setCreateOpen(false);
          setSequences((prev) => [seq, ...prev]);
          setSelectedId(seq.id);
          setView("detail");
          toast.success(Messages.nurturing.sequenceCreated);
        }}
      />
    </>
  );
}
