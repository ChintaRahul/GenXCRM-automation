import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock, Users, Target, Zap, GitBranch, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { getTrialStatus } from "../../api/client";
import { PLAN_ACTIVATED_EVENT } from "../../lib/planEvents";
import type { TrialStatus } from "../../types";

const RESOURCES = [
  { key: "leads" as const, label: "Leads", Icon: Target },
  { key: "users" as const, label: "Team members", Icon: Users },
  { key: "sequences" as const, label: "Nurturing sequences", Icon: Zap },
  { key: "teams" as const, label: "Teams", Icon: GitBranch },
];

export default function TrialExpiredModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<TrialStatus | null>(null);

  useEffect(() => {
    const load = () => {
      getTrialStatus()
        .then(setStatus)
        .catch(() => {});
    };
    load();
    // Clear the blocking modal as soon as a subscription activates.
    window.addEventListener(PLAN_ACTIVATED_EVENT, load);
    return () => window.removeEventListener(PLAN_ACTIVATED_EVENT, load);
  }, []);

  const onBillingPage = location.pathname === "/billing";
  const show = !!status?.isExpired && !onBillingPage;

  if (!show) return null;

  const { usage, limits } = status!;

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border shadow-2xl p-0 overflow-hidden focus:outline-none"
        >
          {/* Header gradient */}
          <div className="bg-destructive/10 border-b border-destructive/20 px-6 pt-6 pb-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <DialogPrimitive.Title className="text-lg font-bold text-foreground">
                  Your free trial has ended
                </DialogPrimitive.Title>
                <p className="text-sm text-muted-foreground">
                  Upgrade to keep your data and resume operations.
                </p>
              </div>
            </div>
          </div>

          {/* Usage summary */}
          <div className="px-6 py-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Your trial activity
            </p>
            <div className="grid grid-cols-2 gap-3">
              {RESOURCES.map(({ key, label, Icon }) => (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5"
                >
                  <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate">
                      {label}
                    </p>
                    <p className="text-sm font-semibold">
                      {usage[key]}
                      <span className="text-xs font-normal text-muted-foreground">
                        /{limits[key]}
                      </span>
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              All write operations are paused. Your data is safe and will be
              restored once you upgrade.
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 pt-1">
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={() => navigate("/billing")}
            >
              Upgrade Now
              <ArrowRight className="w-4 h-4" />
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-3">
              Plans start from ₹499/user/month · Cancel anytime
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
