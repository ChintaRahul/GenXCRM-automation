import { useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { PaymentLinkForm } from "./PaymentLinkForm";

// Mirrors the backend's EMI formula (see backend/src/modules/invoices/invoices.math.ts
// and design_handoff_invoices/README.md's "Registration fee & EMI math" section) — for
// CLIENT-SIDE PREVIEW ONLY, shown before the plan is saved. Once createEmiPlan returns,
// the accordion renders the persisted rows from the API response instead of this.
//
// The backend's createEmiPlan bases the schedule on the invoice's `grandTotal` (post-GST).
// The Register flow now sends the rep's own gstEnabled/gstRate choice (see RegisterNew.tsx's
// TaxSettingsCard) when generating the invoice, so the preview must gross up by that same
// choice — not a hardcoded rate — to match what will actually be persisted.
// Caveat: it stays an approximation — GST is finalized later on the invoice form, and if
// someone edits GST/discount there before saving an EMI plan, the real schedule will differ.
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface EmiPreviewRow {
  installmentNumber: number;
  dueDate: Date;
  amount: number;
}

export function computeEmiPreview(params: {
  subtotal: number;
  registrationFee: number;
  negotiatedAmount?: number;
  tenureMonths: number;
  startDate: string;
  gstEnabled: boolean;
  gstRate: number;
}): EmiPreviewRow[] {
  const { subtotal, registrationFee, negotiatedAmount, tenureMonths, startDate, gstEnabled, gstRate } = params;
  if (!tenureMonths || tenureMonths < 1 || !startDate) return [];

  // A negotiated amount is the final agreed figure and is used as-is by the backend; only
  // the line-item subtotal needs grossing up to the invoice's GST-inclusive grand total.
  const base =
    negotiatedAmount && negotiatedAmount > 0
      ? negotiatedAmount
      : round2(subtotal * (1 + (gstEnabled ? gstRate / 100 : 0)));
  const emiBase = Math.max(base - registrationFee, 0);
  const perEmi = round2(emiBase / tenureMonths);
  const lastEmi = round2(emiBase - perEmi * (tenureMonths - 1));

  const start = new Date(startDate);
  return Array.from({ length: tenureMonths }, (_, i) => {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);
    return {
      installmentNumber: i + 1,
      dueDate,
      amount: i === tenureMonths - 1 ? lastEmi : perEmi,
    };
  });
}

interface RegistrationFeeCardProps {
  fee: number;
  onFeeChange: (fee: number) => void;
  screenshotFileName: string | null;
  onScreenshotFileSelected: (file: File) => void;
  uploadingScreenshot?: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  subtotal: number;
  // When set, a "Payment link" tab appears alongside "Screenshot" — omit (or leave
  // undefined) when no gateway is connected, since sending a link would be a dead end.
  ensurePaymentLinkInvoiceId?: () => Promise<string>;
}

// Step 3 of the Register flow: fee amount, payment proof (screenshot or a sent
// payment link), and notes. Payment proof defaults to screenshot
// (RegistrationPaymentMode.SCREENSHOT) — the primary "Save registration" action lives
// in the step controller's shared footer nav, not here — see pages/RegisterNew.tsx.
export function RegistrationFeeCard({
  fee,
  onFeeChange,
  screenshotFileName,
  onScreenshotFileSelected,
  uploadingScreenshot,
  note,
  onNoteChange,
  subtotal,
  ensurePaymentLinkInvoiceId,
}: RegistrationFeeCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const screenshotSection = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onScreenshotFileSelected(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadingScreenshot}
        className="w-full h-24 rounded-lg border border-dashed border-input flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
      >
        {uploadingScreenshot ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        <span className="text-[11.5px] truncate max-w-full px-3">
          {screenshotFileName ?? "Drop payment screenshot"}
        </span>
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label>Registration fee (₹)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={fee === 0 ? "" : fee}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onFeeChange(e.target.value === "" ? 0 : Number(e.target.value))}
          placeholder="0"
          className="font-mono"
        />
      </div>

      <div className="space-y-1.5">
        {ensurePaymentLinkInvoiceId ? (
          <Tabs defaultValue="screenshot">
            <div className="flex items-center justify-between">
              <Label>Payment proof</Label>
              <TabsList>
                <TabsTrigger value="screenshot">Screenshot</TabsTrigger>
                <TabsTrigger value="link">Payment link</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="screenshot">{screenshotSection}</TabsContent>
            <TabsContent value="link">
              <PaymentLinkForm ensureInvoiceId={ensurePaymentLinkInvoiceId} amount={fee} />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <Label>Payment screenshot</Label>
            {screenshotSection}
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Payment tracking notes</Label>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Transaction ref, UPI ID, remarks…"
          className="flex min-h-[56px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
        />
      </div>

      <div className="bg-muted/40 rounded-lg px-4 py-3 flex items-center justify-between text-[13px]">
        <span className="text-muted-foreground">Course fee total</span>
        <span className="font-mono tabular-nums font-semibold text-foreground">
          ₹{subtotal.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}
