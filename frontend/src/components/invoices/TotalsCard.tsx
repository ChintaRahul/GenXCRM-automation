import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { rupeeFull } from "../../lib/format";
import { cn } from "../../lib/utils";
import { usePaymentGateways } from "../../hooks/usePaymentGateways";
import type { DiscountType, GstType, PaymentGatewayName } from "../../types";

// ─── Client-side totals math ────────────────────────────────────────────────
// Ported 1:1 from backend/src/modules/invoices/invoices.math.ts's
// computeInvoiceTotals — for LIVE display only. The server response from
// createInvoice/updateInvoice is always the source of truth after submit (per
// the plan: "don't trust client-computed totals as final").

export interface TotalsLineItemInput {
  quantity: number;
  unitPrice: number;
}

export interface InvoiceTotalsInput {
  lineItems: TotalsLineItemInput[];
  discountType: DiscountType;
  discountValue: number;
  gstEnabled: boolean;
  gstType: GstType;
  gstRate: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeInvoiceTotalsClient(input: InvoiceTotalsInput): InvoiceTotals {
  const subtotal = round2(
    input.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0),
  );
  const rawDiscount =
    input.discountType === "PERCENT" ? subtotal * (input.discountValue / 100) : input.discountValue;
  const discountAmount = round2(Math.min(rawDiscount, subtotal));
  const taxableAmount = round2(subtotal - discountAmount);
  const taxAmount = input.gstEnabled ? round2(taxableAmount * (input.gstRate / 100)) : 0;
  const cgstAmount = input.gstEnabled && input.gstType === "CGST_SGST" ? round2(taxAmount / 2) : null;
  const sgstAmount = cgstAmount;
  const igstAmount = input.gstEnabled && input.gstType === "IGST" ? taxAmount : null;
  const grandTotal = round2(taxableAmount + taxAmount);
  return { subtotal, discountAmount, taxableAmount, taxAmount, cgstAmount, sgstAmount, igstAmount, grandTotal };
}

// ─── Component ──────────────────────────────────────────────────────────────

const GATEWAY_LABELS: Record<PaymentGatewayName, string> = {
  RAZORPAY: "Razorpay",
  CASHFREE: "Cashfree",
};

interface TotalsCardProps {
  totals: InvoiceTotals;
  gstEnabled: boolean;
  gstType: GstType;
  gstRate: number;
  discountType: DiscountType;
  discountValue: number;
  onDiscountTypeChange: (type: DiscountType) => void;
  onDiscountValueChange: (value: number) => void;
  attachPaymentLink: boolean;
  onAttachPaymentLinkChange: (attach: boolean) => void;
  gateway: PaymentGatewayName | null;
  onGatewayChange: (gateway: PaymentGatewayName) => void;
  // True once an EMI auto-debit mandate is active — Razorpay already collects every
  // installment on schedule, so a manually-attached payment link would be redundant.
  mandateActive?: boolean;
}

// Presentational — receives computed totals as props (the parent page owns the
// computation via computeInvoiceTotalsClient above). Also owns the "Attach payment
// link" sub-card, including its own usePaymentGateways() fetch — mirroring the
// RegistrationFeeCard precedent of a presentational component owning its own
// read-only data hook. The Send button's label is decided by the parent page (it
// already owns attachPaymentLink state), not by this card.
export function TotalsCard({
  totals,
  gstEnabled,
  gstType,
  gstRate,
  discountType,
  discountValue,
  onDiscountTypeChange,
  onDiscountValueChange,
  attachPaymentLink,
  onAttachPaymentLinkChange,
  gateway,
  onGatewayChange,
  mandateActive = false,
}: TotalsCardProps) {
  const { gateways } = usePaymentGateways();
  const halfRate = gstRate / 2;
  const hasConnectedGateway = gateways.some((g) => g.connected) && !mandateActive;

  return (
    <>
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-display text-sm font-bold text-foreground mb-3">Totals</h3>

        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono tabular-nums font-semibold text-foreground">
            {rupeeFull(totals.subtotal)}
          </span>
        </div>

        <div className="flex items-center justify-between py-1.5 text-sm gap-2.5">
          <span className="text-muted-foreground whitespace-nowrap">Discount</span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={discountValue}
              onChange={(e) => onDiscountValueChange(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 h-7 text-right font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant={discountType === "PERCENT" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => onDiscountTypeChange("PERCENT")}
            >
              %
            </Button>
            <Button
              type="button"
              size="sm"
              variant={discountType === "FLAT" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => onDiscountTypeChange("FLAT")}
            >
              ₹
            </Button>
          </div>
        </div>

        {totals.discountAmount > 0 && (
          <div className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-muted-foreground">Taxable amount</span>
            <span className="font-mono tabular-nums text-foreground">
              {rupeeFull(totals.taxableAmount)}
            </span>
          </div>
        )}

        {gstEnabled ? (
          gstType === "CGST_SGST" ? (
            <>
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted-foreground">CGST ({halfRate}%)</span>
                <span className="font-mono tabular-nums text-foreground">
                  {rupeeFull(totals.cgstAmount ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted-foreground">SGST ({halfRate}%)</span>
                <span className="font-mono tabular-nums text-foreground">
                  {rupeeFull(totals.sgstAmount ?? 0)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-muted-foreground">IGST ({gstRate}%)</span>
              <span className="font-mono tabular-nums text-foreground">
                {rupeeFull(totals.igstAmount ?? 0)}
              </span>
            </div>
          )
        ) : (
          <p className="text-[11px] text-muted-foreground pt-1">
            Tax-free invoice — GST not applied.
          </p>
        )}

        <div className="border-t border-border mt-2 pt-3 flex items-center justify-between">
          <span className="text-[13.5px] font-bold text-foreground">Grand Total</span>
          <span className="font-mono tabular-nums text-lg font-bold text-primary">
            {rupeeFull(totals.grandTotal)}
          </span>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-foreground">Attach payment link</h3>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              {mandateActive
                ? "Auto-debit mandate active — Razorpay already collects each installment"
                : hasConnectedGateway
                  ? "Lead can pay online from the invoice email/WhatsApp"
                  : "No payment gateway connected yet"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={attachPaymentLink}
            aria-label="Attach payment link"
            disabled={!hasConnectedGateway}
            onClick={() => onAttachPaymentLinkChange(!attachPaymentLink)}
            className={cn(
              "w-[38px] h-[22px] rounded-full relative flex-shrink-0 transition-colors",
              !hasConnectedGateway
                ? "bg-muted opacity-50 cursor-not-allowed"
                : attachPaymentLink
                  ? "bg-primary"
                  : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all",
                attachPaymentLink ? "left-[18px]" : "left-0.5",
              )}
            />
          </button>
        </div>

        {attachPaymentLink && hasConnectedGateway && (
          <div className="border-t border-border mt-3.5 pt-3.5">
            <p className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">
              Payment gateway
            </p>
            <div className="flex flex-col gap-1.5">
              {gateways.map((g) => (
                <button
                  key={g.gateway}
                  type="button"
                  disabled={!g.connected}
                  onClick={() => g.connected && onGatewayChange(g.gateway)}
                  className={cn(
                    "flex items-center gap-2 h-9 px-3 rounded-md border text-xs font-semibold text-left transition-colors",
                    !g.connected
                      ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
                      : gateway === g.gateway
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input bg-background text-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      g.connected ? "bg-success" : "bg-muted-foreground",
                    )}
                  />
                  <span className="flex-1">{GATEWAY_LABELS[g.gateway]}</span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {g.connected ? "Connected" : "Not connected"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
