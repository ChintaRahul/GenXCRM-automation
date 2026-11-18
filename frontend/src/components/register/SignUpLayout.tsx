import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Sun, Moon, Users, MessageCircle, BarChart3 } from "lucide-react";
import { isNative } from "../../lib/platform";

export interface SignUpStepMeta {
  step: 1 | 2 | 3 | 4;
  label: string;
  subLabel: string;
}

export const SIGNUP_STEPS: SignUpStepMeta[] = [
  { step: 1, label: "Your details", subLabel: "Name, email, password" },
  { step: 2, label: "Workspace", subLabel: "EdTech or Manufacturing" },
  { step: 3, label: "Organization", subLabel: "Name and team size" },
  { step: 4, label: "Plan", subLabel: "Free trial or paid" },
];

interface SignUpLayoutProps {
  step: 1 | 2 | 3 | 4;
  trialDays: number;
  /** Jump back to a completed step. Only steps before the current one are navigable. */
  onStepClick: (step: 1 | 2 | 3 | 4) => void;
  children: ReactNode;
}

function StepCircle({
  state,
  number,
}: {
  state: "done" | "current" | "upcoming";
  number: number;
}) {
  if (state === "done") {
    return (
      <span className="w-7 h-7 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
        <Check className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="w-7 h-7 shrink-0 rounded-full border-2 border-primary text-white flex items-center justify-center text-xs font-semibold">
        {number}
      </span>
    );
  }
  return (
    <span
      className="w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center text-xs font-semibold"
      style={{ borderColor: "hsl(var(--signup-panel-border))", color: "hsl(var(--signup-panel-muted))" }}
    >
      {number}
    </span>
  );
}

/** Desktop (lg+) dark sticky side panel with the vertical stepper. */
function SidePanel({
  step,
  trialDays,
  onStepClick,
}: {
  step: 1 | 2 | 3 | 4;
  trialDays: number;
  onStepClick: (step: 1 | 2 | 3 | 4) => void;
}) {
  return (
    <aside
      className="hidden lg:flex lg:flex-col lg:justify-between w-[380px] shrink-0 sticky top-0 h-screen text-white px-10 py-12"
      style={{ backgroundColor: "hsl(var(--signup-panel-bg))" }}
    >
      <div>
        <div className="flex items-center gap-3 mb-10">
          <img
            src="/logo-mark-white.png"
            alt="GenX CRM"
            className="w-9 h-9 object-contain"
          />
          <div>
            <p className="font-display font-bold">GenX CRM</p>
            <p className="text-xs" style={{ color: "hsl(var(--signup-panel-muted))" }}>
              Marketing Suite
            </p>
          </div>
        </div>

        <h2 className="font-display text-2xl font-semibold leading-snug mb-10">
          Your workspace is about two minutes away.
        </h2>

        <ol className="space-y-0">
          {SIGNUP_STEPS.map((meta, i) => {
            const state: "done" | "current" | "upcoming" =
              meta.step < step ? "done" : meta.step === step ? "current" : "upcoming";
            const navigable = meta.step < step;
            const connectorDone = meta.step < step;
            return (
              <li key={meta.step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {navigable ? (
                    <button
                      type="button"
                      onClick={() => onStepClick(meta.step)}
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      aria-label={`Back to ${meta.label}`}
                    >
                      <StepCircle state={state} number={meta.step} />
                    </button>
                  ) : (
                    <StepCircle state={state} number={meta.step} />
                  )}
                  {i < SIGNUP_STEPS.length - 1 && (
                    <span
                      className="w-[1.5px] flex-1 min-h-[28px]"
                      style={{
                        backgroundColor: connectorDone ? "hsl(var(--primary))" : "hsl(var(--signup-panel-border))",
                      }}
                    />
                  )}
                </div>
                <div className="pb-7">
                  <p
                    className={`text-sm font-medium ${state === "upcoming" ? "" : "text-primary-foreground"}`}
                    style={state === "upcoming" ? { color: "hsl(var(--signup-panel-muted))" } : undefined}
                  >
                    {meta.label}
                  </p>
                  <p className="text-xs" style={{ color: "hsl(var(--signup-panel-muted))" }}>
                    {meta.subLabel}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="text-xs space-y-1" style={{ color: "hsl(var(--signup-panel-muted-strong))" }}>
        <p>
          {trialDays}-day free trial &middot; No card required
        </p>
        <p>Need help? support@genxcrm.co.in</p>
      </div>
    </aside>
  );
}

function ThemeToggleButton({
  theme,
  onToggle,
}: {
  theme: "light" | "dark";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="h-9 w-9 shrink-0 rounded-md border border-input bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

/** Below lg: logo header + "Step N of 4" progress row with a 4-segment bar. */
function MobileHeader({
  step,
  theme,
  onToggleTheme,
}: {
  step: 1 | 2 | 3 | 4;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const meta = SIGNUP_STEPS[step - 1];
  return (
    <div className="lg:hidden mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo-mark.png" alt="GenX CRM" className="w-8 h-8 object-contain" />
          <p className="font-display font-bold text-foreground">GenX CRM</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm text-primary hover:underline font-medium whitespace-nowrap"
          >
            <span className="hidden min-[400px]:inline">Have an account? </span>
            Sign in
          </Link>
          <ThemeToggleButton theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>

      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Step {step} of 4 &middot; {meta.label}
        </span>
      </div>
      <div className="flex gap-1" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={4}>
        {SIGNUP_STEPS.map((s) => (
          <span
            key={s.step}
            className={`h-1 flex-1 rounded-full ${s.step <= step ? "bg-primary" : "bg-border"}`}
          />
        ))}
      </div>
    </div>
  );
}

const NATIVE_PERKS = [
  { icon: Users, text: "Every lead, auto-assigned to your team" },
  { icon: MessageCircle, text: "Call, WhatsApp and email in one place" },
  { icon: BarChart3, text: "Live pipeline and payments on the go" },
];

/** App-only welcome card above the first signup step (the website keeps the side panel). */
function NativeWelcome({ trialDays }: { trialDays: number }) {
  return (
    <div
      className="mb-6 rounded-2xl p-5 text-white"
      style={{ backgroundColor: "hsl(var(--signup-panel-bg))" }}
    >
      <h2 className="font-display text-xl font-semibold leading-snug">Run your sales from your pocket</h2>
      <p className="mt-1 text-sm" style={{ color: "hsl(var(--signup-panel-muted-strong))" }}>
        Start your {trialDays}-day free trial &middot; No card required
      </p>
      <ul className="mt-4 space-y-2.5">
        {NATIVE_PERKS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5 text-sm">
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignUpLayout({ step, trialDays, onStepClick, children }: SignUpLayoutProps) {
  // Step 2's two workspace cards use minmax(240px, 1fr) — at 520px (minus the lg:px-12
  // padding) there's only ~424px of inner width, which is narrower than the ~492px two
  // 240px cards need side by side, so auto-fit silently collapsed to one column even on
  // a wide desktop screen. Steps 1 and 3 are single-column forms that look right at 520px.
  const maxWidth = step === 4 ? "lg:max-w-[760px]" : step === 2 ? "lg:max-w-[700px]" : "lg:max-w-[520px]";
  // Independent of the app-wide theme toggle (document.documentElement's .dark class) — a
  // visitor on this public page has no app theme preference yet, so the default follows the
  // OS/browser's prefers-color-scheme instead (the toggle still lets them override it).
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  return (
    <div className={`min-h-screen flex bg-background text-foreground ${theme === "dark" ? "signup-dark" : "signup-light"}`}>
      <SidePanel step={step} trialDays={trialDays} onStepClick={onStepClick} />

      <div className="flex-1 min-w-0">
        <div className="hidden lg:flex items-center justify-end gap-4 px-12 pt-10">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Already have an account?{" "}
            <span className="text-primary font-medium hover:underline">Sign in</span>
          </Link>
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
        </div>

        <div
          className={`mx-auto w-full ${maxWidth} [&_input]:scroll-mb-36 px-4 pt-6 pb-16 min-[720px]:px-8 min-[720px]:pb-14 lg:px-12 lg:pt-0 lg:pb-16`}
          // scroll-mb-36 (above): keeps a focused input clear of the sticky action bar on phones.
          // The app draws edge-to-edge, so keep the header clear of the Android status bar.
          style={isNative() ? { paddingTop: "max(1.5rem, env(safe-area-inset-top))" } : undefined}
        >
          <MobileHeader step={step} theme={theme} onToggleTheme={toggleTheme} />
          {isNative() && step === 1 && <NativeWelcome trialDays={trialDays} />}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Back / Continue (or submit) action row. Sticky to the viewport bottom below 720px. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 pt-1 max-[719px]:sticky max-[719px]:bottom-0 max-[719px]:-mx-4 max-[719px]:mt-6 max-[719px]:border-t max-[719px]:border-border max-[719px]:bg-background max-[719px]:px-4 max-[719px]:py-3">
      {children}
    </div>
  );
}
