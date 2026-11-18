import { UserCog } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useImpersonation } from "../../hooks/useImpersonation";

export default function ImpersonationBanner() {
  const { user, isImpersonating } = useAuth();
  const { exitImpersonation } = useImpersonation();

  if (!isImpersonating || !user) return null;

  return (
    <div className="bg-amber-600 text-white text-sm">
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <UserCog className="w-4 h-4 shrink-0" />
          <span className="font-medium truncate">
            Impersonating {user.name} ({user.role.replace("_", " ")})
          </span>
        </div>
        <button
          onClick={() => void exitImpersonation()}
          className="bg-white text-amber-700 hover:bg-white/90 rounded px-3 py-0.5 text-xs font-semibold transition-colors cursor-pointer shrink-0"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
