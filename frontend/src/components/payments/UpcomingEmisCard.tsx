import { LoadError } from "../shared/LoadError";
import { useUpcomingInstallments } from "../../hooks/usePayments";
import { Skeleton } from "../ui/skeleton";

export function UpcomingEmisCard() {
  const { data: installments, loading, error, refetch } = useUpcomingInstallments(14);

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-foreground">Upcoming EMIs</p>
        {installments && installments.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
            {installments.length} active
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={refetch} />
      ) : !installments || installments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No installments due in the next 14 days
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {installments.map((inst) => {
            const due = new Date(inst.dueDate);
            const weekday = due
              .toLocaleDateString("en-IN", { weekday: "short" })
              .toUpperCase();
            const day = due.getDate();
            return (
              <div
                key={inst.id}
                className="flex items-center gap-2.5 py-2 border-b border-card-border last:border-0"
              >
                <div className="w-9 py-1 text-center bg-muted rounded-md flex-shrink-0">
                  <p className="text-[9px] font-semibold text-muted-foreground tracking-wide">
                    {weekday}
                  </p>
                  <p className="text-[13px] font-bold text-foreground mt-0.5">
                    {day}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {inst.lead.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    EMI {inst.emiNumber} of {inst.totalEmis}
                  </p>
                </div>
                <span className="font-mono text-xs font-semibold text-foreground">
                  ₹{inst.amount.toLocaleString("en-IN")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
