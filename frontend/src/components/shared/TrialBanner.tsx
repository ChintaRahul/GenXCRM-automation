import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock, Zap, X } from "lucide-react";
import { getTrialStatus } from "../../api/client";
import { PLAN_ACTIVATED_EVENT } from "../../lib/planEvents";
import type { TrialStatus } from "../../types";

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const nearLimit = pct >= 80;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-right shrink-0 text-white/80">{label}</span>
      <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${nearLimit ? "bg-amber-300" : "bg-white/70"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`w-14 shrink-0 ${nearLimit ? "text-amber-300 font-semibold" : "text-white/70"}`}
      >
        {used}/{limit}
      </span>
    </div>
  );
}

export default function TrialBanner() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = () => {
      getTrialStatus()
        .then(setStatus)
        .catch(() => {
          /* no org linked */
        });
    };
    load();
    // Refetch when a subscription activates so the banner clears without a refresh.
    window.addEventListener(PLAN_ACTIVATED_EVENT, load);
    return () => window.removeEventListener(PLAN_ACTIVATED_EVENT, load);
  }, []);

  if (!status || (dismissed && !status.isExpired)) return null;
  if (status.planStatus === "ACTIVE") return null;

  const { daysRemaining, isExpired, usage, limits } = status;
  const urgent = daysRemaining <= 3 && !isExpired;

  const bgClass = isExpired
    ? "bg-destructive"
    : urgent
      ? "bg-amber-600"
      : "bg-primary";

  return (
    <div className={`${bgClass} text-white text-sm`}>
      <div className="px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {isExpired ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : urgent ? (
              <Clock className="w-4 h-4 shrink-0" />
            ) : (
              <Zap className="w-4 h-4 shrink-0" />
            )}
            <span className="font-medium">
              {isExpired
                ? "Your trial has expired — all writes are disabled."
                : `Trial: ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`}
            </span>
            {!isExpired && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-white/70 hover:text-white underline underline-offset-2 text-xs ml-1"
              >
                {expanded ? "hide limits" : "see limits"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => navigate('/billing')}
              className="bg-white text-primary hover:bg-white/90 rounded px-3 py-0.5 text-xs font-semibold transition-colors cursor-pointer"
            >
              Upgrade
            </button>
            {!isExpired && (
              <button
                onClick={() => setDismissed(true)}
                className="text-white/60 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {expanded && !isExpired && (
          <div className="mt-2 pt-2 border-t border-white/20 grid grid-cols-2 gap-x-8 gap-y-1">
            <UsageBar label="Leads" used={usage.leads} limit={limits.leads} />
            <UsageBar label="Users" used={usage.users} limit={limits.users} />
            <UsageBar
              label="Sequences"
              used={usage.sequences}
              limit={limits.sequences}
            />
            <UsageBar label="Teams" used={usage.teams} limit={limits.teams} />
          </div>
        )}
      </div>
    </div>
  );
}
