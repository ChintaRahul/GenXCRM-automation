import { ChevronDown, ChevronUp } from "lucide-react";
import { PaymentLinkForm } from "./PaymentLinkForm";

interface PaymentLinkAccordionProps {
  ensureInvoiceId: () => Promise<string>;
  // Step 4 always has the invoice already (registration was saved) — passing it lets
  // PaymentLinkForm show paid status on open instead of waiting for a click.
  knownInvoiceId?: string;
  open: boolean;
  onToggle: () => void;
  onLinkSent?: () => void;
}

// Step 4's "Send payment link" accordion, independent of the invoice generated below
// (design_handoff_register/). The actual form lives in PaymentLinkForm, shared with
// step 3's "Payment link" tab in RegistrationFeeCard.
export function PaymentLinkAccordion({
  ensureInvoiceId,
  knownInvoiceId,
  open,
  onToggle,
  onLinkSent,
}: PaymentLinkAccordionProps) {
  return (
    <div className="border border-card-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <span>
          <span className="block text-[13.5px] font-semibold text-foreground">
            Send payment link
          </span>
          <span className="block text-[11.5px] text-muted-foreground mt-0.5">
            Optional — text or email a link for the registration fee
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3.5 border-t border-border space-y-2.5">
          <PaymentLinkForm
            ensureInvoiceId={ensureInvoiceId}
            knownInvoiceId={knownInvoiceId}
            onLinkSent={onLinkSent}
          />
          <p className="text-[11px] text-muted-foreground">
            Sends the registration fee link now, independently of the invoice generated below.
          </p>
        </div>
      )}
    </div>
  );
}
