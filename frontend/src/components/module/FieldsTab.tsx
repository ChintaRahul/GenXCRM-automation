import type { ModuleDef } from "../../modules/registry";
import type { ModuleRecord } from "../../api/modules";
import { LookupName } from "../../lib/lookupNames";
import { entityRefLabel, formatDate, formatMoney } from "../../lib/moduleCells";

interface FieldsTabProps {
  moduleDef: ModuleDef;
  record: ModuleRecord;
  sections?: readonly string[];
  excludeSections?: readonly string[];
  // Field keys to omit from the grid — used by ModuleDetailPage to hide the field it
  // already surfaces as the page's own title (moduleDef.label), so the value doesn't
  // render twice on the same screen.
  excludeKeys?: readonly string[];
  // A section heading is skipped (its fields still render) when it exactly matches this
  // text — used by ModuleDetailPage to avoid a section literally named the same as the
  // record's title (e.g. an opportunity titled "Deal" whose section is also "Deal") from
  // duplicating the page title text. Fields are never hidden by this, only the heading.
  hideSectionHeadingIfEquals?: string;
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function FieldsTab({
  moduleDef, record, sections, excludeSections, excludeKeys, hideSectionHeadingIfEquals,
}: FieldsTabProps) {
  const visibleFields = moduleDef.fields.filter((f) => {
    if (f.hidden) return false;
    if (sections && !sections.includes(f.section ?? "")) return false;
    if (excludeSections?.includes(f.section ?? "")) return false;
    if (excludeKeys?.includes(f.key)) return false;
    return true;
  });

  const bySection = new Map<string, typeof visibleFields>();
  for (const field of visibleFields) {
    const sectionKey = field.section ?? "";
    const list = bySection.get(sectionKey) ?? [];
    list.push(field);
    bySection.set(sectionKey, list);
  }

  return (
    <div className="space-y-6">
      {Array.from(bySection.entries()).map(([section, fields]) => (
        <div key={section}>
          {section !== hideSectionHeadingIfEquals && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{section}</h3>
          )}
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
            {fields.map((field) => (
              <div key={field.key} className={field.full ? "col-span-full" : ""}>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">{field.label}</p>
                <p className="text-sm">
                  {field.type === "owner" || field.type === "ref" ? (
                    <LookupName source={field.type === "owner" ? "owner" : field.ref} id={record[field.key]} />
                  ) : field.type === "date" && record[field.key] ? (
                    formatDate(record[field.key])
                  ) : field.type === "money" && record[field.key] != null && record[field.key] !== "" ? (
                    formatMoney(record[field.key])
                  ) : field.type === "pct" && record[field.key] != null && record[field.key] !== "" ? (
                    `${record[field.key]}%`
                  ) : /phone/i.test(field.key) && typeof record[field.key] === "string" && record[field.key] ? (
                    <a href={`tel:${String(record[field.key]).replace(/[^\d+]/g, "")}`} className="text-primary hover:underline">
                      {String(record[field.key])}
                    </a>
                  ) : (
                    formatFieldValue(field.key === "entityId" ? entityRefLabel(record) : record[field.key])
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
