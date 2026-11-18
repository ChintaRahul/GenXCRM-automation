import { displayId, renderCell, renderSub } from "../../lib/moduleCells";
import type { ModuleRecord } from "../../api/modules";
import type { ModuleColumn, ModuleDef } from "../../modules/registry";

interface ModuleCardListProps {
  readonly records: readonly ModuleRecord[];
  readonly columns: readonly ModuleColumn[];
  readonly moduleDef: ModuleDef;
  readonly onRowClick: (record: ModuleRecord) => void;
}

const MAX_PAIRS = 6;
const TITLE_TYPES = new Set(["text", "ref", "mono"]);

// The list as cards, used below 800px where a table doesn't fit: title, `id · subtitle` and the
// status pill up top, then up to six label/value pairs. Tapping a card opens the record.
export function ModuleCardList({ records, columns, moduleDef, onRowClick }: ModuleCardListProps) {
  const idCol = columns.find((c) => c.type === "id");
  const titleCol = columns.find((c) => TITLE_TYPES.has(c.type));
  const statusCol = columns.find((c) => c.type === "status");
  const pairCols = columns.filter((c) => c !== idCol && c !== titleCol && c !== statusCol).slice(0, MAX_PAIRS);

  return (
    <ul className="space-y-2.5 pb-24">
      {records.map((record) => {
        const id = displayId(record, moduleDef);
        const subtitle = titleCol?.sub ? renderSub(record, titleCol.sub, moduleDef) : null;
        const titleText = titleCol ? String(record[titleCol.key] ?? "—") : id;
        const title = titleCol ? renderSub(record, titleCol.key, moduleDef) : id;
        return (
          <li key={record.id}>
            <button
              type="button"
              onClick={() => onRowClick(record)}
              className="w-full min-h-11 text-left rounded-xl border border-border bg-card p-3.5 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate" title={titleText}>
                    {title}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate" title={String(record.id)}>
                    {id}
                    {subtitle ? <> · {subtitle}</> : null}
                  </p>
                </div>
                {statusCol && <div className="flex-shrink-0">{renderCell(statusCol, record, moduleDef)}</div>}
              </div>
              {pairCols.length > 0 && (
                <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-x-3 gap-y-2">
                  {pairCols.map((col) => (
                    <div key={col.key} className="min-w-0">
                      <dt className="text-[11px] text-muted-foreground truncate">{col.label}</dt>
                      <dd className="text-xs text-foreground break-words [&_.text-right]:text-left">{renderCell(col, record, moduleDef)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
