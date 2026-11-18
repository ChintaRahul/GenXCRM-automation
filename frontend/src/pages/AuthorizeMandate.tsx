import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import { useCashfreeMandateCheckout } from "../hooks/useCashfreeMandateCheckout";

// Public page (no login): the link sent to a student to authorize an auto-debit mandate.
// Cashfree hands out a session id instead of a hosted link, so this page opens its checkout.
export default function AuthorizeMandatePage() {
  const [params] = useSearchParams();
  const sessionId = params.get("s");
  const mode = params.get("m") === "sandbox" ? "sandbox" : "production";
  const done = params.get("done") === "1";
  const { start, starting, error } = useCashfreeMandateCheckout(sessionId, mode);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-card border border-card-border rounded-xl p-6 text-center space-y-4">
        {done ? (
          <>
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Thank you</h1>
            <p className="text-sm text-muted-foreground">
              Your authorization was submitted. You'll be notified once your auto-debit is active. You can close
              this page.
            </p>
          </>
        ) : sessionId ? (
          <>
            <ShieldCheck className="w-10 h-10 text-primary mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Authorize auto-debit</h1>
            <p className="text-sm text-muted-foreground">
              Set up automatic monthly payments for your course fee using UPI, e-NACH or card. You can only be
              charged the agreed installment amount on its due date.
            </p>
            <Button className="w-full" onClick={() => void start()} disabled={starting}>
              {starting ? "Opening…" : "Authorize now"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">Link not valid</h1>
            <p className="text-sm text-muted-foreground">
              This authorization link is incomplete or has expired. Please ask for a new one.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
