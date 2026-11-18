import { cn, todayIso } from "../../lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "../ui/sheet";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import type { ModuleRecord } from "../../api/modules";
import { useModuleForm } from "../../hooks/useModuleForm";
import { useKnownValues } from "../../hooks/useKnownValues";
import { useViewportMode } from "../../hooks/useViewportMode";
import { ModuleFieldControl } from "./ModuleFieldControl";
import { useAuth } from "../../context/AuthContext";
import { validateFields, serverFormErrors, type FieldErrors } from "../../lib/moduleFormValidation";
import { REGISTRY, type ModuleField } from "../../modules/registry";

interface ModuleFormDrawerProps {
  readonly moduleKey: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: (record: ModuleRecord) => void;
  readonly initialValues?: Record<string, unknown>;
  readonly editingId?: string;
  readonly hasFieldAccess?: (field: ModuleField) => boolean;
  // When given, create forms offer "Save & add another": the record is saved, this is told about
  // it, and the form stays open and empty for the next one.
  readonly onSavedAndAddAnother?: (record: ModuleRecord) => void;
  // When given (and a record is being edited), the footer offers a "Delete" button that calls this.
  readonly onDelete?: () => void;
  // Extra content shown under the fields (e.g. an automation rule's run history).
  readonly extra?: ReactNode;
}

// Required fields that count towards a section's "X/Y required" progress. Owners default to the
// creator and switches always have a value, so neither can be left "missing".
const countsAsRequired = (f: ModuleField): boolean => Boolean(f.required) && !f.readOnly && f.type !== "owner" && f.type !== "bool";
const isFilled = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== "";

export function ModuleFormDrawer({
  moduleKey,
  open,
  onClose,
  onSaved,
  initialValues,
  editingId,
  hasFieldAccess,
  onSavedAndAddAnother,
  onDelete,
  extra,
}: ModuleFormDrawerProps) {
  const moduleDef = REGISTRY[moduleKey];
  const { checkDuplicate, save, accountOf } = useModuleForm(moduleKey);
  const role = useAuth()?.user?.role;
  // Sales reps always own what they create (the server enforces it), so only leads see the picker.
  const canPickOwner = role !== "SALES_REP";
  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<ModuleRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The account the last opportunity/asset/order pick filled in — lets a later pick replace it.
  const autoAccount = useRef<string | null>(null);
  const mobile = useViewportMode() === "drawer";
  const known = useKnownValues(moduleKey, open);

  useEffect(() => {
    setValues(initialValues ?? {});
    autoAccount.current = null;
    // A reopened form starts clean — no error or duplicate banner left over from the last attempt.
    setErrors({});
    setFormError(null);
    setDuplicateMatch(null);
  }, [initialValues, open]);

  // The status field belongs to the detail page's actions (flow/action state machine),
  // not the create/edit form — exclude it so a user can't bypass that flow by typing
  // an arbitrary status string here. The one exception is a required starting status on create
  // (e.g. an opportunity's stage), which the server needs and the form must therefore collect.
  const statusKey = moduleDef.statusKey ?? "status";
  const visibleFields = moduleDef.fields.filter(
    (f) => !f.hidden && !f.workflow && (!f.editOnly || Boolean(editingId)) && (f.key !== statusKey || (!editingId && f.required)) && (f.type !== "owner" || canPickOwner) && (!hasFieldAccess || hasFieldAccess(f)),
  );
  const bySection = new Map<string, ModuleField[]>();
  for (const field of visibleFields) {
    const sectionKey = field.section ?? "";
    const list = bySection.get(sectionKey) ?? [];
    list.push(field);
    bySection.set(sectionKey, list);
  }

  const handleChange = (field: ModuleField, value: string) => {
    // A plant belongs to one account, so changing the account clears it.
    const clearsPlant = field.key === "accountId" && moduleDef.fields.some((f) => f.type === "plant");
    setValues((prev) => ({ ...prev, [field.key]: value, ...(clearsPlant ? { plant: "" } : {}) }));
    // Picking an opportunity, asset or order fills the account from it (when none is chosen yet).
    if (value && field.type === "ref" && field.ref !== "accounts" && field.key !== "accountId" && moduleDef.fields.some((f) => f.key === "accountId")) {
      void accountOf(field.ref ?? "", value).then((accountId) => {
        if (!accountId) return;
        // Overwrite only an account this auto-fill put there, never one the user picked by hand.
        setValues((prev) => {
          if (prev.accountId && prev.accountId !== autoAccount.current) return prev;
          autoAccount.current = accountId;
          return { ...prev, accountId };
        });
      });
    }
    if (errors[field.key]) {
      const rest = Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field.key));
      setErrors(rest);
      // The "please fix N fields" banner goes once the last highlighted field is fixed.
      if (Object.keys(rest).length === 0) setFormError(null);
    }
  };

  const checkDuplicates = async () => {
    const match = await checkDuplicate(values, editingId);
    setDuplicateMatch(match);
  };

  const validate = (): boolean => {
    const nextErrors = validateFields(visibleFields, values);
    if (!editingId) {
      for (const f of visibleFields) {
        const v = values[f.key];
        if (f.noPast && typeof v === "string" && v !== "" && v < todayIso() && !nextErrors[f.key]) {
          nextErrors[f.key] = `${f.label} can't be in the past.`;
        }
      }
    }
    setErrors(nextErrors);
    const count = Object.keys(nextErrors).length;
    setFormError(count ? `Please fix ${count === 1 ? "the highlighted field" : `the ${count} highlighted fields`} below.` : null);
    return count === 0;
  };

  const jumpToField = (key: string) => {
    const el = document.getElementById(key);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus();
  };

  const handleSave = async (addAnother = false) => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      // Only what the form shows goes to the server: an edit starts from the whole record
      // (id, orgId, timestamps…) and the API rejects properties it doesn't know. When editing,
      // unchanged fields stay out too, so a field the API can't take never blocks an unrelated edit.
      const blank = (v: unknown) => v === undefined || v === null || v === "";
      const submitted = Object.fromEntries(
        visibleFields
          .filter((f) => !f.readOnly && values[f.key] !== undefined)
          .filter((f) => !editingId || !(values[f.key] === initialValues?.[f.key] || (blank(values[f.key]) && blank(initialValues?.[f.key]))))
          .map((f) => [f.key, values[f.key]]),
      );
      const result = await save(submitted, editingId);
      if (addAnother && onSavedAndAddAnother) {
        onSavedAndAddAnother(result);
        setValues(initialValues ?? {});
        setErrors({});
        setFormError(null);
        setDuplicateMatch(null);
      } else {
        onSaved(result);
      }
    } catch (err) {
      const { fields, general } = serverFormErrors(err, visibleFields);
      setErrors(fields);
      const count = Object.keys(fields).length;
      setFormError(general ?? (count ? `Please fix ${count === 1 ? "the highlighted field" : `the ${count} highlighted fields`} below.` : "Couldn't save — please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const sections = Array.from(bySection.entries()).map(([title, fields]) => {
    const required = fields.filter(countsAsRequired);
    return { title, fields, required: required.length, done: required.filter((f) => isFilled(values[f.key])).length };
  });
  const requiredTotal = sections.reduce((n, sec) => n + sec.required, 0);
  const requiredDone = sections.reduce((n, sec) => n + sec.done, 0);
  const errorEntries = visibleFields.filter((f) => errors[f.key]).map((f) => ({ key: f.key, label: f.label }));
  const singular = (moduleDef.singular ?? moduleDef.title).toLowerCase();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        // On a phone, focusing the first field on open would pop the keyboard up over the form straight away.
        onOpenAutoFocus={mobile ? (event) => event.preventDefault() : undefined}
        className={cn("sm:max-w-none flex flex-col p-0", mobile ? "w-screen h-[100dvh] pt-[env(safe-area-inset-top)] [&>button]:top-[calc(env(safe-area-inset-top)+1rem)]" : "w-[min(680px,100vw)]")}
      >
        <SheetHeader className="pb-3">
          <SheetTitle>{editingId ? `Edit ${moduleDef.singular ?? moduleDef.title}` : `New ${moduleDef.singular ?? moduleDef.title}`}</SheetTitle>
          {requiredTotal > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="required-progress">
              <span>
                {requiredDone} of {requiredTotal} required fields
              </span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-primary" style={{ width: `${Math.round((requiredDone / requiredTotal) * 100)}%` }} />
              </span>
            </div>
          )}
        </SheetHeader>

        <div
          className="flex-1 overflow-y-auto space-y-4 py-4 px-5 bg-muted/30"
          // The keyboard opens after focus lands: bring the field to the middle of the space left above it.
          onFocus={
            mobile
              ? (event) => {
                  const field = event.target as HTMLElement;
                  window.setTimeout(() => field.scrollIntoView?.({ block: "center", behavior: "smooth" }), 350);
                }
              : undefined
          }
        >
          {(formError || errorEntries.length > 0) && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">{formError ?? "Please fix the highlighted fields."}</p>
              {errorEntries.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {errorEntries.map(({ key, label }) => (
                    <li key={key}>
                      <button type="button" className="text-left underline max-[767px]:min-h-11" onClick={() => jumpToField(key)}>
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {duplicateMatch && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              A matching {singular} already exists.{" "}
              <button type="button" className="underline font-medium" onClick={() => onSaved(duplicateMatch)}>
                Open existing
              </button>
            </div>
          )}

          {sections.map(({ title, fields, required, done }, index) => (
            <section key={title} data-testid="form-section" className="rounded-xl border border-border bg-card p-4">
              <header className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-text">
                  {index + 1}
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={title || "Details"}>
                  {title || "Details"}
                </h3>
                <span className={cn("shrink-0 text-xs", required > 0 && done === required ? "text-green-600" : "text-muted-foreground")}>
                  {required > 0 ? `${done}/${required} required` : "Optional"}
                </span>
              </header>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4">
                {fields.map((field) => (
                  <div key={field.key} className={field.full || field.type === "textarea" ? "col-span-full" : ""}>
                    <Label htmlFor={field.key}>
                      {field.label} {field.required && field.type !== "owner" && <span className="text-destructive">*</span>}
                    </Label>
                    <ModuleFieldControl
                      field={field}
                      value={String(values[field.key] ?? "")}
                      error={errors[field.key]}
                      editing={Boolean(editingId)}
                      accountId={String(values.accountId ?? "")}
                      known={known[field.key] ?? []}
                      onChange={(v) => handleChange(field, v)}
                      onBlur={() => void checkDuplicates()}
                    />
                    {errors[field.key] && (
                      <p className="text-xs text-destructive mt-1" role="alert">
                        {errors[field.key]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {extra}
        </div>

        <SheetFooter className={cn("gap-2 bg-card", mobile && "pb-[max(1rem,env(safe-area-inset-bottom))]")}>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="max-[767px]:h-11" onClick={onClose}>
              Cancel
            </Button>
            {editingId && onDelete && (
              <Button variant="outline" className="max-[767px]:h-11 text-destructive hover:text-destructive" onClick={onDelete} disabled={submitting}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!editingId && !mobile && onSavedAndAddAnother && (
              <Button variant="outline" onClick={() => void handleSave(true)} disabled={submitting}>
                Save &amp; add another
              </Button>
            )}
            <Button className="max-[767px]:h-11" onClick={() => void handleSave()} disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
