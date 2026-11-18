import { useParams, Link } from "react-router-dom";
import { Header } from "../components/layout/Header";
import { Skeleton } from "../components/ui/skeleton";
import { StatusBadge } from "../components/shared/StatusBadge";
import { usePayment } from "../hooks/usePayments";
import { formatDate, rupeeFull } from "../lib/format";

// Read-only detail view — a focused summary (amount, gateway, dates, linked lead,
// installment schedule), not a rich page with its own actions. Mirrors LeadDetail.tsx's
// header/back pattern but scoped down: Payments has no equivalent of Leads' composer,
// timeline, or stage stepper, so this stays a summary rather than a full workspace.
export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: payment, loading } = usePayment(id ?? "");

  if (loading) {
    return (
      <>
        <Header title="Payment" backTo="/payments" />
        <div className="p-4 sm:p-6 max-w-2xl space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </>
    );
  }

  if (!payment) {
    return (
      <>
        <Header title="Payment" backTo="/payments" />
        <div className="p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">This payment could not be found.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={payment.lead?.name ?? "Payment"}
        subtitleBadge={payment.gateway}
        backTo="/payments"
      />
      <div className="p-4 sm:p-6 max-w-2xl space-y-4">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Amount
              </p>
              <p className="font-mono tabular-nums text-2xl font-bold text-foreground mt-1">
                {rupeeFull(payment.amount)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{payment.currency}</p>
            </div>
            <StatusBadge status={payment.status} />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Gateway
              </p>
              <p className="text-foreground mt-1">{payment.gateway}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Lead
              </p>
              {payment.lead ? (
                <Link
                  to={`/leads/${payment.lead.id}`}
                  className="text-primary hover:underline mt-1 inline-block"
                >
                  {payment.lead.name}
                </Link>
              ) : (
                <p className="text-foreground mt-1">—</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Due date
              </p>
              <p className="text-foreground mt-1">{formatDate(payment.dueDate)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Paid on
              </p>
              <p className="text-foreground mt-1">{formatDate(payment.paidAt)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Created
              </p>
              <p className="text-foreground mt-1">{formatDate(payment.createdAt)}</p>
            </div>
          </div>
        </div>

        {payment.installments.length > 0 && (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-card-border">
              <h3 className="font-display text-sm font-bold text-foreground">
                Installment schedule
              </h3>
            </div>
            <div className="divide-y divide-border">
              {payment.installments.map((inst, i) => (
                <div key={inst.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-muted-foreground">
                    EMI {i + 1} · {formatDate(inst.dueDate)}
                  </span>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono tabular-nums font-semibold text-foreground">
                      {rupeeFull(inst.amount)}
                    </span>
                    <StatusBadge status={inst.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
