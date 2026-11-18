import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useResetPassword } from "../hooks/useResetPassword";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PasswordStrengthMeter } from "../components/ui/password-strength";
import { cn } from "../lib/utils";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <div className="flex items-center gap-3 mb-8">
            <img
              src="/logo-mark.png"
              alt="GenX CRM"
              className="w-14 h-14 object-contain"
            />
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

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [validationError, setValidationError] = useState("");

  const { submit, loading, error } = useResetPassword();

  // Live confirm-password validation (shown once the field has been blurred/typed).
  const confirmError =
    confirmTouched && confirm.length > 0 && confirm !== password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");

    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setValidationError("Passwords do not match.");
      return;
    }

    const ok = await submit(token, password);
    if (ok) navigate("/login?reset=true");
  }

  if (!token) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground mb-1">
          Invalid link
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          This password reset link is missing or malformed. Please request a new
          one.
        </p>
        <Link
          to="/forgot-password"
          className="text-sm text-primary hover:underline font-medium"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold text-foreground mb-1">
        Set a new password
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Choose a strong password you don't use elsewhere.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors p-0.5 max-[767px]:p-3 max-[767px]:-mr-3"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <PasswordStrengthMeter password={password} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type={showPassword ? "text" : "password"}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setConfirmTouched(true)}
            placeholder="••••••••"
            className={cn(
              confirmError && "border-destructive focus-visible:ring-destructive",
            )}
          />
          {confirmError && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>
        {(validationError || error) && (
          <p className="text-sm text-destructive">{validationError || error}</p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Updating…" : "Update password"}
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
