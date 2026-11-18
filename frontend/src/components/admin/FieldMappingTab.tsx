import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsCard } from "../settings/SettingsCard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type {
  CustomFieldDef,
  FieldMappingConfig,
  ImportMapping,
  LeadBackfillRequest,
  LeadBackfillResult,
  LeadSource,
} from "../../types";

const MAX_CUSTOM_FIELDS = 25;

// Name, phone and email (and the source alias) are fixed; every other list column is orderable.
const FIXED_FIELDS: { key: string; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "source", label: "Source" },
];

// System list columns have no aliases — they can only be reordered.
const SYSTEM_COLUMN_LABELS: Record<string, string> = {
  stage: "Stage",
  source: "Source",
  score: "Score",
  owner: "Owner",
  createdAt: "Created",
};

const ORDERABLE_CORE_LABELS: Record<string, string> = {
  altPhone: "Alt phone",
  altEmail: "Alt email",
  course: "Course",
  location: "Location",
  language: "Language",
  tags: "Tags",
};

const BACKFILL_SOURCES: { value: LeadSource; label: string }[] = [
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "GOOGLE_ADS", label: "Google Ads" },
  { value: "WEBSITE", label: "Website" },
  { value: "API", label: "API / Webhook" },
  { value: "OTHER", label: "Other / CSV" },
];

function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

interface FieldMappingTabProps {
  mapping: FieldMappingConfig;
  canEdit: boolean;
  onSave: (value: Partial<FieldMappingConfig>) => Promise<void>;
  onBackfill: (payload: LeadBackfillRequest) => Promise<LeadBackfillResult>;
  templates: ImportMapping[];
  onSaveTemplate: (
    name: string,
    mappings: Record<string, string>,
  ) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
}

type AliasTarget =
  | { kind: "core"; key: string }
  | { kind: "custom"; id: string };

export function FieldMappingTab({
  mapping,
  canEdit,
  onSave,
  onBackfill,
  templates,
  onSaveTemplate,
  onDeleteTemplate,
}: FieldMappingTabProps) {
  const [coreAliases, setCoreAliases] = useState(mapping.coreFieldAliases);
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>(
    mapping.customFieldDefs,
  );
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [order, setOrder] = useState<string[]>(
    () =>
      mapping.fieldOrder ?? [
        ...Object.keys(SYSTEM_COLUMN_LABELS),
        ...Object.keys(ORDERABLE_CORE_LABELS),
        ...mapping.customFieldDefs.map((f) => f.id),
      ],
  );
  const [showBackfill, setShowBackfill] = useState(false);
  const [bfSources, setBfSources] = useState<Set<LeadSource>>(
    new Set(BACKFILL_SOURCES.map((s) => s.value)),
  );
  const [bfFields, setBfFields] = useState<Set<string>>(
    new Set(order.filter((k) => !Object.hasOwn(SYSTEM_COLUMN_LABELS, k))),
  );
  const [focusedAliasTarget, setFocusedAliasTarget] =
    useState<AliasTarget | null>(null);

  function appendAlias(current: string, field: string): string {
    const existing = current
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    return existing.some((a) => a.toLowerCase() === field.toLowerCase())
      ? current
      : [...existing, field].join(", ");
  }

  function applySuggestion(field: string) {
    if (!focusedAliasTarget) return;
    if (focusedAliasTarget.kind === "core") {
      const key = focusedAliasTarget.key;
      setCoreAliases((a) => ({
        ...a,
        [key]: appendAlias(a[key] ?? "", field),
      }));
    } else {
      const id = focusedAliasTarget.id;
      setCustomFields((fields) =>
        fields.map((f) =>
          f.id === id ? { ...f, aliases: appendAlias(f.aliases, field) } : f,
        ),
      );
    }
  }

  const usedAliases = new Set(
    [...Object.values(coreAliases), ...customFields.map((f) => f.aliases)]
      .flatMap((a) => a.split(","))
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  );
  const suggestedFields = mapping.detectedFields.filter(
    (f) => !usedAliases.has(f.toLowerCase()),
  );

  function addCustomField() {
    if (customFields.length >= MAX_CUSTOM_FIELDS) return;
    const id = crypto.randomUUID();
    setCustomFields((fields) => [...fields, { id, name: "", aliases: "" }]);
    setOrder((o) => [...o, id]);
    setBfFields((f) => new Set(f).add(id));
  }

  function removeCustomField(id: string) {
    setCustomFields((fields) => fields.filter((f) => f.id !== id));
    setOrder((o) => o.filter((k) => k !== id));
  }

  function updateCustomField(id: string, patch: Partial<CustomFieldDef>) {
    setCustomFields((fields) =>
      fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  }

  function moveField(key: string, offset: -1 | 1) {
    setOrder((o) => {
      const from = o.indexOf(key);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= o.length) return o;
      const next = [...o];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  async function backfill() {
    setBackfilling(true);
    try {
      const { updated, scanned } = await onBackfill({
        sources: [...bfSources],
        fields: [...bfFields],
      });
      toast.success(Messages.admin.backfillDone(updated, scanned));
      setShowBackfill(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.backfillFailed));
    } finally {
      setBackfilling(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        coreFieldAliases: coreAliases,
        customFieldDefs: customFields,
        fieldOrder: order,
      });
      toast.success(Messages.admin.mappingSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  async function saveAsTemplate() {
    const name = window.prompt('Template name (e.g. "Meta Lead Ads export")');
    if (!name) return;
    try {
      await onSaveTemplate(name, coreAliases);
      toast.success(Messages.admin.mappingSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Lead column mapping"
        description="Match the columns in your lead sources to GenXCRM fields."
        footer={
          <>
            {canEdit && (
              <Button variant="outline" onClick={() => setShowBackfill((v) => !v)} disabled={saving}>
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Backfill leads
              </Button>
            )}
            <Button onClick={save} disabled={!canEdit || saving}>
              {saving ? "Saving…" : "Save mapping"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">

        {suggestedFields.length > 0 && (
          <div className="bg-card-subtle border border-border rounded-lg p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Fields seen on your connected lead forms (Facebook, Google,
              webhook) that aren&apos;t mapped yet. Click an aliases field
              below, then click a suggestion to add it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedFields.map((field) => (
                <button
                  key={field}
                  type="button"
                  disabled={!canEdit || !focusedAliasTarget}
                  onClick={() => applySuggestion(field)}
                  title={field}
                  className="text-xs px-2 py-1 rounded-full border border-card-border bg-card text-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-card truncate max-w-[220px]"
                >
                  {field}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {FIXED_FIELDS.map((field) => (
            <div
              key={field.key}
              className="flex items-center gap-3 flex-wrap sm:flex-nowrap"
            >
              <span className="text-sm text-foreground w-28 flex-shrink-0">
                {field.label}
              </span>
              <Input
                className="flex-1 min-w-[200px]"
                placeholder="comma-separated header aliases"
                value={coreAliases[field.key] ?? ""}
                disabled={!canEdit}
                onFocus={() =>
                  setFocusedAliasTarget({ kind: "core", key: field.key })
                }
                onChange={(e) =>
                  setCoreAliases((a) => ({ ...a, [field.key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-card-border space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Other fields{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (custom {customFields.length}/{MAX_CUSTOM_FIELDS})
              </span>
            </h3>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={addCustomField}
                disabled={customFields.length >= MAX_CUSTOM_FIELDS}
                title={
                  customFields.length >= MAX_CUSTOM_FIELDS
                    ? `Maximum of ${MAX_CUSTOM_FIELDS} custom fields reached`
                    : undefined
                }
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add custom field
              </Button>
            )}
          </div>
          {order.map((key, index) => {
            const custom = customFields.find((f) => f.id === key);
            const isCore = Object.hasOwn(ORDERABLE_CORE_LABELS, key);
            const isSystem = Object.hasOwn(SYSTEM_COLUMN_LABELS, key);
            if (!custom && !isCore && !isSystem) return null;
            const label =
              custom?.name ||
              ORDERABLE_CORE_LABELS[key] ||
              SYSTEM_COLUMN_LABELS[key] ||
              "field";
            return (
              <div
                key={key}
                className="flex items-center gap-2 flex-wrap sm:flex-nowrap"
              >
                {custom ? (
                  <Input
                    className="w-full sm:w-28 flex-shrink-0"
                    placeholder="Field name"
                    value={custom.name}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateCustomField(custom.id, { name: e.target.value })
                    }
                  />
                ) : (
                  <span className="text-sm text-foreground w-full sm:w-28 flex-shrink-0">
                    {label}
                  </span>
                )}
                {isSystem ? (
                  <span className="flex-1 min-w-[200px] text-xs text-muted-foreground">
                    Built-in column
                  </span>
                ) : (
                  <Input
                    className="flex-1 min-w-[200px]"
                    placeholder="comma-separated header aliases"
                    value={custom ? custom.aliases : (coreAliases[key] ?? "")}
                    disabled={!canEdit}
                    onFocus={() =>
                      setFocusedAliasTarget(
                        custom
                          ? { kind: "custom", id: custom.id }
                          : { kind: "core", key },
                      )
                    }
                    onChange={(e) =>
                      custom
                        ? updateCustomField(custom.id, {
                            aliases: e.target.value,
                          })
                        : setCoreAliases((a) => ({
                            ...a,
                            [key]: e.target.value,
                          }))
                    }
                  />
                )}
                {canEdit && (
                  <div className="flex items-center flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveField(key, -1)}
                      aria-label={`Move ${label} up`}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === order.length - 1}
                      onClick={() => moveField(key, 1)}
                      aria-label={`Move ${label} down`}
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    {custom ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCustomField(custom.id)}
                        aria-label="Remove custom field"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    ) : (
                      <span className="w-9" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground pt-1">
            Name, phone and email always come first. Use the arrows to set the
            order of everything else — it drives the column order on the Leads
            list.
          </p>
        </div>

        {showBackfill && canEdit && (
          <div className="border border-card-border rounded-lg p-3 space-y-3 bg-card-subtle">
            <p className="text-xs text-muted-foreground">
              Re-applies this mapping to the original answers saved with each
              lead (captured from now on). Only empty fields are filled —
              existing values are never overwritten.
            </p>
            <div>
              <p className="text-sm font-medium text-foreground mb-1.5">
                Lead sources
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {BACKFILL_SOURCES.map((src) => (
                  <label
                    key={src.value}
                    className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={bfSources.has(src.value)}
                      onChange={() =>
                        setBfSources((s) => toggleIn(s, src.value))
                      }
                    />
                    {src.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1.5">
                Fields to fill
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {order.map((key) => {
                  const label =
                    customFields.find((f) => f.id === key)?.name ||
                    ORDERABLE_CORE_LABELS[key];
                  if (!label) return null;
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer max-w-[200px]"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary shrink-0"
                        checked={bfFields.has(key)}
                        onChange={() => setBfFields((f) => toggleIn(f, key))}
                      />
                      <span className="truncate" title={label}>
                        {label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBackfill(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={backfill}
                disabled={
                  backfilling || bfSources.size === 0 || bfFields.size === 0
                }
              >
                <RefreshCw
                  className={`w-4 h-4 mr-1.5 ${backfilling ? "animate-spin" : ""}`}
                />
                {backfilling ? "Backfilling…" : "Run backfill"}
              </Button>
            </div>
          </div>
        )}

        </div>
      </SettingsCard>

      <SettingsCard
        title="Saved mapping templates"
        description="Reuse a mapping when importing a CSV."
        footer={
          canEdit && (
            <Button variant="outline" size="sm" onClick={saveAsTemplate}>
              <Plus className="w-4 h-4 mr-1.5" />
              New template
            </Button>
          )
        }
      >
        {templates.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            No saved templates yet.
          </p>
        ) : (
          <div className="divide-y divide-border px-5">
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p
                    className="text-sm text-foreground truncate"
                    title={t.name}
                  >
                    {t.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(t.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteTemplate(t.id)}
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
