import { LoadError } from "../shared/LoadError";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePaymentsList } from "../../hooks/usePayments";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { StatusBadge } from "../shared/StatusBadge";
import { Skeleton } from "../ui/skeleton";
import { timeAgo } from "../../lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const COLS = ["Lead", "Amount", "Gateway", "Status", "When", ""];

export function TransactionsTable() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = usePaymentsList({ limit: 20 });
  const payments = data?.data ?? [];

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-card-border">
        <div>
          <p className="text-sm font-semibold text-foreground">Transactions</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            All gateways
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={refetch} className="py-12" />
      ) : payments.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No payments yet
        </div>
      ) : (
        <>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-card-border">
                {COLS.map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/payments/${p.id}`)}
                  className="border-b border-card-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2.5 min-w-[180px]">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-7 w-7 flex-shrink-0">
                        <AvatarFallback className="text-[10px]">
                          {p.lead ? initials(p.lead.name) : "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {p.lead?.name ?? "Unknown"}
                        </p>
                        {p.lead?.course && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {p.lead.course}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono font-semibold text-foreground">
                    ₹{p.amount.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground">
                      {p.gateway}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-[11px] text-muted-foreground">
                    {timeAgo(p.paidAt ?? p.createdAt ?? "")}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile transaction cards — same data as the table above */}
        <div className="md:hidden divide-y divide-card-border">
          {payments.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/payments/${p.id}`)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer"
            >
              <Avatar className="h-9 w-9 flex-shrink-0">
                <AvatarFallback className="text-xs">
                  {p.lead ? initials(p.lead.name) : "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-foreground truncate">
                  {p.lead?.name ?? "Unknown"}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {p.gateway} · {timeAgo(p.paidAt ?? p.createdAt ?? "")}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-mono font-semibold text-sm text-foreground">
                  ₹{p.amount.toLocaleString("en-IN")}
                </p>
                <div className="mt-0.5">
                  <StatusBadge status={p.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
