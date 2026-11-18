import { StatusBadge } from "../shared/StatusBadge";
import type { BadgeTone } from "../shared/StatusBadge";

// The server computes the SLA state and sends it on the record itself ({ l: label, t: tone }),
// so this tab renders it directly instead of fetching it again.
export interface RecordSla {
  readonly l: string;
  readonly t?: string;
}

export function SlaTab({ sla }: { readonly sla: RecordSla | null | undefined }) {
  if (!sla?.l) return <p className="text-sm text-muted-foreground py-4">No SLA policy applies to this record.</p>;

  return (
    <div className="py-2">
      <StatusBadge status={sla.l} tone={(sla.t ?? "gray") as BadgeTone} />
    </div>
  );
}
