import { useState } from "react";
import { Link } from "react-router-dom";
import { useMfaResetRequest } from "../hooks/useMfaResetRequest";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <div className="flex items-center gap-3 mb-8">
            <img src="/logo-mark.png" alt="GenX CRM" className="w-14 h-14 object-contain" />
            <div>
              <p className="font-display font-bold text-foreground">GenX CRM</p>
              <p className="text-xs text-muted-foreground">Marketing Suite</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function MfaResetRequestPage() {
  const [email, setEmail] = useState("");
  const { submit, loading, error, success } = useMfaResetRequest();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(email);
  }

  if (success) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground mb-1">Check your inbox</h1>
        <p className="text-sm text-muted-foreground mb-6">
          If <span className="font-medium">{email}</span> has two-factor authentication enabled,
          we've sent a link to turn it off. The link expires in 1 hour.
        </p>
        <Link to="/login" className="text-sm text-primary hover:underline font-medium max-[767px]:inline-flex max-[767px]:min-h-11 max-[767px]:items-center">
          ← Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold text-foreground mb-1">Lost your authenticator?</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter your account email and we'll send you a link to turn off two-factor authentication,
        so you can sign in and set it up again.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="text-primary hover:underline font-medium max-[767px]:inline-flex max-[767px]:min-h-11 max-[767px]:items-center">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
