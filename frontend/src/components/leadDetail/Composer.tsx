import { useEffect, useRef, useState, type ElementType } from "react";
import { toast } from "sonner";
import {
  StickyNote,
  Mail,
  Upload,
  Phone,
} from "lucide-react";
import { WhatsAppIcon } from "../shared/WhatsAppIcon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { uploadToS3 } from "../../lib/upload";
import { initCallRecording, completeCallRecording } from "../../api/client";
import { Messages } from "../../lib/messages";
import type { MessageTemplate } from "../../types";
import { AttachmentPicker } from "../AttachmentPicker";
import { useAttachments } from "../../hooks/useAttachments";
import { fillKnownPlaceholders, type TemplateValues } from "../../lib/templateValues";

type ComposerTab = "note" | "whatsapp" | "email" | "sms" | "call";
type WhatsAppMode = "freeform" | "template";

// SMS stays out of TABS (and off the composer) — the "sms" handling below is left in
// place so re-enabling it later is just adding its entry back here.
const TABS: { key: ComposerTab; label: string; icon: ElementType<{ className?: string }> }[] = [
  { key: "note", label: "Note", icon: StickyNote },
  { key: "whatsapp", label: "WhatsApp", icon: WhatsAppIcon },
  { key: "email", label: "Email", icon: Mail },
  { key: "call", label: "Log call", icon: Phone },
];

interface ComposerProps {
  onSaveNote: (note: string) => Promise<void> | void;
  onSendComm: (
    type: "EMAIL" | "SMS" | "WHATSAPP",
    body: string,
    subject?: string,
    attachmentIds?: string[],
  ) => Promise<void> | void;
  onLogCall: (note: string) => Promise<void> | void;
  // Approved WhatsApp templates the "Template" send mode picks from — free-form text only
  // delivers within 24h of the lead's last inbound message, so a cold/proactive WhatsApp send
  // needs an approved template instead. Omit (or pass []) to hide the mode toggle entirely.
  whatsappTemplates?: MessageTemplate[];
  onSendWhatsAppTemplate?: (
    template: MessageTemplate,
    params: string[],
  ) => Promise<void> | void;
  // Whether free-form WhatsApp is currently allowed for this lead — Meta only permits it
  // within 24h of the lead's last INBOUND message (the customer replying opens the window;
  // us sending them a template does not). Computed server-side from real inbound message
  // timestamps (see LeadsService.findOne). When false and an approved template exists, the
  // "Free-form" mode is disabled and Template mode is forced. Defaults to true so callers
  // that don't pass it (e.g. existing tests) keep free-form available.
  whatsappConversationOpen?: boolean;
  // Saved email templates the Email tab can insert (subject + body). Omit or pass [] to hide
  // the picker.
  emailTemplates?: MessageTemplate[];
  // Lead/org/rep values used to auto-fill template placeholders ({{name}}, {{amount}}, …) —
  // see lib/templateValues.ts. Anything missing here is left for the rep to fill in.
  templateValues?: TemplateValues;
  saving?: boolean;
  // Only required for the "Upload recording" button, which is hidden until a lead exists
  // (e.g. omitted on web/tests that don't exercise that path).
  leadId?: string;
  leadPhone?: string;
  // Fires after a manually-uploaded recording finishes processing, so the parent can
  // refetch the lead and show it in the timeline. Optional so existing callers/tests that
  // don't exercise this path don't need to pass a no-op.
  onRecordingUploaded?: () => void;
}

// Reads an audio File's duration by loading it into a throwaway <audio> element — avoids
// asking the rep to type in a duration for a manually uploaded recording.
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.style.display = "none";
    const url = URL.createObjectURL(file);
    audio.src = url;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.remove();
    };
    audio.addEventListener("loadedmetadata", () => {
      const duration = Math.round(audio.duration);
      cleanup();
      resolve(duration);
    });
    audio.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not read audio duration"));
    });
    document.body.appendChild(audio);
  });
}

export function Composer({
  onSaveNote,
  onSendComm,
  onLogCall,
  whatsappTemplates = [],
  onSendWhatsAppTemplate,
  whatsappConversationOpen = true,
  emailTemplates = [],
  templateValues = {},
  saving = false,
  leadId,
  onRecordingUploaded,
}: ComposerProps) {
  const [tab, setTab] = useState<ComposerTab>("note");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [waMode, setWaMode] = useState<WhatsAppMode>("freeform");
  const [waTemplateId, setWaTemplateId] = useState("");
  const [waParams, setWaParams] = useState<string[]>([]);
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const attachments = useAttachments();

  const approvedWaTemplates = whatsappTemplates.filter((t) => t.status === "APPROVED");
  const selectedWaTemplate = approvedWaTemplates.find((t) => t.id === waTemplateId);
  // Free-form can only be forced off when there's a template to fall back on — with no
  // approved template at all there's no way to reach the lead, so free-form must stay.
  const freeformLocked = approvedWaTemplates.length > 0 && !whatsappConversationOpen;

  useEffect(() => {
    if (freeformLocked && waMode === "freeform") setWaMode("template");
  }, [freeformLocked, waMode]);

  function selectWaTemplate(id: string) {
    setWaTemplateId(id);
    const t = approvedWaTemplates.find((tpl) => tpl.id === id);
    // Pre-fill each variable from the lead where we can; the rep completes the rest.
    setWaParams((t?.variables ?? []).map((variable) => templateValues[variable] ?? ""));
  }

  function selectEmailTemplate(id: string) {
    setEmailTemplateId(id);
    const t = emailTemplates.find((tpl) => tpl.id === id);
    if (!t) return;
    setSubject(fillKnownPlaceholders(t.subject ?? "", templateValues));
    setText(fillKnownPlaceholders(t.body, templateValues));
  }

  async function handleRecordingFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !leadId) return;

    setUploadingRecording(true);
    try {
      const durationSec = await readAudioDuration(file);
      const { recordingId, uploadUrl } = await initCallRecording({
        leadId,
        mimeType: file.type,
        durationSec,
      });
      await uploadToS3(uploadUrl, file);
      await completeCallRecording(recordingId, { durationSec, fileSize: file.size });
      toast.success(Messages.leadDetail.recordingUploaded);
      onRecordingUploaded?.();
    } catch {
      toast.error(Messages.leadDetail.recordingUploadFailed);
    } finally {
      setUploadingRecording(false);
    }
  }

  const switchTab = (next: ComposerTab) => {
    setTab(next);
    setText("");
    setSubject("");
    setWaMode("freeform");
    setWaTemplateId("");
    setWaParams([]);
    setEmailTemplateId("");
    attachments.reset();
  };

  const canSaveWaTemplate =
    tab === "whatsapp" &&
    waMode === "template" &&
    Boolean(selectedWaTemplate) &&
    waParams.every((p) => p.trim());

  async function handleSave() {
    if (tab === "whatsapp" && waMode === "template") {
      if (!selectedWaTemplate || !onSendWhatsAppTemplate) return;
      await onSendWhatsAppTemplate(selectedWaTemplate, waParams);
      setWaTemplateId("");
      setWaParams([]);
      return;
    }
    if (!text.trim()) return;
    if (tab === "note") await onSaveNote(text);
    else if (tab === "call") await onLogCall(text);
    else
      await onSendComm(
        tab.toUpperCase() as "EMAIL" | "SMS" | "WHATSAPP",
        text,
        subject,
        attachments.attachmentIds.length > 0
          ? attachments.attachmentIds
          : undefined,
      );
    setText("");
    setSubject("");
    setEmailTemplateId("");
    attachments.reset();
  }

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="flex items-center border-b border-card-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              title={t.label}
              aria-label={t.label}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] sm:text-[11px] font-medium border-b-2 -mb-px transition-colors min-w-0",
                active
                  ? "border-primary text-foreground bg-primary/10 rounded-t-md"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-full">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-3.5">
        {tab === "call" && leadId && (
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={uploadingRecording}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5" />
              {uploadingRecording ? "Uploading…" : "Upload recording"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => void handleRecordingFileSelected(e)}
            />
          </div>
        )}
        {tab === "email" && (
          <>
            {emailTemplates.length > 0 && (
              <Select value={emailTemplateId} onValueChange={selectEmailTemplate}>
                <SelectTrigger className="mb-2" aria-label="Email template">
                  <SelectValue placeholder="Use a template (optional)" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {emailTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mb-2"
            />
            <AttachmentPicker
              attachments={attachments.attachments}
              uploading={attachments.uploading}
              onAddFiles={(files) => void attachments.addFiles(files)}
              onRemove={attachments.remove}
            />
          </>
        )}
        {tab === "whatsapp" && approvedWaTemplates.length > 0 && (
          <div className="flex gap-1.5 mb-2.5">
            {(["freeform", "template"] as const).map((mode) => {
              const disabled = mode === "freeform" && freeformLocked;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={disabled}
                  title={
                    disabled
                      ? "Free-form unlocks once the lead replies on WhatsApp"
                      : undefined
                  }
                  onClick={() => {
                    if (disabled) return;
                    setWaMode(mode);
                    setWaTemplateId("");
                    setWaParams([]);
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                    waMode === mode
                      ? "bg-primary/15 border-primary text-foreground"
                      : "border-input text-muted-foreground hover:text-foreground",
                    disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground",
                  )}
                >
                  {mode === "freeform" ? "Free-form" : "Template"}
                </button>
              );
            })}
          </div>
        )}
        {tab === "whatsapp" && waMode === "freeform" && (
          <AttachmentPicker
            attachments={attachments.attachments}
            uploading={attachments.uploading}
            onAddFiles={(files) => void attachments.addFiles(files)}
            onRemove={attachments.remove}
          />
        )}
        {tab === "whatsapp" && waMode === "template" ? (
          <div className="space-y-2.5">
            <Select value={waTemplateId} onValueChange={selectWaTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an approved template" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {approvedWaTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedWaTemplate && (
              <>
                <p className="text-xs text-muted-foreground bg-background rounded-md border border-input px-3 py-2 whitespace-pre-wrap">
                  {selectedWaTemplate.body}
                </p>
                {(selectedWaTemplate.variables ?? []).map((variable, i) => (
                  <Input
                    key={`${selectedWaTemplate.id}-${i}`}
                    placeholder={`{{${i + 1}}} — ${variable}`}
                    value={waParams[i] ?? ""}
                    onChange={(e) =>
                      setWaParams((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                  />
                ))}
              </>
            )}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
            }}
            placeholder={
              tab === "note"
                ? "Add a note…"
                : tab === "call"
                  ? "What happened on the call?"
                  : "Write a message…"
            }
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <div className="flex items-center justify-between mt-2">
          <span
            className={cn(
              "text-[11px] text-muted-foreground",
              // "⌘+Enter" is a desktop keyboard shortcut — meaningless (and just wastes
              // space) on a touchscreen with no physical keyboard, so hide it on mobile.
              tab === "whatsapp" && waMode === "template" ? undefined : "hidden sm:inline",
            )}
          >
            {tab === "whatsapp" && waMode === "template"
              ? freeformLocked
                ? "Free-form unlocks once the lead replies on WhatsApp"
                : "Templates can message a lead any time, not just within 24h of their last reply"
              : "⌘+Enter to save"}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={
              tab === "whatsapp" && waMode === "template"
                ? !canSaveWaTemplate || saving
                : !text.trim() || saving
            }
            onClick={() => void handleSave()}
          >
            {tab === "note" ? "Save" : tab === "call" ? "Log Call" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
