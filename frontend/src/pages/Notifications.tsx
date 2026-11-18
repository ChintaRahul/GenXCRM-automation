import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Header } from "../components/layout/Header";
import { EmptyState } from "../components/shared/EmptyState";
import { useNotifications } from "../context/NotificationsContext";
import { initials, timeAgo } from "../lib/utils";

export default function NotificationsPage() {
  const { leads, clear } = useNotifications();
  const navigate = useNavigate();

  return (
    <>
      <Header
        title="Notifications"
        hideBell
        actions={
          leads.length > 0 && (
            <button
              onClick={clear}
              className="text-sm font-medium text-primary hover:underline"
            >
              Clear
            </button>
          )
        }
      />
      <div className="p-4 sm:p-6">
        {leads.length === 0 ? (
          <EmptyState
            icon={<Bell className="w-8 h-8" />}
            title="No new leads."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {leads.map((lead) => (
              <li key={lead.id}>
                <button
                  onClick={() => navigate(`/leads/${lead.id}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-card-border bg-card px-3.5 py-3 text-left hover:bg-accent transition-colors"
                >
                  <Avatar className="w-9 h-9 flex-shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                      {initials(lead.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      New lead: {lead.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {lead.source}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                    {timeAgo(lead.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
