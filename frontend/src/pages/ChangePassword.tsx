import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useChangePassword } from "../hooks/useChangePassword";
import { useAuth } from "../context/AuthContext";
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

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [validationError, setValidationError] = useState("");

  const { submit, loading, error } = useChangePassword();

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

    const result = await submit(password);
    if (result) {
      // Fresh token clears mustChangePassword; update session and enter the app.
      signIn(result.token, result.user);
      navigate("/", { replace: true });
    }
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold text-foreground mb-1">
        Set your password
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Before you continue, choose a new password to replace the temporary one
        you were emailed.
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors p-0.5"
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
          {loading ? "Saving…" : "Save and continue"}
        </Button>
      </form>
    </AuthShell>
  );
}
