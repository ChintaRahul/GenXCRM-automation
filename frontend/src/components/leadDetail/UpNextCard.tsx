import { Clock } from "lucide-react";
import { formatDateTime } from "../../lib/utils";
import type { Lead } from "../../types";

export function UpNextCard({ lead }: { lead: Lead }) {
  const enrollment = lead.enrollments?.[0];
  const nextStep = enrollment?.sequence?.steps?.[enrollment.currentStep];

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <p className="text-sm font-semibold text-foreground mb-3">Up next</p>
      {!enrollment || !nextStep ? (
        <p className="text-xs text-muted-foreground">Nothing scheduled</p>
      ) : (
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Clock className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {nextStep.subject ?? `${nextStep.type} step`}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {enrollment.nextRunAt
                ? formatDateTime(enrollment.nextRunAt)
                : "Time not scheduled yet"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
