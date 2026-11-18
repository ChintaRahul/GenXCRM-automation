import { cn } from "../../lib/utils";

export type StrengthLevel = "empty" | "weak" | "fair" | "strong" | "very-strong";

export interface StrengthResult {
  level: StrengthLevel;
  score: number; // 0–4
  label: string;
}

export function getPasswordStrength(pw: string): StrengthResult {
  if (!pw) return { level: "empty", score: 0, label: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  const map: Record<number, { level: StrengthLevel; label: string }> = {
    0: { level: "weak", label: "Weak" },
    1: { level: "weak", label: "Weak" },
    2: { level: "fair", label: "Fair" },
    3: { level: "strong", label: "Strong" },
    4: { level: "very-strong", label: "Very strong" },
  };
  return { ...map[clamped], score: clamped };
}

const STRENGTH_COLORS: Record<StrengthLevel, string> = {
  empty: "bg-muted",
  weak: "bg-destructive",
  fair: "bg-amber-500",
  strong: "bg-chart-2",
  "very-strong": "bg-chart-2",
};

const STRENGTH_TEXT: Record<StrengthLevel, string> = {
  empty: "",
  weak: "text-destructive",
  fair: "text-amber-500",
  strong: "text-chart-2",
  "very-strong": "text-chart-2",
};

/** Presentational strength bar + label. Renders nothing until the user types. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = getPasswordStrength(password);
  return (
    <div className="space-y-1 pt-0.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((seg) => (
          <div
            key={seg}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              strength.score >= seg ? STRENGTH_COLORS[strength.level] : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className={cn("text-xs font-medium", STRENGTH_TEXT[strength.level])}>
        {strength.label}
        {strength.level === "weak" && (
          <span className="font-normal text-muted-foreground">
            {" "}
            — add uppercase, numbers or symbols
          </span>
        )}
        {strength.level === "fair" && (
          <span className="font-normal text-muted-foreground">
            {" "}
            — a few more characters would help
          </span>
        )}
      </p>
    </div>
  );
}
