import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "../../lib/utils";
import { computeEmiPreview, type EmiPreviewRow } from "./RegistrationFeeCard";
import { getInvoice } from "../../api/client";
import { startVisiblePolling } from "../../lib/visiblePolling";
import type {
  EmiInstallment,
  EmiPaymentMode,
  EmiMandateStatus,
  PaymentGatewayName,
  PaymentGatewayStatus,
} from "../../types";

const GATEWAY_LABELS: Record<PaymentGatewayName, string> = {
  RAZORPAY: "Razorpay",
  CASHFREE: "Cashfree",
};

const MANDATE_STATUS_POLL_INTERVAL_MS = 5000;

interface EmiPlanAccordionProps {
  open: boolean;
  onToggle: () => void;
  subtotal: number;
  registrationFee: number;
  tenureMonths: number;
  onTenureMonthsChange: (n: number) => void;
  emiStartDate: string;
  onEmiStartDateChange: (date: string) => void;
  negotiatedAmount: number | undefined;
  onNegotiatedAmountChange: (amount: number | undefined) => void;
  gstEnabled: boolean;
  gstRate: number;
  onCreateEmiPlan: () => void;
  creatingEmiPlan?: boolean;
  // Rows returned by createEmiPlan/createEmiMandate. Once present they replace the
  // client-side preview — the persisted schedule is the only number the user should read.
  savedInstallments?: EmiInstallment[];
  // Auto-debit mandate state (all come from the Invoice; see types/index.ts). Once
  // emiGatewaySubscriptionId has ever been set (reflected here by emiMandateStatus being
  // non-null), both tabs' edit controls lock — see the Constraints section of the design
  // spec (docs/superpowers/specs/2026-09-18-emi-subscription-mandate-design.md).
  emiPaymentMode: EmiPaymentMode;
  emiMandateStatus?: EmiMandateStatus | null;
  emiMandateShortUrl?: string | null;
  onCreateEmiMandate: () => void;
  creatingEmiMandate?: boolean;
  // Which gateway sets up the auto-debit. The picker only appears when gateways are passed.
  gateways?: PaymentGatewayStatus[];
  emiGateway?: PaymentGatewayName;
  onEmiGatewayChange?: (gateway: PaymentGatewayName) => void;
  // Invoice id, so this component can poll getInvoice for mandate status updates the same
  // way PaymentLinkForm polls for registrationFeePaidAt. Undefined until the invoice exists.
  invoiceId?: string;
  onMandateStatusChange?: (status: EmiMandateStatus, savedInstallments: EmiInstallment[]) => void;
}

// Step 4's "Convert balance into EMI" accordion — same fields/math as the previous
// sidebar version, just relocated behind a collapsed row (design_handoff_register/).
// Gained a Manual / Auto-debit(mandate) tab switcher (design_handoff_register/,
// docs/superpowers/specs/2026-09-18-emi-subscription-mandate-design.md).
export function EmiPlanAccordion({
  open,
  onToggle,
  subtotal,
  registrationFee,
  tenureMonths,
  onTenureMonthsChange,
  emiStartDate,
  onEmiStartDateChange,
  negotiatedAmount,
  onNegotiatedAmountChange,
  gstEnabled,
  gstRate,
  onCreateEmiPlan,
  creatingEmiPlan,
  savedInstallments,
  emiPaymentMode,
  emiMandateStatus,
  emiMandateShortUrl,
  onCreateEmiMandate,
  creatingEmiMandate,
  gateways,
  emiGateway,
  onEmiGatewayChange,
  invoiceId,
  onMandateStatusChange,
}: EmiPlanAccordionProps) {
  const preview = useMemo(
    () =>
      computeEmiPreview({
        subtotal,
        registrationFee,
        negotiatedAmount,
        tenureMonths,
        startDate: emiStartDate,
        gstEnabled,
        gstRate,
      }),
    [subtotal, registrationFee, negotiatedAmount, tenureMonths, emiStartDate, gstEnabled, gstRate],
  );

  const saved = savedInstallments ?? [];
  const schedule: EmiPreviewRow[] =
    saved.length > 0
      ? saved.map((inst) => ({
          installmentNumber: inst.installmentNumber,
          dueDate: new Date(inst.dueDate),
          amount: inst.amount,
        }))
      : preview;
  const scheduleIsSaved = saved.length > 0;

  // Once a mandate has ever been created for this invoice, lock further edits on both
  // tabs — see the "No mid-stream mode switching" constraint in the design spec.
  const mandateLocked = emiPaymentMode === "SUBSCRIPTION" && !!emiMandateStatus;

  // Polls for mandate status updates (webhook-driven) the same way PaymentLinkForm polls
  // for registrationFeePaidAt. Stops once the mandate reaches a terminal-ish state that
  // won't change from here without a rep re-creating it (ACTIVE keeps polling since
  // paid_count updates on every subscription.charged event).
  const [polledStatus, setPolledStatus] = useState<EmiMandateStatus | null | undefined>(emiMandateStatus);
  const [polledInstallments, setPolledInstallments] = useState<EmiInstallment[]>(saved);
  const [polledShortUrl, setPolledShortUrl] = useState<string | null | undefined>(emiMandateShortUrl);
  useEffect(() => {
    setPolledStatus(emiMandateStatus);
  }, [emiMandateStatus]);
  useEffect(() => {
    setPolledInstallments(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedInstallments]);
  useEffect(() => {
    setPolledShortUrl(emiMandateShortUrl);
  }, [emiMandateShortUrl]);
  useEffect(() => {
    if (!invoiceId || !mandateLocked) return;
    if (polledStatus === "HALTED" || polledStatus === "CANCELLED" || polledStatus === "COMPLETED") return;
    let cancelled = false;
    async function poll() {
      try {
        const invoice = await getInvoice(invoiceId!);
        if (cancelled) return;
        if (invoice.emiMandateStatus && invoice.emiMandateStatus !== polledStatus) {
          setPolledStatus(invoice.emiMandateStatus);
        }
        if (invoice.emiInstallments) {
          setPolledInstallments(invoice.emiInstallments);
        }
        if (invoice.emiMandateShortUrl && invoice.emiMandateShortUrl !== polledShortUrl) {
          setPolledShortUrl(invoice.emiMandateShortUrl);
        }
        onMandateStatusChange?.(invoice.emiMandateStatus ?? "CREATED", invoice.emiInstallments ?? []);
      } catch {
        // best-effort status check; next poll tries again
      }
    }
    const stopPolling = startVisiblePolling(poll, MANDATE_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, mandateLocked, polledStatus]);

  const paidCount = polledInstallments.filter((inst) => inst.status === "PAID").length;

  const scheduleSection = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>EMI tenure (months)</Label>
          <Input
            type="number"
            min={1}
            step={1}
            value={tenureMonths === 0 ? "" : tenureMonths}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onTenureMonthsChange(e.target.value === "" ? 0 : Number(e.target.value))}
            placeholder="0"
            disabled={mandateLocked}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Start date of EMI</Label>
          <Input
            type="date"
            value={emiStartDate}
            onChange={(e) => onEmiStartDateChange(e.target.value)}
            disabled={mandateLocked}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Negotiated amount (₹, optional)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={!negotiatedAmount ? "" : negotiatedAmount}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onNegotiatedAmountChange(e.target.value === "" ? undefined : Number(e.target.value))}
          placeholder="Leave blank to use invoice total"
          className="font-mono"
          disabled={mandateLocked}
        />
        <p className="text-[11px] text-muted-foreground">
          If the deal was negotiated, enter the final agreed amount — EMIs recalculate against
          it instead of the course fee total.
        </p>
      </div>

      {schedule.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 overflow-hidden">
          <div className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground bg-muted/70">
            {scheduleIsSaved
              ? "Saved EMI schedule"
              : `EMI schedule preview${gstEnabled ? ` (incl. ${gstRate}% GST)` : ""}`}
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-border">
            {schedule.map((row) => (
              <div key={row.installmentNumber} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                <span className="w-14 text-muted-foreground flex-shrink-0">EMI {row.installmentNumber}</span>
                <span className="w-24 text-muted-foreground flex-shrink-0">
                  {row.dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  ₹{row.amount.toLocaleString("en-IN")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const manualTab = (
    <div className="space-y-3">
      {scheduleSection}
      <Button
        type="button"
        variant="outline"
        className={cn("w-full")}
        onClick={onCreateEmiPlan}
        disabled={creatingEmiPlan || schedule.length === 0 || mandateLocked}
      >
        {creatingEmiPlan ? "Saving EMI plan…" : scheduleIsSaved ? "Update EMI plan" : "Save EMI plan"}
      </Button>
    </div>
  );

  const autoDebitTab = mandateLocked ? (
    <div className="space-y-3">
      {scheduleSection}
      {polledStatus === "CREATED" && (
        <>
          <p className="text-[12.5px] font-medium text-warning">Awaiting authorization</p>
          {polledShortUrl && (
            <a
              href={polledShortUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11.5px] font-mono break-all text-primary hover:underline"
            >
              {polledShortUrl}
            </a>
          )}
          <p className="text-[11px] text-muted-foreground">
            The student has been notified by SMS/email to authorize this mandate. You can also share the link above.
          </p>
        </>
      )}
      {(polledStatus === "ACTIVE" || polledStatus === "AUTHENTICATED") && (
        <p className="text-[12.5px] font-medium text-success">
          ✓ Auto-debit active — {paidCount} of {polledInstallments.length || tenureMonths} installments charged
        </p>
      )}
      {(polledStatus === "HALTED" || polledStatus === "CANCELLED") && (
        <p className="text-[12.5px] font-medium text-destructive">
          ⚠ Mandate {polledStatus === "HALTED" ? "halted" : "cancelled"} — auto-charging has stopped. Collect
          remaining installments manually or set up a new mandate.
        </p>
      )}
      {polledStatus === "COMPLETED" && (
        <p className="text-[12.5px] font-medium text-success">✓ Mandate completed — all installments charged</p>
      )}
    </div>
  ) : (
    <div className="space-y-3">
      {scheduleSection}
      <p className="text-[11px] text-muted-foreground">
        The student authorizes one mandate (UPI Autopay, e-NACH, or card) and every
        installment charges automatically on its due date — no manual collection needed.
      </p>
      {gateways && gateways.length > 0 && (
        <div>
          <Label className="text-[11.5px] text-muted-foreground mb-1.5 block">Payment gateway</Label>
          <Select value={emiGateway} onValueChange={(v) => onEmiGatewayChange?.(v as PaymentGatewayName)}>
            <SelectTrigger aria-label="Payment gateway">
              <SelectValue placeholder="Select a gateway" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {gateways.map((g) => (
                <SelectItem key={g.gateway} value={g.gateway} disabled={!g.connected}>
                  {GATEWAY_LABELS[g.gateway]}
                  {!g.connected ? " (Not connected)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className={cn("w-full")}
        onClick={onCreateEmiMandate}
        disabled={
          creatingEmiMandate ||
          schedule.length === 0 ||
          (!!gateways && !gateways.find((g) => g.gateway === emiGateway)?.connected)
        }
      >
        {creatingEmiMandate ? "Creating mandate…" : "Create mandate"}
      </Button>
    </div>
  );

  return (
    <div className="border border-card-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <span>
          <span className="block text-[13.5px] font-semibold text-foreground">Convert balance into EMI</span>
          <span className="block text-[11.5px] text-muted-foreground mt-0.5">
            Optional — split the remaining balance into monthly installments
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3.5 border-t border-border">
          <Tabs defaultValue={emiPaymentMode === "SUBSCRIPTION" ? "auto" : "manual"}>
            <div className="mb-3">
              <TabsList>
                <TabsTrigger value="manual" disabled={mandateLocked}>
                  Manual
                </TabsTrigger>
                <TabsTrigger value="auto">Auto-debit (mandate)</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="manual">{manualTab}</TabsContent>
            <TabsContent value="auto">{autoDebitTab}</TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
