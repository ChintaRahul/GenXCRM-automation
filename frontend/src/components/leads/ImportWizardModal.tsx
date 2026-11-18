import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Upload,
  Check,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  LayoutTemplate,
  Plus,
  X,
  ArrowLeft,
} from "lucide-react";
import { Spinner } from "../ui/Spinner";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogOverlay, DialogPortal } from "../ui/dialog";
import { importLeads } from "../../api/client";
import { useLeadStats } from "../../context/LeadStatsContext";
import { useImportMappings } from "../../hooks/useImportMappings";
import { useFieldMappings } from "../../hooks/useFieldMappings";
import { toast } from "sonner";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { ImportResult } from "../../types";
import { cn } from "../../lib/utils";

// ─── CRM fields and alias table ───────────────────────────────────────────────

interface CrmField {
  key: string;
  label: string;
  required: boolean;
  customField?: boolean;
  group?: string;
}

// Static fields every org sees. Org-specific fields configured in Administration >
// Field Mappings (core-field aliases + custom field definitions) are merged in at
// render time — see useMemo(buildCrmFields) below.
const BASE_CRM_FIELDS: CrmField[] = [
  // Core identity
  { key: "name", label: "Full Name", required: true, group: "Identity" },
  { key: "phone", label: "Phone", required: true, group: "Identity" },
  { key: "altPhone", label: "Alt Phone", required: false, group: "Identity" },
  { key: "email", label: "Email", required: false, group: "Identity" },
  { key: "altEmail", label: "Alt Email", required: false, group: "Identity" },
  {
    key: "location",
    label: "City / Location",
    required: false,
    group: "Identity",
  },
  { key: "language", label: "Language", required: false, group: "Identity" },
  {
    key: "tags",
    label: "Tags",
    required: false,
    group: "Identity",
  },
  // Program interest
  {
    key: "course",
    label: "Course / Program",
    required: false,
    group: "Program",
  },
  // Ad attribution
  {
    key: "source",
    label: "Platform (Source)",
    required: false,
    group: "Attribution",
  },
  {
    key: "sourceCampaign",
    label: "Campaign Name",
    required: false,
    group: "Attribution",
  },
  {
    key: "sourceAdSet",
    label: "Ad Set Name",
    required: false,
    group: "Attribution",
  },
  {
    key: "sourceAd",
    label: "Ad Name / Creative",
    required: false,
    group: "Attribution",
  },
  // Education qualification (stored as customFields)
  {
    key: "currentStatus",
    label: "Current Status",
    required: false,
    group: "Qualification",
    customField: true,
  },
  {
    key: "motivation",
    label: "Learning Goal",
    required: false,
    group: "Qualification",
    customField: true,
  },
  {
    key: "startTimeline",
    label: "Start Timeline",
    required: false,
    group: "Qualification",
    customField: true,
  },
  {
    key: "liveClassAvailable",
    label: "Live Class Available",
    required: false,
    group: "Qualification",
    customField: true,
  },
];

const SOURCE_OPTIONS = [
  "FACEBOOK",
  "GOOGLE_ADS",
  "WEBSITE",
  "INSTAGRAM",
  "WALK_IN",
  "REFERRAL",
  "OUTBOUND_CALL",
  "CHAT",
  "API",
  "OTHER",
];

const SOURCE_ALIASES: Record<string, string> = {
  // Facebook / Meta
  fb: "FACEBOOK",
  facebook: "FACEBOOK",
  meta: "FACEBOOK",
  "facebook ads": "FACEBOOK",
  "fb ads": "FACEBOOK",
  "social media": "FACEBOOK",
  social: "FACEBOOK",
  // Instagram
  instagram: "INSTAGRAM",
  ig: "INSTAGRAM",
  insta: "INSTAGRAM",
  // Google
  google: "GOOGLE_ADS",
  "google ads": "GOOGLE_ADS",
  adwords: "GOOGLE_ADS",
  "google adwords": "GOOGLE_ADS",
  sem: "GOOGLE_ADS",
  ppc: "GOOGLE_ADS",
  // Website / organic
  website: "WEBSITE",
  web: "WEBSITE",
  organic: "WEBSITE",
  seo: "WEBSITE",
  "website form": "WEBSITE",
  // Walk-in
  "walk in": "WALK_IN",
  "walk-in": "WALK_IN",
  walkin: "WALK_IN",
  offline: "WALK_IN",
  "direct walk in": "WALK_IN",
  // Referral
  referral: "REFERRAL",
  reference: "REFERRAL",
  referred: "REFERRAL",
  "word of mouth": "REFERRAL",
  // Outbound / cold call
  "outbound call": "OUTBOUND_CALL",
  "cold call": "OUTBOUND_CALL",
  outbound: "OUTBOUND_CALL",
  telecalling: "OUTBOUND_CALL",
  tele: "OUTBOUND_CALL",
  call: "OUTBOUND_CALL",
  // Chat / WhatsApp
  chat: "CHAT",
  whatsapp: "CHAT",
  wa: "CHAT",
  message: "CHAT",
  "live chat": "CHAT",
  // API
  api: "API",
  // LinkedIn → OTHER (not a supported source enum value)
  linkedin: "OTHER",
};

function normalizeSource(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (SOURCE_OPTIONS.includes(upper)) return upper;
  return SOURCE_ALIASES[raw.trim().toLowerCase()] ?? "OTHER";
}

const STATIC_FIELD_ALIASES: Record<string, string[]> = {
  // Identity
  altPhone: [
    "alt_phone",
    "alt phone",
    "alternate phone",
    "alternate_phone",
    "secondary phone",
    "secondary_phone",
    "whatsapp number",
    "whatsapp_number",
  ],
  altEmail: [
    "alt_email",
    "alt email",
    "alternate email",
    "alternate_email",
    "secondary email",
    "secondary_email",
  ],
  language: ["language", "preferred language", "preferred_language", "lang"],
  tags: ["tags", "tag", "labels", "label"],
  name: [
    "name",
    "fullname",
    "full name",
    "full_name",
    "leadname",
    "lead name",
    "studentname",
    "student name",
    "customername",
    "customer name",
    "client",
    "contact name",
  ],
  phone: [
    "phone",
    "mobile",
    "phonenumber",
    "phone number",
    "phone_number",
    "mobilenumber",
    "mobile number",
    "contact",
    "cell",
    "telephone",
    "mob",
    "ph",
  ],
  email: [
    "email",
    "emailaddress",
    "email address",
    "email_address",
    "mail",
    "email id",
    "emailid",
  ],
  location: [
    "location",
    "city",
    "area",
    "state",
    "region",
    "address",
    "district",
    "locality",
    "place",
  ],
  // Program
  course: [
    "course",
    "program",
    "programme",
    "product",
    "service",
    "interest",
    "batch",
    "coursename",
    "form_name",
    "formname",
    "batch name",
    "class",
    "training",
    "workshop",
  ],
  // Attribution — auto-detect Meta Ads export column names
  source: [
    "source",
    "leadsource",
    "lead source",
    "channel",
    "utmsource",
    "utm_source",
    "platform",
    "medium",
    "network",
  ],
  sourceCampaign: [
    "campaign",
    "campaign_name",
    "campaign name",
    "campaignname",
    "utm_campaign",
    "utmcampaign",
    "campaign id",
  ],
  sourceAdSet: [
    "adset",
    "adset_name",
    "adset name",
    "adsetname",
    "ad set",
    "ad_set",
    "ad set name",
    "ad_set_name",
  ],
  sourceAd: [
    "ad",
    "ad_name",
    "ad name",
    "adname",
    "creative",
    "ad creative",
    "ad title",
  ],
  // Education qualification questions (Meta Lead Ads form fields)
  currentStatus: [
    "current_status",
    "current status",
    "currentstatus",
    "what_is_your_current_status?",
    "what_is_your_current_status",
    "status",
    "occupation",
    "profession",
    "profile",
    "background",
    "employment status",
    "job status",
  ],
  motivation: [
    "motivation",
    "why_do_you_want_to_learn_digital_marketing?",
    "why_do_you_want_to_learn",
    "why_do_you_want_to_learn_digital_marketing",
    "reason",
    "goal",
    "learning_goal",
    "learning goal",
    "objective",
    "purpose",
    "intent",
    "why learn",
    "career goal",
  ],
  startTimeline: [
    "when_do_you_want_to_start?",
    "when_do_you_want_to_start",
    "start_timeline",
    "start timeline",
    "starttimeline",
    "timeline",
    "urgency",
    "joining_timeline",
    "joining timeline",
    "when to start",
    "start date",
    "preferred start",
  ],
  liveClassAvailable: [
    "are_you_comfortable_attending_live_classes_+_internship_program?",
    "are_you_comfortable_attending_live_classes",
    "are_you_comfortable_attending_live_classes_+_internship_program",
    "live_class_available",
    "live class available",
    "live class",
    "availability",
    "can_attend",
    "can_attend_live",
    "live class comfort",
    "internship availability",
  ],
};

type Mapping = Record<string, string>;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function autoDetectMapping(
  headers: string[],
  fieldAliases: Record<string, string[]>,
): Mapping {
  const result: Mapping = {};
  for (const [field, aliases] of Object.entries(fieldAliases)) {
    for (let i = 0; i < headers.length; i++) {
      if (aliases.some((a) => normalize(a) === normalize(headers[i]))) {
        result[field] = String(i);
        break;
      }
    }
  }
  return result;
}

// Splits an org's comma-separated alias string (Administration > Field Mappings)
// into the array shape autoDetectMapping expects — same format the CSV wizard's
// own STATIC_FIELD_ALIASES already use.
function splitAliases(aliases: string): string[] {
  return aliases
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

function mappingToTemplate(
  mapping: Mapping,
  headers: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, idxStr] of Object.entries(mapping)) {
    const idx = Number(idxStr);
    if (headers[idx]) result[field] = headers[idx];
  }
  return result;
}

function templateToMapping(
  template: Record<string, string>,
  headers: string[],
): Mapping {
  const result: Mapping = {};
  for (const [field, headerName] of Object.entries(template)) {
    const idx = headers.findIndex(
      (h) => normalize(h) === normalize(headerName),
    );
    if (idx !== -1) result[field] = String(idx);
  }
  return result;
}

// ─── Wizard step labels ───────────────────────────────────────────────────────

const WIZARD_STEPS = ["Upload", "Map Fields", "Importing", "Done"] as const;

// Keeps each POST /leads/import request small and fast — large files (10K+ rows)
// are sent in sequential batches instead of one giant payload, so a single
// request never risks the proxy's read timeout or a body-size limit.
const IMPORT_BATCH_SIZE = 300;

// ─── CSV Import Modal Wizard ──────────────────────────────────────────────────

interface WizardProps {
  open: boolean;
  onClose: () => void;
  initialTemplate?: Record<string, string>;
  templateOnly?: boolean;
  onImported?: () => void;
}

export function ImportWizardModal({
  open,
  onClose,
  initialTemplate,
  templateOnly = false,
  onImported,
}: WizardProps) {
  const navigate = useNavigate();
  const { refresh: refreshStats } = useLeadStats();
  const { mappings: savedTemplates, createMapping } = useImportMappings();
  const { mapping: orgFieldMapping } = useFieldMappings();

  // Org-specific fields configured in Administration > Field Mappings — one extra
  // mappable row per custom field definition, plus the org's own alias list merged
  // into auto-detection for both the static and custom fields.
  const crmFields = useMemo<CrmField[]>(() => {
    const customRows: CrmField[] = (orgFieldMapping?.customFieldDefs ?? []).map(
      (def) => ({
        key: def.id,
        label: def.name || "Untitled field",
        required: false,
        customField: true,
        group: "Organization",
      }),
    );
    return [...BASE_CRM_FIELDS, ...customRows];
  }, [orgFieldMapping]);

  const fieldAliases = useMemo<Record<string, string[]>>(() => {
    const merged: Record<string, string[]> = {};
    for (const [field, aliases] of Object.entries(STATIC_FIELD_ALIASES)) {
      merged[field] = [...aliases];
    }
    for (const [field, aliasStr] of Object.entries(
      orgFieldMapping?.coreFieldAliases ?? {},
    )) {
      merged[field] = [...(merged[field] ?? []), ...splitAliases(aliasStr)];
    }
    for (const def of orgFieldMapping?.customFieldDefs ?? []) {
      merged[def.id] = splitAliases(def.aliases);
    }
    return merged;
  }, [orgFieldMapping]);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(templateOnly ? 2 : 1);
  const [isDragging, setIsDragging] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pendingTemplate, setPendingTemplate] = useState<Record<
    string,
    string
  > | null>(initialTemplate ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef(step);
  stepRef.current = step; // keep fresh every render so the native drop handler reads latest step
  const handleFileRef = useRef<(file: File) => void>(() => {});

  // Save-as-template inline state
  const [showSaveForm, setShowSaveForm] = useState(templateOnly);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  // Discard confirm dialog
  const [showDiscard, setShowDiscard] = useState(false);

  const isInProgress =
    (step >= 2 && step < 4) || (step === 1 && pendingTemplate !== null);

  const handleCloseAttempt = () => {
    if (isInProgress) {
      setShowDiscard(true);
    } else {
      doClose();
    }
  };

  const doClose = () => {
    // Reset all wizard state
    setStep(templateOnly ? 2 : 1);
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({});
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setPendingTemplate(null);
    setShowSaveForm(templateOnly);
    setSaveName("");
    setShowDiscard(false);
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  };

  const applyParsed = (headers: string[], rows: string[][]) => {
    if (headers.length === 0 || rows.length === 0) {
      toast.error(Messages.integrations.fileTooShort);
      return;
    }
    setCsvHeaders(headers);
    setCsvRows(rows);
    if (pendingTemplate) {
      setMapping(templateToMapping(pendingTemplate, headers));
      setPendingTemplate(null);
    } else {
      setMapping(autoDetectMapping(headers, fieldAliases));
    }
    setStep(2);
  };

  const parseCsv = (file: File) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: ({ data }) =>
        applyParsed(data[0] as string[], data.slice(1) as string[][]),
      error: () => toast.error(Messages.integrations.csvParseFailed),
    });
  };

  const parseExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), {
          type: "array",
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, {
          header: 1,
          defval: "",
        });
        const headers = (raw[0] ?? []).map(String);
        const rows = raw
          .slice(1)
          .map((r) => headers.map((_, i) => String((r as string[])[i] ?? "")));
        applyParsed(headers, rows);
      } catch {
        toast.error(Messages.integrations.excelParseFailed);
      }
    };
    reader.onerror = () => toast.error(Messages.integrations.fileReadFailed);
    reader.readAsArrayBuffer(file);
  };

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(csv|xlsx|xls)$/i)) {
      toast.error(Messages.integrations.unsupportedFile);
      return;
    }
    if (file.name.match(/\.(xlsx|xls)$/i)) {
      parseExcel(file);
    } else {
      parseCsv(file);
    }
  };
  handleFileRef.current = handleFile; // keep ref fresh so the native drop closure always calls latest

  // Native listeners on window bypass Radix Portal / DialogOverlay z-index interference.
  useEffect(() => {
    if (!open) return;

    const setDragging = (e: DragEvent) => {
      e.preventDefault();
      if (stepRef.current === 1) setIsDragging(true);
    };
    const clearDragging = (e: DragEvent) => {
      if (e.relatedTarget === null) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (stepRef.current !== 1) return;
      const file = e.dataTransfer?.files[0];
      if (!file) {
        // Drag source (e.g. VS Code explorer, text editors) doesn't expose File objects.
        // Only OS file managers (Windows Explorer, Finder) provide them.
        toast.error(Messages.integrations.dragFromExplorer);
        return;
      }
      handleFileRef.current(file);
    };

    window.addEventListener("dragenter", setDragging);
    window.addEventListener("dragover", setDragging);
    window.addEventListener("dragleave", clearDragging);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", setDragging);
      window.removeEventListener("dragover", setDragging);
      window.removeEventListener("dragleave", clearDragging);
      window.removeEventListener("drop", onDrop);
      setIsDragging(false);
    };
  }, [open]);

  const requiredMapped = crmFields.filter((f) => f.required).every(
    (f) => mapping[f.key] !== undefined && mapping[f.key] !== "",
  );

  const doImport = async () => {
    setStep(3);
    const rows = csvRows.map((row) => {
      const obj: Record<string, unknown> = { source: "OTHER" };
      const customFields: Record<string, string> = {};
      crmFields.forEach(({ key, customField }) => {
        const idx = mapping[key] !== undefined ? Number(mapping[key]) : -1;
        if (idx >= 0 && row[idx]) {
          if (customField) {
            customFields[key] = row[idx];
          } else if (key === "tags") {
            obj.tags = row[idx]
              .split(/[,;]/)
              .map((t) => t.trim())
              .filter(Boolean);
          } else {
            obj[key] = key === "source" ? normalizeSource(row[idx]) : row[idx];
          }
        }
      });
      if (Object.keys(customFields).length > 0) obj.customFields = customFields;
      return obj;
    });

    setProgress({ done: 0, total: rows.length });
    const merged: ImportResult = { total: rows.length, imported: 0, skipped: 0, errors: [], warnings: [] };

    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(start, start + IMPORT_BATCH_SIZE);
      try {
        const r = await importLeads(batch);
        merged.imported += r.imported;
        merged.skipped += r.skipped;
        merged.errors.push(
          ...r.errors.map(({ row, reason }) => ({ row: row + start, reason })),
        );
        merged.warnings!.push(
          ...(r.warnings ?? []).map(({ row, reason }) => ({ row: row + start, reason })),
        );
      } catch (err) {
        const reason = apiErrorMessage(err, Messages.integrations.importFailed);
        const remaining = rows.length - start;
        merged.skipped += remaining;
        for (let j = 0; j < remaining; j++) {
          merged.errors.push({ row: start + j + 1, reason });
        }
        toast.error(reason);
        break;
      }
      setProgress({ done: Math.min(start + IMPORT_BATCH_SIZE, rows.length), total: rows.length });
    }

    setResult(merged);
    setStep(4);
    void refreshStats();
    onImported?.();
  };

  const saveTemplate = async (closeAfter: boolean) => {
    if (!saveName.trim()) {
      toast.error(Messages.integrations.templateNameRequired);
      return;
    }
    setSaving(true);
    try {
      await createMapping({
        name: saveName.trim(),
        mappings: mappingToTemplate(mapping, csvHeaders),
      });
      toast.success(Messages.integrations.templateSaved(saveName.trim()));
      setSaveName("");
      setShowSaveForm(false);
      if (closeAfter) doClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.integrations.templateSaveFailed));
    } finally {
      setSaving(false);
    }
  };

  const stepTitle: Record<number, string> = {
    1: "Upload your file",
    2: templateOnly ? "Configure mapping template" : "Map your columns",
    3: "Importing…",
    4: "Import complete",
  };

  return (
    <>
      {/* ── Main wizard dialog ── */}
      <Dialog
        open={open}
        onOpenChange={() => {
          /* controlled — use handleCloseAttempt */
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-[50%] top-[50%] z-50 w-[calc(100vw-2rem)] max-w-2xl translate-x-[-50%] translate-y-[-50%]",
              "bg-card border border-card-border rounded-xl shadow-2xl",
              "flex flex-col max-h-[90dvh]",
              "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
              "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            )}
            onInteractOutside={(e) => {
              e.preventDefault(); // Never close on outside click
              if (isInProgress) setShowDiscard(true);
            }}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              handleCloseAttempt();
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border flex-shrink-0">
              <div>
                <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                  {stepTitle[step]}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground mt-0.5">
                  {templateOnly
                    ? "Template-first mode — save mapping without importing"
                    : `Step ${step} of ${WIZARD_STEPS.length}`}
                </DialogPrimitive.Description>
              </div>
              {/* Step dots */}
              <div className="flex items-center gap-1.5 mx-4">
                {WIZARD_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-full transition-all",
                      step === i + 1
                        ? "w-4 h-2 bg-primary"
                        : step > i + 1
                          ? "w-2 h-2 bg-green-500"
                          : "w-2 h-2 bg-muted-foreground/30",
                    )}
                  />
                ))}
              </div>
              <button
                onClick={handleCloseAttempt}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* ── Step 1: Upload ── */}
              {step === 1 && (
                <div className="space-y-4">
                  {/* Template selector */}
                  {savedTemplates.length > 0 && (
                    <div className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-3 py-2.5">
                      <LayoutTemplate className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-muted-foreground">
                        Apply a saved template:
                      </span>
                      <Select
                        value=""
                        onValueChange={(id) => {
                          const tpl = savedTemplates.find((t) => t.id === id);
                          if (tpl) {
                            setPendingTemplate(tpl.mappings);
                            toast.info(
                              Messages.integrations.templateWillApply(tpl.name),
                            );
                          }
                        }}
                      >
                        <SelectTrigger className="h-6 text-xs w-44 border-dashed">
                          <SelectValue placeholder="Select template…" />
                        </SelectTrigger>
                        <SelectContent>
                          {savedTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {pendingTemplate && (
                        <span className="text-primary font-medium flex items-center gap-1 ml-1">
                          <Check className="w-3 h-3" /> Ready
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    onClick={() => fileRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors select-none",
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-muted/30",
                    )}
                  >
                    <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Upload className="w-7 h-7 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        Drag and drop your file here
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        or click to browse — CSV or Excel (.xlsx) · drag from
                        Windows Explorer
                      </p>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Recognised column names (auto-detected)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      {[
                        {
                          field: "Name",
                          aliases: "full_name, name, student name",
                        },
                        {
                          field: "Phone",
                          aliases: "phone_number, mobile, phone",
                        },
                        { field: "Email", aliases: "email, email address" },
                        {
                          field: "City / Location",
                          aliases: "city, location, area, district",
                        },
                        {
                          field: "Course / Program",
                          aliases: "form_name, course, program, batch",
                        },
                        {
                          field: "Platform (Source)",
                          aliases: "platform, source, channel",
                        },
                        {
                          field: "Campaign Name",
                          aliases: "campaign_name, campaign, utm_campaign",
                        },
                        {
                          field: "Ad Set Name",
                          aliases: "adset_name, adset, ad set",
                        },
                        { field: "Ad Name", aliases: "ad_name, ad, creative" },
                        {
                          field: "Current Status",
                          aliases:
                            "what_is_your_current_status?, current_status",
                        },
                        {
                          field: "Learning Goal",
                          aliases: "why_do_you_want_to_learn…, motivation",
                        },
                        {
                          field: "Start Timeline",
                          aliases: "when_do_you_want_to_start?, timeline",
                        },
                        {
                          field: "Live Class",
                          aliases:
                            "are_you_comfortable_attending…, availability",
                        },
                      ].map(({ field, aliases }) => (
                        <div
                          key={field}
                          className="flex gap-1.5 items-baseline"
                        >
                          <span className="font-medium text-foreground shrink-0">
                            {field}:
                          </span>
                          <span
                            className="text-muted-foreground truncate"
                            title={aliases}
                          >
                            {aliases}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: Map Fields ── */}
              {step === 2 && (
                <div className="space-y-4">
                  {csvHeaders.length > 0 && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {csvHeaders.length} columns detected — fields pre-filled
                        where matched.
                      </p>
                      {savedTemplates.length > 0 && (
                        <Select
                          value=""
                          onValueChange={(id) => {
                            const tpl = savedTemplates.find((t) => t.id === id);
                            if (tpl) {
                              setMapping(
                                templateToMapping(tpl.mappings, csvHeaders),
                              );
                              toast.success(Messages.integrations.templateApplied(tpl.name));
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-44">
                            <LayoutTemplate className="w-3 h-3 mr-1.5" />
                            <SelectValue placeholder="Apply template…" />
                          </SelectTrigger>
                          <SelectContent>
                            {savedTemplates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl border border-border overflow-hidden">
                    {/* Inner overflow-x-auto wrapper — on a narrow phone the fixed CRM Field +
                        Your Column widths add up to wider than the dialog; the outer
                        overflow-hidden clipped instead of scrolling, making the "Your Column"
                        Select trigger unreachable on later rows (see SCRUM-27). */}
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-40">
                            CRM Field
                          </th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Your Column
                          </th>
                          {csvHeaders.length > 0 && (
                            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Sample
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          let lastGroup = "";
                          return crmFields.map(
                            ({ key, label, required, customField, group }) => {
                              const sampleIdx =
                                mapping[key] !== undefined
                                  ? Number(mapping[key])
                                  : -1;
                              const sample =
                                sampleIdx >= 0
                                  ? (csvRows[0]?.[sampleIdx] ?? "")
                                  : "";
                              const isMapped =
                                mapping[key] !== undefined &&
                                mapping[key] !== "";
                              const showGroupHeader =
                                group && group !== lastGroup;
                              if (group) lastGroup = group;
                              return [
                                showGroupHeader ? (
                                  <tr
                                    key={`group-${group}`}
                                    className="border-b border-border bg-muted/50"
                                  >
                                    <td
                                      colSpan={csvHeaders.length > 0 ? 3 : 2}
                                      className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                                    >
                                      {group}
                                      {customField && (
                                        <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/60">
                                          → saved as custom fields
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ) : null,
                                <tr
                                  key={key}
                                  className="border-b border-border last:border-0"
                                >
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-medium text-foreground text-sm">
                                        {label}
                                      </span>
                                      {required && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                                          Required
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {csvHeaders.length > 0 ? (
                                      <div className="flex items-center gap-2">
                                        <Select
                                          value={mapping[key] ?? ""}
                                          onValueChange={(v) =>
                                            setMapping((m) => ({
                                              ...m,
                                              [key]: v,
                                            }))
                                          }
                                        >
                                          <SelectTrigger
                                            className={cn(
                                              "w-48 h-8 text-xs overflow-hidden",
                                              isMapped &&
                                                "border-green-500/50 bg-green-500/5",
                                            )}
                                          >
                                            <span className="truncate flex-1 text-left">
                                              <SelectValue placeholder="— skip —" />
                                            </span>
                                          </SelectTrigger>
                                          <SelectContent
                                            style={{
                                              maxWidth:
                                                "min(calc(var(--radix-select-content-available-width, 100vw) - 1.5rem), 420px)",
                                            }}
                                          >
                                            {csvHeaders.map((h, i) => (
                                              <SelectItem
                                                key={i}
                                                value={String(i)}
                                                title={h}
                                              >
                                                {h}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        {isMapped && (
                                          <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground italic">
                                        Upload a CSV file first
                                      </span>
                                    )}
                                  </td>
                                  {csvHeaders.length > 0 && (
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-[140px]">
                                      {sample || "—"}
                                    </td>
                                  )}
                                </tr>,
                              ];
                            },
                          );
                        })()}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  {csvHeaders.length > 0 && !requiredMapped && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      Map <strong className="mx-1">Name</strong> and{" "}
                      <strong className="mx-1">Phone</strong> columns before
                      continuing.
                    </div>
                  )}

                  {/* Save as template form */}
                  {!showSaveForm ? (
                    <button
                      onClick={() => {
                        setShowSaveForm(true);
                        setSaveName("");
                      }}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Save this mapping as a template
                    </button>
                  ) : (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground">
                        {templateOnly
                          ? "Name your template"
                          : "Save mapping as template"}
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value)}
                          placeholder="e.g. Facebook Leads, IndiaMart Export…"
                          className="flex-1 h-8 text-xs px-2.5 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              void saveTemplate(templateOnly);
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs px-3"
                          disabled={saving || !saveName.trim()}
                          onClick={() => void saveTemplate(templateOnly)}
                        >
                          {saving ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : templateOnly ? (
                            "Save & close"
                          ) : (
                            "Save"
                          )}
                        </Button>
                        {!templateOnly && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs px-3"
                            disabled={saving || !saveName.trim()}
                            onClick={() => void saveTemplate(true)}
                          >
                            Save & close
                          </Button>
                        )}
                        {!templateOnly && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs px-2"
                            onClick={() => setShowSaveForm(false)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 3: Importing ── */}
              {step === 3 && (
                <div className="flex flex-col items-center gap-4 py-16">
                  <Spinner size="lg" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      Importing leads…
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {progress.total > 0
                        ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} rows processed`
                        : `Processing ${csvRows.length.toLocaleString()} rows`}
                    </p>
                  </div>
                  {progress.total > 0 && (
                    <div className="w-full max-w-xs h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{
                          width: `${Math.round((progress.done / progress.total) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 4: Done ── */}
              {step === 4 && result && (
                <div className="space-y-5">
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-9 h-9 text-green-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-foreground">
                        Import complete!
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.total} rows processed
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 text-center">
                      <p className="text-3xl font-bold text-green-600">
                        {result.imported}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Imported
                      </p>
                    </div>
                    <div
                      className={cn(
                        "rounded-xl border p-4 text-center",
                        result.skipped > 0
                          ? "border-amber-500/20 bg-amber-500/5"
                          : "border-border bg-muted/20",
                      )}
                    >
                      <p
                        className={cn(
                          "text-3xl font-bold",
                          result.skipped > 0
                            ? "text-amber-600"
                            : "text-muted-foreground",
                        )}
                      >
                        {result.skipped}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Skipped
                      </p>
                    </div>
                  </div>
                  {result.errors.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2 max-h-36 overflow-y-auto">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Skipped rows
                        {result.errors.length > 100 &&
                          ` (showing first 100 of ${result.errors.length})`}
                      </p>
                      {result.errors.slice(0, 100).map(({ row, reason }) => (
                        <div key={row} className="flex gap-2 text-xs min-w-0">
                          <span className="text-muted-foreground flex-shrink-0">
                            Row {row}
                          </span>
                          <span className="text-destructive truncate" title={reason}>
                            {reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!!result.warnings?.length && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2 max-h-36 overflow-y-auto">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Imported with changes
                        {result.warnings.length > 100 &&
                          ` (showing first 100 of ${result.warnings.length})`}
                      </p>
                      {result.warnings.slice(0, 100).map(({ row, reason }) => (
                        <div key={row} className="flex gap-2 text-xs min-w-0">
                          <span className="text-muted-foreground flex-shrink-0">
                            Row {row}
                          </span>
                          <span className="text-amber-600 truncate" title={reason}>
                            {reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            {step !== 3 && (
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-border flex-shrink-0 bg-muted/20">
                <div>
                  {step === 2 && csvHeaders.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setStep(1)}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {step === 4 ? (
                    <>
                      <Button variant="outline" size="sm" onClick={doClose}>
                        Close
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          doClose();
                          navigate("/leads");
                        }}
                      >
                        View leads
                      </Button>
                    </>
                  ) : step === 2 && !templateOnly ? (
                    <Button
                      size="sm"
                      disabled={csvHeaders.length > 0 && !requiredMapped}
                      onClick={() =>
                        csvHeaders.length > 0 ? void doImport() : undefined
                      }
                    >
                      {csvHeaders.length > 0
                        ? `Import ${csvRows.length} leads`
                        : "Upload a file to continue"}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      {/* ── Discard confirmation dialog ── */}
      <Dialog open={showDiscard} onOpenChange={setShowDiscard}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard import progress?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-2">
            You have unsaved progress — your uploaded file and field mapping
            will be lost if you close now.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDiscard(false)}
            >
              Continue importing
            </Button>
            <Button variant="destructive" size="sm" onClick={doClose}>
              Discard &amp; close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
