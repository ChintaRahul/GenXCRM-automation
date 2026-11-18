import { useEffect, useState } from "react";
import {
  Mail,
  MessageCircle,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Loader2,
  Lock,
  Eye,
  Send,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
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
import { Header } from "../components/layout/Header";
import { EmptyState } from "../components/shared/EmptyState";
import { cn } from "../lib/utils";
import { useTemplates } from "../hooks/useTemplates";
import type { MessageTemplate, TemplateChannel, WhatsappTemplateStatus } from "../types";
import { toast } from "sonner";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

const VARIABLES = "{{name}}, {{course}}, {{email}}, {{phone}}, {{org}}";
const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const LANGUAGES = ["en_US", "en_GB", "en", "hi", "hi_IN"] as const;

const CHANNELS: { key: TemplateChannel; label: string; icon: typeof Mail }[] = [
  { key: "EMAIL", label: "Email", icon: Mail },
  { key: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
];

const STATUS_STYLES: Record<WhatsappTemplateStatus, { label: string; cls: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", cls: "bg-muted text-muted-foreground border-border", icon: FileText },
  PENDING: { label: "Pending approval", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20", icon: Clock },
  APPROVED: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", cls: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle },
};

function StatusBadge({ status, rejectionReason }: { status: WhatsappTemplateStatus; rejectionReason?: string | null }) {
  const { label, cls, icon: Icon } =
    status === "DRAFT" && rejectionReason
      ? { label: "Submission failed", cls: STATUS_STYLES.REJECTED.cls, icon: XCircle }
      : STATUS_STYLES[status];
  return (
    <span className={cn("flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0", cls)}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

// Bodies may be HTML (email). Detect markup so we render a live HTML preview, and strip tags for
// the plain-text card snippet.
const looksHtml = (s: string) => /<[a-z][\s\S]*?>/i.test(s);
const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

type SavePayload = {
  channel: TemplateChannel;
  name: string;
  subject?: string;
  body: string;
  category?: string;
  language?: string;
};

// ─── Create / Edit dialog ───────────────────────────────────────────────────────
function TemplateDialog({
  open,
  channel,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  channel: TemplateChannel;
  initial: MessageTemplate | null;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}) {
  const isEmail = channel === "EMAIL";
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<"html" | "plain">("html");
  const [category, setCategory] = useState<string>("MARKETING");
  const [language, setLanguage] = useState<string>("en_US");
  const [saving, setSaving] = useState(false);

  // Re-seed fields whenever the dialog opens for a different template.
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSubject(initial?.subject ?? "");
      setBody(initial?.body ?? "");
      setCategory(initial?.category ?? "MARKETING");
      setLanguage(initial?.language ?? "en_US");
      setFormat(
        !isEmail ? "plain" : initial && !looksHtml(initial.body ?? "") ? "plain" : "html",
      );
    }
  }, [open, initial, isEmail]);

  const valid = name.trim() && body.trim() && (!isEmail || subject.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({
        channel,
        name: name.trim(),
        subject: isEmail ? subject.trim() : undefined,
        body,
        ...(isEmail ? {} : { category, language }),
      });
    } finally {
      setSaving(false);
    }
  };

  const channelLabel = isEmail ? "Email" : "WhatsApp";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {initial ? "Edit Template" : `New ${channelLabel} Template`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-2 overflow-y-auto">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Demo Invitation"
            />
          </div>
          {isEmail && (
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>
          )}
          {!isEmail && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.charAt(0) + c.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{isEmail ? "Body" : "Message"}</Label>
              {isEmail && (
                <div className="flex rounded-md border border-border overflow-hidden text-xs">
                  {(["html", "plain"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={`px-2.5 py-1 transition-colors ${
                        format === f
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {f === "html" ? "HTML" : "Plain text"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                isEmail && format === "html"
                  ? `<p>Hi {{name}},</p> … use ${VARIABLES}`
                  : `Use ${VARIABLES} as variables`
              }
              rows={8}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {isEmail
                ? format === "html"
                  ? "Write HTML markup."
                  : "Plain text — line breaks are kept."
                : "Saving submits this template to WhatsApp for approval. Approval can take a few minutes to hours."}{" "}
              Variables: {VARIABLES}
            </p>
          </div>
          {body.trim() && (
            <div className="space-y-1.5">
              <Label>Preview</Label>
              {isEmail && format === "html" ? (
                <div
                  className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground break-words max-h-48 overflow-y-auto [&_p]:my-1"
                  dangerouslySetInnerHTML={{ __html: body }}
                />
              ) : (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {body}
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !valid}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {initial ? "Save" : isEmail ? "Create" : "Create & submit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirm ─────────────────────────────────────────────────────────────
function ConfirmDialog({
  open,
  name,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  name: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete template</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Delete “{name}”? This can’t be undone.
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={loading} onClick={onConfirm}>
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Read-only view (used for default templates) ─────────────────────────────────
function ViewDialog({
  template,
  onClose,
  onCopy,
  copying,
}: {
  template: MessageTemplate | null;
  onClose: () => void;
  onCopy: () => void;
  copying: boolean;
}) {
  const [showSource, setShowSource] = useState(false);
  useEffect(() => setShowSource(false), [template]);
  if (!template) return null;
  const html = looksHtml(template.body);

  return (
    <Dialog open={!!template} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {template.name}
            {template.isSystem && (
              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium bg-amber-500/10 text-amber-600 border-amber-500/20">
                <Lock className="w-3 h-3" /> Default · read-only
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 overflow-y-auto">
          {template.subject && (
            <div>
              <p className="text-xs text-muted-foreground">Subject</p>
              <p className="text-sm text-foreground">{template.subject}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {template.channel === "EMAIL" ? "Body" : "Message"}
              </p>
              {html && (
                <button
                  type="button"
                  onClick={() => setShowSource((v) => !v)}
                  className="text-xs text-primary hover:underline"
                >
                  {showSource ? "Show preview" : "Show HTML source"}
                </button>
              )}
            </div>
            {html && !showSource ? (
              <div
                className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground break-words max-h-72 overflow-y-auto [&_p]:my-1"
                dangerouslySetInnerHTML={{ __html: template.body }}
              />
            ) : (
              <pre className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono">
                {template.body}
              </pre>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onCopy} disabled={copying}>
            {copying ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            Make a copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  onEdit,
  onView,
  onDelete,
  onCopy,
  onSubmit,
  copying,
  submitting,
}: {
  template: MessageTemplate;
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onSubmit: () => void;
  copying: boolean;
  submitting: boolean;
}) {
  const isWa = template.channel === "WHATSAPP";
  const status = template.status ?? undefined;
  const pending = status === "PENDING";
  const canSubmit = isWa && (status === "DRAFT" || status === "REJECTED");

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate" title={template.name}>
            {template.name}
          </p>
          {template.subject && (
            <p className="text-xs text-muted-foreground truncate mt-0.5" title={template.subject}>
              {template.subject}
            </p>
          )}
        </div>
        {template.isSystem ? (
          <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0 bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Lock className="w-3 h-3" /> Default
          </span>
        ) : (
          status && <StatusBadge status={status} rejectionReason={template.rejectionReason} />
        )}
      </div>

      <p className="text-sm text-muted-foreground line-clamp-3 break-words">
        {stripHtml(template.body)}
      </p>

      {(status === "REJECTED" || status === "DRAFT") && template.rejectionReason && (
        <p className="text-xs text-destructive line-clamp-2 break-words" title={template.rejectionReason}>
          {template.rejectionReason}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1 mt-auto flex-wrap">
        {template.isSystem ? (
          <>
            <Button size="sm" variant="outline" onClick={onView}>
              <Eye className="w-3.5 h-3.5 mr-1" /> View
            </Button>
            <Button size="sm" variant="ghost" onClick={onCopy} disabled={copying}>
              {copying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              Make a copy
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={pending}
              title={pending ? "Awaiting WhatsApp approval" : undefined}
            >
              <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            {canSubmit && (
              <Button size="sm" onClick={onSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                {status === "REJECTED" ? "Resubmit" : "Submit for approval"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onCopy} disabled={copying}>
              {copying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              Duplicate
            </Button>
            <button
              onClick={onDelete}
              aria-label="Delete template"
              className="ml-auto p-2.5 md:p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────
export default function TemplatesPage() {
  const { templates, loading, create, update, remove, copy, submit, refreshWhatsapp } = useTemplates();
  const [channel, setChannel] = useState<TemplateChannel>("EMAIL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewTarget, setViewTarget] = useState<MessageTemplate | null>(null);

  const visible = templates.filter((t) => t.channel === channel);
  const channelLabel = channel === "EMAIL" ? "email" : "WhatsApp";
  const isWa = channel === "WHATSAPP";

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (t: MessageTemplate) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const save = async (payload: SavePayload) => {
    try {
      if (editing) {
        await update(editing.id, payload);
        toast.success(Messages.templates.updated);
      } else {
        await create(payload);
        toast.success(Messages.templates.created);
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.templates.saveFailed));
    }
  };

  const doCopy = async (t: MessageTemplate) => {
    setCopyingId(t.id);
    try {
      const copied = await copy(t.id);
      toast.success(Messages.templates.copyCreated);
      setViewTarget(null);
      setChannel(copied.channel);
      openEdit(copied);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.templates.copyFailed));
    } finally {
      setCopyingId(null);
    }
  };

  const doSubmit = async (t: MessageTemplate) => {
    setSubmittingId(t.id);
    try {
      await submit(t.id);
      toast.success(Messages.templates.submitted);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.templates.submitFailed));
    } finally {
      setSubmittingId(null);
    }
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshWhatsapp();
      toast.success(Messages.templates.refreshed);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.templates.refreshFailed));
    } finally {
      setRefreshing(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      toast.success(Messages.templates.deleted);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.templates.deleteFailed));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Header
        title="Templates"
        subtitle="Reusable email & WhatsApp content for nurturing sequences"
        actions={
          <div className="flex items-center gap-2">
            {isWa && (
              <Button onClick={() => void doRefresh()} size="sm" variant="outline" disabled={refreshing}>
                <RefreshCw className={cn("w-4 h-4 mr-1", refreshing && "animate-spin")} /> Refresh status
              </Button>
            )}
            <Button onClick={openCreate} size="sm">
              <Plus className="w-4 h-4 mr-1" /> New Template
            </Button>
          </div>
        }
      />
      <div className="p-4 sm:p-6 space-y-5">
        {/* Channel toggle */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {CHANNELS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setChannel(key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 max-[767px]:min-h-11 transition-colors",
                channel === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <Spinner size="lg" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={isWa ? <MessageCircle className="w-10 h-10" /> : <Mail className="w-10 h-10" />}
            title={`No ${channelLabel} templates yet`}
            description={
              isWa
                ? "Create a template — it’s submitted to WhatsApp for approval, then usable in nurturing."
                : "Create a reusable template to use across your nurturing sequences."
            }
            action={
              <Button onClick={openCreate} size="sm">
                <Plus className="w-4 h-4 mr-1" /> New Template
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => openEdit(t)}
                onView={() => setViewTarget(t)}
                onDelete={() => setDeleteTarget(t)}
                onCopy={() => void doCopy(t)}
                onSubmit={() => void doSubmit(t)}
                copying={copyingId === t.id}
                submitting={submittingId === t.id}
              />
            ))}
          </div>
        )}
      </div>

      <TemplateDialog
        open={dialogOpen}
        channel={editing?.channel ?? channel}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSave={save}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        name={deleteTarget?.name ?? ""}
        loading={deleting}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleteTarget(null)}
      />
      <ViewDialog
        template={viewTarget}
        onClose={() => setViewTarget(null)}
        onCopy={() => viewTarget && void doCopy(viewTarget)}
        copying={!!viewTarget && copyingId === viewTarget.id}
      />
    </>
  );
}
