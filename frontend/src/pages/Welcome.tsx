import { ArrowRight } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { WelcomeCarousel } from "../components/welcome/WelcomeCarousel";
import { TRIAL_DAYS } from "../lib/trial";

// First-launch screen of the Android app: what GenX CRM does, then Sign in / Create account.
export default function WelcomePage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <div className="flex items-center gap-2.5 py-2 pl-[18px] pr-4">
        <img src="/logo-mark.png" alt="GenX CRM" className="h-[30px] w-[30px] object-contain" />
        <span className="font-display text-base font-bold">GenX CRM</span>
      </div>

      <WelcomeCarousel>
        {(stop) => (
          <div className="flex flex-col gap-2.5 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3.5">
            <div className="flex gap-2.5">
              <Link
                to="/login"
                state={{ from: "welcome" }}
                onClick={stop}
                className="flex h-[52px] flex-1 items-center justify-center rounded-xl border border-card-border bg-card text-[15px] font-semibold"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                onClick={stop}
                className="flex h-[52px] flex-[1.5] items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground"
              >
                Create account
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="text-center text-xs text-muted-foreground">{TRIAL_DAYS}-day free trial · No card required</p>
          </div>
        )}
      </WelcomeCarousel>
    </div>
  );
}
