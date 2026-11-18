import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { getInvoice, markRegistrationFeePaid, sendRegistrationPaymentLink } from "../../api/client";
import { usePaymentGateways } from "../../hooks/usePaymentGateways";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import { startVisiblePolling } from "../../lib/visiblePolling";
import type { PaymentGatewayName } from "../../types";

const GATEWAY_LABELS: Record<PaymentGatewayName, string> = {
  RAZORPAY: "Razorpay",
  CASHFREE: "Cashfree",
};

const STATUS_POLL_INTERVAL_MS = 5000;

interface PaymentLinkFormProps {
  // Resolves to the invoice to attach the link to, creating it on first use if it
  // doesn't exist yet — mirrors ensureInvoice() in RegisterNew.tsx, so this same
  // form works both before (step 3, as a tab) and after (step 4, in an accordion)
  // registration is saved.
  ensureInvoiceId: () => Promise<string>;
  // The fee to charge, when it hasn't been persisted on the invoice yet (step 3, before
  // "Save registration" runs recordRegistrationPayment). Omit at step 4, where the
  // invoice's persisted registrationFee is already correct and the backend uses that.
  amount?: number;
  // Already-known invoice id (step 4, where registration is already saved) — lets the
  // form eagerly check paid status on mount instead of waiting for a click. Step 3 omits
  // this since the invoice may not exist yet — status checks only start once
  // ensureInvoiceId has actually resolved (Send Link / Mark as Paid).
  knownInvoiceId?: string;
  // Notifies the parent once a link is successfully sent — RegisterNew's step 4 uses
  // this to unlock "Generate Invoice" (see canGenerateInvoice there).
  onLinkSent?: () => void;
}

// The gateway/custom-link picker + send button shared by PaymentLinkAccordion (step 4)
// and RegistrationFeeCard's "Payment link" tab (step 3) — sends via POST
// /invoices/:id/registration-payment/send-link. Also polls for and shows whether the
// registration fee has been confirmed paid (webhook-driven, see PaymentsService.handleWebhook),
// with a manual "Mark as paid" override for when the webhook hasn't landed yet.
export function PaymentLinkForm({ ensureInvoiceId, amount, knownInvoiceId, onLinkSent }: PaymentLinkFormProps) {
  const [linkSource, setLinkSource] = useState<"GATEWAY" | "CUSTOM">("GATEWAY");
  const [gatewayChoice, setSelectedGateway] = useState<PaymentGatewayName | "">("");
  const [customUrl, setCustomUrl] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(knownInvoiceId ?? null);
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const { gateways } = usePaymentGateways();
  // No silent default: with several gateways connected the rep must pick one; with exactly
  // one connected it is pre-selected.
  const connectedGateways = gateways.filter((g) => g.connected);
  const selectedGateway: PaymentGatewayName | "" =
    gatewayChoice || (connectedGateways.length === 1 ? connectedGateways[0].gateway : "");

  // Once we know the invoice, poll for the registration fee being confirmed paid — stops
  // as soon as it is. A failed poll just retries on the next tick.
  useEffect(() => {
    if (!invoiceId || paidAt) return;
    let cancelled = false;
    async function checkStatus() {
      try {
        const invoice = await getInvoice(invoiceId!);
        if (!cancelled && invoice.registrationFeePaidAt) setPaidAt(invoice.registrationFeePaidAt);
      } catch {
        // best-effort status check; next poll tries again
      }
    }
    const stopPolling = startVisiblePolling(checkStatus, STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [invoiceId, paidAt]);

  const hasAmount = amount === undefined || amount > 0;
  const canSendLink =
    linkSource === "GATEWAY"
      ? gateways.some((g) => g.gateway === selectedGateway && g.connected) && hasAmount
      : customUrl.trim().length > 0;

  async function handleSendLink() {
    if (!canSendLink) return;
    setSendingLink(true);
    try {
      const id = await ensureInvoiceId();
      setInvoiceId(id);
      if (linkSource === "GATEWAY") {
        await sendRegistrationPaymentLink(id, {
          source: "GATEWAY",
          gateway: selectedGateway,
          amount,
        });
      } else {
        await sendRegistrationPaymentLink(id, { source: "CUSTOM", customUrl });
      }
      setLinkSent(true);
      onLinkSent?.();
      toast.success(Messages.invoices.registrationLinkSent);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.registrationLinkFailed));
    } finally {
      setSendingLink(false);
    }
  }

  async function handleMarkPaid() {
    setMarkingPaid(true);
    try {
      const id = await ensureInvoiceId();
      setInvoiceId(id);
      const invoice = await markRegistrationFeePaid(id);
      setPaidAt(invoice.registrationFeePaidAt ?? new Date().toISOString());
      onLinkSent?.();
      toast.success(Messages.invoices.registrationFeeMarkedPaid);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.registrationFeeMarkPaidFailed));
    } finally {
      setMarkingPaid(false);
    }
  }

  if (paidAt) {
    return (
      <p className="text-[12.5px] font-medium text-success">
        ✓ Paid on {new Date(paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={linkSource === "GATEWAY" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setLinkSource("GATEWAY")}
        >
          Use payment gateway
        </Button>
        <Button
          type="button"
          size="sm"
          variant={linkSource === "CUSTOM" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setLinkSource("CUSTOM")}
        >
          Enter custom link
        </Button>
      </div>

      {linkSource === "GATEWAY" ? (
        <div className="flex gap-2">
          <Select
            value={selectedGateway}
            onValueChange={(v) => setSelectedGateway(v as PaymentGatewayName)}
          >
            <SelectTrigger className="flex-1">
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
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSendLink()}
            disabled={!canSendLink || sendingLink}
          >
            {sendingLink ? "Sending…" : "Send Link"}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Paste an existing payment link"
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSendLink()}
            disabled={!canSendLink || sendingLink}
          >
            {sendingLink ? "Sending…" : "Send Link"}
          </Button>
        </div>
      )}
      {linkSent && <p className="text-[12px] text-success">✓ Payment link sent</p>}
      {!hasAmount && (
        <p className="text-[11px] text-muted-foreground">
          Enter a registration fee above before sending a payment link.
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => void handleMarkPaid()}
        disabled={markingPaid}
      >
        {markingPaid ? "Marking…" : "Mark as paid"}
      </Button>
    </div>
  );
}
