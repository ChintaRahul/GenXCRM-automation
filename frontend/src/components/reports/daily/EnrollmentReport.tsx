import { IndianRupee } from "lucide-react";
import type { EnrollmentReport as EnrollmentReportData } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { cn } from "../../../lib/utils";
import { Skeleton } from "../../ui/skeleton";

interface EnrollmentReportProps {
  enrollment: { data: EnrollmentReportData | null; loading: boolean };
}

export function EnrollmentReport({ enrollment }: EnrollmentReportProps) {
  const data = enrollment.data;
  const perRep = data?.perRep ?? [];
  const avgConversion =
    perRep.length > 0 ? perRep.reduce((sum, r) => sum + (r.conversionRate ?? 0), 0) / perRep.length : 0;

  return (
    <div className="bg-card border border-card-border rounded-xl h-full p-5">
      <SectionHeader number="04" title="Enrollment report" />
      {enrollment.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 pb-4 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">Enrollments</p>
              <p className="font-display text-[22px] font-bold text-foreground mt-0.5">
                {data?.totalEnrollments ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Revenue</p>
              <p className="font-display text-[22px] font-bold text-foreground mt-0.5 flex items-center gap-0.5">
                <IndianRupee className="w-[18px] h-[18px]" />
                {(data?.revenue ?? 0).toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Conversion</p>
              <p className="font-display text-[22px] font-bold text-success mt-0.5">
                {(data?.conversionRate ?? 0).toFixed(1)}%
              </p>
            </div>
          </div>

          <div className="mt-1">
            {perRep.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No enrollment activity yet</p>
            ) : (
              perRep.map((r) => (
                <div
                  key={r.repId}
                  className="grid grid-cols-4 gap-2 border-t border-border text-sm items-center py-[11px] px-3.5"
                >
                  <span className="font-medium text-foreground truncate" title={r.repName}>
                    {r.repName}
                  </span>
                  <span className="text-right tabular-nums">{r.enrolled}</span>
                  <span className="flex items-center justify-end gap-0.5 tabular-nums">
                    <IndianRupee className="w-3.5 h-3.5 shrink-0" />
                    {r.revenue.toLocaleString("en-IN")}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums font-semibold",
                      (r.conversionRate ?? 0) >= avgConversion ? "text-success" : "text-destructive",
                    )}
                  >
                    {(r.conversionRate ?? 0).toFixed(1)}%
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
