import { LoadError } from "../shared/LoadError";
import { Clock, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { usePaymentsList } from "../../hooks/usePayments";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { openExternal } from "../../lib/platform";
import { Skeleton } from "../ui/skeleton";

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied");
  } catch {
    toast.error("Couldn't copy link");
  }
}

export function AwaitingPaymentCard() {
  const { data, loading, error, refetch } = usePaymentsList({
    status: "LINK_SENT",
    sortBy: "createdAt",
    sortOrder: "desc",
    limit: 1,
  });
  const payment = data?.data?.[0];

  if (loading) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-4">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-4">
        <LoadError message={error} onRetry={refetch} />
      </div>
    );
  }

  if (!payment) return null;

  return (
    <div className="rounded-xl p-4 border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-primary/[0.04]">
      <div className="flex items-center gap-2 mb-2.5">
        <Clock className="w-3.5 h-3.5 text-chart-3" />
        <span className="text-xs font-semibold text-chart-3 uppercase tracking-wide">
          Awaiting payment
        </span>
      </div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarFallback className="text-xs">
            {payment.lead ? initials(payment.lead.name) : "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {payment.lead?.name ?? "Unknown"}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {payment.lead?.course ? `${payment.lead.course} · ` : ""}₹
            {payment.amount.toLocaleString("en-IN")}
          </p>
        </div>
      </div>
      {payment.paymentLink && (
        <div className="p-2 bg-background rounded-md border border-card-border flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            {payment.paymentLink.replace(/^https?:\/\//, "")}
          </span>
          <LinkIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        </div>
      )}
      <div className="flex gap-1.5 mt-2.5">
        {payment.paymentLink && (
          <>
            <button
              type="button"
              onClick={() => void openExternal(payment.paymentLink!)}
              className="flex-1 text-xs px-2 py-1.5 rounded-md border border-card-border hover:bg-muted transition-colors"
            >
              Open link
            </button>
            <button
              type="button"
              onClick={() => void copyLink(payment.paymentLink!)}
              className="flex-1 text-xs px-2 py-1.5 rounded-md border border-card-border hover:bg-muted transition-colors"
            >
              Copy link
            </button>
          </>
        )}
      </div>
    </div>
  );
}
