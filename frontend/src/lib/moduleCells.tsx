import type { ReactNode } from "react";
import { StatusBadge } from "../components/shared/StatusBadge";
import type { ModuleColumn, ModuleDef } from "../modules/registry";
import type { ModuleRecord } from "../api/modules";
import { LookupName } from "./lookupNames";

export function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function formatDate(value: unknown): string {
  if (!value || typeof value !== "string") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Due-date columns that should turn red once the date has passed and the record is still open.
const DUE_DATE_KEYS = new Set(["dueDate", "nextActionDate"]);
const CLOSED_STATUSES = new Set(["Completed", "Cancelled", "Closed", "Won", "Lost", "Done", "Resolved", "Received", "Paid", "Delivered", "Dispatched"]);

export function isOverdue(record: ModuleRecord, key: string, now: Date = new Date()): boolean {
  if (!DUE_DATE_KEYS.has(key) || CLOSED_STATUSES.has(String(record.status ?? ""))) return false;
  const value = record[key];
  if (typeof value !== "string") return false;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due < startOfToday;
}

// Records are keyed by UUID, which is unreadable in a list. Show `LD-84A04F`: the module's prefix
// plus the first six characters of the id.
export function displayId(record: ModuleRecord, moduleDef: ModuleDef): string {
  const id = String(record.id ?? "");
  if (id.startsWith(moduleDef.idPrefix)) return id;
  if (id.startsWith(moduleDef.idPrefix)) return id;
  return id ? `${moduleDef.idPrefix}${id.replace(/-/g, "").slice(0, 6).toUpperCase()}` : "—";
}

// A column's second line (`sub`): an id-typed field shows the name it points to and a date is
// formatted, instead of the raw UUID / ISO string.
// An approval points at its record by uuid; show it the way the lists name it (QT-933B51, CS-69F94A).
const ENTITY_PREFIX: Record<string, string> = { Quotation: "QT-", Costing: "CS-" };
export const entityRefLabel = (record: ModuleRecord): string => {
  const id = String(record.entityId ?? "");
  const prefix = ENTITY_PREFIX[String(record.entityType ?? "")];
  return id && prefix ? `${prefix}${id.replace(/-/g, "").slice(0, 6).toUpperCase()}` : id;
};

export function renderSub(record: ModuleRecord, key: string, moduleDef: ModuleDef): ReactNode {
  const value = record[key];
  const field = moduleDef.fields.find((f) => f.key === key);
  if (key === "entityId") return entityRefLabel(record);
  if (field?.type === "owner") return <LookupName source="owner" id={value} />;
  if (field?.type === "ref") return <LookupName source={field.ref} id={value} />;
  if (field?.type === "date" && value) return formatDate(value);
  return String(value ?? "");
}

export function renderCell(column: ModuleColumn, record: ModuleRecord, moduleDef: ModuleDef): ReactNode {
  const value = record[column.key];
  switch (column.type) {
    case "id": {
      // The record's own id shows in the short form (LD-84A04F); an id-type column on another field (an asset's serial number) shows that value.
      const own = column.key !== "id" && typeof value === "string" && value !== "" ? value : displayId(record, moduleDef);
      return <span className="font-mono font-semibold text-xs whitespace-nowrap" title={String(value ?? "")}>{own}</span>;
    }
    case "money":
      return <span className="font-mono text-right block">{formatMoney(value)}</span>;
    case "date":
      return isOverdue(record, column.key) ? (
        <span className="font-medium text-destructive" title="Overdue">
          {formatDate(value)} · Overdue
        </span>
      ) : (
        <span>{formatDate(value)}</span>
      );
    case "sla": {
      const sla = value as { l?: string; t?: string } | null | undefined;
      return sla?.l ? <StatusBadge status={sla.l} tone={(sla.t ?? "gray") as never} /> : <span>—</span>;
    }
    case "status": {
      const tone = moduleDef.statuses.find((s) => s.value === value)?.tone ?? "gray";
      return <StatusBadge status={String(value ?? "")} tone={tone as never} />;
    }
    case "pill": {
      const tone = column.tones?.[String(value)] ?? "gray";
      return <StatusBadge status={String(value ?? "")} tone={tone as never} />;
    }
    case "owner":
      return <LookupName source="owner" id={value} />;
    case "ref":
      return <LookupName source={moduleDef.fields.find((f) => f.key === column.key)?.ref} id={value} />;
    default:
      return (
        <div>
          <div>{String(value ?? "—")}</div>
          {column.sub && (
            <div className="text-xs text-muted-foreground">{renderSub(record, column.sub, moduleDef)}</div>
          )}
        </div>
      );
  }
}
