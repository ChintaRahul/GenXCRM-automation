import { Lock } from "lucide-react";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { cn, todayIso } from "../../lib/utils";
import { formatMoney } from "../../lib/moduleCells";
import { suggestionsFor } from "../../modules/fieldPresets";
import type { ModuleField } from "../../modules/registry";
import { LookupSelect } from "./LookupSelect";
import { PlantSelect } from "./PlantSelect";
import { SuggestInput } from "./SuggestInput";

interface ModuleFieldControlProps {
  readonly field: ModuleField;
  readonly value: string;
  readonly error?: string;
  readonly editing: boolean;
  // Account chosen on the form; a plant field offers only that account's plants.
  readonly accountId: string;
  // Values already stored for this field, offered as suggestions for text fields.
  readonly known: readonly string[];
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}

// 16px text on phones stops iOS zooming into the field; 44px keeps it tappable.
const MOBILE = "max-[767px]:h-11 max-[767px]:text-base";
const selectClass = (invalid: boolean) =>
  cn("w-full h-9 rounded-md border bg-background px-3 text-sm", MOBILE, invalid ? "border-destructive" : "border-input");

const inputMode = (field: ModuleField): "tel" | "email" | "decimal" | "numeric" | undefined => {
  if (field.type === "money" || field.type === "pct") return "decimal";
  if (field.type === "number") return "numeric";
  if (field.type === "text" && /phone|mobile|whatsapp/i.test(field.key)) return "tel";
  if (field.type === "text" && /email/i.test(field.key)) return "email";
  return undefined;
};

export function ModuleFieldControl({ field, value, error, editing, accountId, known, onChange, onBlur }: ModuleFieldControlProps) {
  const { key, type } = field;
  const invalid = Boolean(error);

  if (field.readOnly) {
    return (
      <div
        id={key}
        className={cn("flex items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground h-9", MOBILE)}
      >
        <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="truncate" title={value}>{value || "—"}</span>
      </div>
    );
  }

  if (type === "owner" || type === "ref") {
    return (
      <LookupSelect
        id={key}
        source={type === "owner" ? "owner" : (field.ref ?? "")}
        value={value}
        onChange={onChange}
        placeholder={type === "owner" ? (field.ownerPlaceholder ?? "Me (default)") : `Select ${field.label.toLowerCase()}…`}
        invalid={invalid}
      />
    );
  }
  if (type === "plant") return <PlantSelect id={key} accountId={accountId} value={value} onChange={onChange} invalid={invalid} />;

  if (type === "select") {
    return (
      <select id={key} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className={selectClass(invalid)}>
        <option value="">Select…</option>
        {field.options?.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (type === "textarea") {
    return (
      <textarea
        id={key}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn("w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm max-[767px]:text-base", invalid ? "border-destructive" : "border-input")}
      />
    );
  }

  if (type === "bool") {
    const on = value === "true";
    return (
      <div className="flex items-center gap-2 min-h-9 max-[767px]:min-h-11">
        <Switch id={key} checked={on} onCheckedChange={(next) => onChange(next ? "true" : "")} aria-label={field.label} />
        <span className="text-sm text-muted-foreground">{on ? "Yes" : "No"}</span>
      </div>
    );
  }

  if (type === "text") {
    const options = suggestionsFor(key, known);
    if (options) {
      return <SuggestInput id={key} label={field.label} value={value} options={options} onChange={onChange} onBlur={onBlur} invalid={invalid} />;
    }
  }

  const amount = Number(value);
  const hint = type === "money" && value !== "" && Number.isFinite(amount) && amount > 0 ? `≈ ${formatMoney(amount)}` : "";
  const input = (
    <Input
      id={key}
      type={type === "date" ? "date" : type === "number" || type === "money" || type === "pct" ? "number" : "text"}
      inputMode={inputMode(field)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      min={field.noPast && type === "date" && !editing ? todayIso() : undefined}
      className={cn(
        MOBILE,
        invalid && "border-destructive",
        type === "money" && "pl-7",
        type === "pct" && "pr-7",
        type === "number" && "max-w-[200px]",
      )}
    />
  );

  if (type === "money" || type === "pct") {
    return (
      <div>
        <div className="relative">
          {type === "money" && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>}
          {input}
          {type === "pct" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
        </div>
        {hint && !invalid && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  }
  return input;
}
