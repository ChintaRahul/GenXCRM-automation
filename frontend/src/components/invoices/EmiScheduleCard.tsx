import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { markEmiInstallmentPaid, remindEmiInstallment } from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate, rupeeFull } from "../../lib/format";
import { Messages } from "../../lib/messages";
import { cn } from "../../lib/utils";
import type { EmiInstallment, ReminderChannel } from "../../types";

interface EmiScheduleCardProps {
  invoiceId: string;
  emiInstallments: EmiInstallment[];
  // Called after a successful mutation so the parent can refetch the invoice — this card
  // is presentational and deliberately keeps no copy of the schedule.
  onChanged: () => void;
}

const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
};

export function EmiScheduleCard({ invoiceId, emiInstallments, onChanged }: EmiScheduleCardProps) {
  // Keyed by installment number so only the row being acted on shows a busy state.
  const [busy, setBusy] = useState<number | null>(null);

  async function handleRemind(installmentNumber: number, channel: ReminderChannel) {
    setBusy(installmentNumber);
    try {
      await remindEmiInstallment(invoiceId, installmentNumber, channel);
      toast.success(Messages.invoices.installmentReminderSent);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.installmentReminderFailed));
    } finally {
      setBusy(null);
    }
  }

  async function handleMarkPaid(installmentNumber: number) {
    setBusy(installmentNumber);
    try {
      await markEmiInstallmentPaid(invoiceId, installmentNumber);
      toast.success(Messages.invoices.installmentMarkedPaid);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.installmentMarkPaidFailed));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <h3 className="font-display text-sm font-bold text-foreground mb-1">EMI schedule</h3>
      <p className="text-[11.5px] text-muted-foreground mb-3">
        Send a reminder or record a payment for each installment
      </p>

      <div className="divide-y divide-border border-t border-border">
        {emiInstallments.map((inst) => {
          const isPaid = inst.status === "PAID";
          const rowBusy = busy === inst.installmentNumber;
          return (
            <div key={inst.installmentNumber} className="py-2.5">
              <div className="flex items-center gap-3">
                <span className="w-12 flex-shrink-0 text-[12.5px] text-muted-foreground">
                  EMI {inst.installmentNumber}
                </span>
                <span className="flex-1 min-w-0 truncate text-[12.5px] text-muted-foreground">
                  {formatDate(inst.dueDate)}
                </span>
                <span className="font-mono tabular-nums text-[12.5px] font-semibold text-foreground text-right">
                  {rupeeFull(inst.amount)}
                </span>
                <span
                  className={cn(
                    "w-16 flex-shrink-0 text-center text-[10.5px] font-bold px-2 py-0.5 rounded-full",
                    isPaid ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                  )}
                >
                  {isPaid ? "Paid" : "Pending"}
                </span>
              </div>

              {inst.lastReminderAt && (
                <p className="text-[11px] text-muted-foreground mt-1 ml-[3.75rem]">
                  Last reminded {formatDate(inst.lastReminderAt)}
                  {inst.lastReminderChannel
                    ? ` via ${CHANNEL_LABELS[inst.lastReminderChannel]}`
                    : ""}
                </p>
              )}

              {!isPaid && (
                <div className="flex gap-1.5 mt-1.5 ml-[3.75rem]">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={rowBusy}
                    onClick={() => void handleRemind(inst.installmentNumber, "WHATSAPP")}
                  >
                    Remind · WhatsApp
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={rowBusy}
                    onClick={() => void handleRemind(inst.installmentNumber, "EMAIL")}
                  >
                    Remind · Email
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    disabled={rowBusy}
                    onClick={() => void handleMarkPaid(inst.installmentNumber)}
                  >
                    Mark Paid
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
