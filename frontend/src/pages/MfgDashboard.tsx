import { useState } from "react";
import { Header } from "../components/layout/Header";
import { cn } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { MyDayView } from "../components/dashboard/mfg/MyDayView";
import { TeamView } from "../components/dashboard/mfg/TeamView";

// README §3.5: "A segmented toggle switches between My day and Team. Team is hidden for
// Sales Executive." — MfgRole gating; a caller without an mfgRole (not yet assigned one)
// sees both, matching the additive/unrestricted fallback used everywhere else in Phase 5.
export default function MfgDashboardPage() {
  const { user } = useAuth();
  const canSeeTeam = user?.mfgRole !== "SALES_EXECUTIVE";
  const [view, setView] = useState<"myday" | "team">("myday");

  return (
    <>
      <Header
        title="Dashboard"
        subtitle={view === "myday" ? "Your day at a glance" : "Team performance and pipeline health"}
        actions={
          canSeeTeam ? (
            <div className="flex items-center rounded-md border border-input overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setView("myday")}
                className={cn("px-3 h-8 max-[767px]:h-11", view === "myday" ? "bg-foreground text-background" : "bg-background")}
              >
                My day
              </button>
              <button
                type="button"
                onClick={() => setView("team")}
                className={cn("px-3 h-8 max-[767px]:h-11", view === "team" ? "bg-foreground text-background" : "bg-background")}
              >
                Team
              </button>
            </div>
          ) : undefined
        }
      />
      <div className="p-4 sm:p-6">
        {view === "team" && canSeeTeam ? <TeamView /> : <MyDayView />}
      </div>
    </>
  );
}
