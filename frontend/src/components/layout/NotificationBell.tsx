import { useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useNotifications } from "../../context/NotificationsContext";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useMfgNotifications } from "../../hooks/useMfgNotifications";
import { timeAgo } from "../../lib/utils";

function BellButton({
  count, visibility, onClick,
}: {
  count: number;
  visibility: "mobile" | "desktop" | "always";
  onClick: () => void;
}) {
  const visibilityClass = visibility === "mobile" ? "lg:hidden" : visibility === "desktop" ? "hidden lg:inline-flex" : "inline-flex";
  return (
    <button
      onClick={onClick}
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className={`${visibilityClass} relative rounded-full p-2 max-[767px]:p-3 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <Bell className="w-5 h-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-destructive text-[10px] font-bold leading-none text-white tabular-nums">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

// Manufacturing's SLA-alert inbox (SlaEngineService's 'In-app' channel) — a flat, generic
// title/body/link list, distinct from EdTech's leads-shaped bell below.
function MfgBell() {
  const { items, unreadCount, markRead, markAllRead } = useMfgNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  async function handleItemClick(id: string, link: string | null) {
    setOpen(false);
    await markRead(id);
    if (link) navigate(link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <BellButton count={unreadCount} visibility="always" onClick={() => setOpen((v) => !v)} />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {unreadCount > 0 && (
            <button
              onClick={() => void markAllRead()}
              className="text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:text-foreground transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No notifications</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => void handleItemClick(n.id, n.link)}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:bg-accent transition-colors ${n.isRead ? "" : "bg-primary/5"}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate">{n.title}</span>
                    <span className="block text-xs text-muted-foreground line-clamp-2">{n.body}</span>
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">{timeAgo(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// EdTech's new-leads bell — mobile navigates to a dedicated page, desktop uses a popover.
function EdTechBell() {
  const { count, leads, markSeen, clear } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const navigate = useNavigate();

  const handleNotifOpenChange = (open: boolean) => {
    setNotifOpen(open);
    if (open && count > 0) markSeen();
  };
  const handleLeadClick = (id: string) => {
    setNotifOpen(false);
    navigate(`/leads/${id}`);
  };
  const handleViewAll = () => {
    setNotifOpen(false);
    navigate("/leads");
  };

  return (
    <>
      <BellButton count={count} visibility="mobile" onClick={() => navigate("/notifications")} />
      <Popover open={notifOpen} onOpenChange={handleNotifOpenChange}>
        <PopoverTrigger asChild>
          <span>
            <BellButton count={count} visibility="desktop" onClick={() => handleNotifOpenChange(!notifOpen)} />
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">New leads</p>
            {leads.length > 0 && (
              <button
                onClick={clear}
                className="text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          {leads.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No new leads</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {leads.map((lead) => (
                <li key={lead.id}>
                  <button
                    onClick={() => handleLeadClick(lead.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:bg-accent transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">{lead.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">{lead.source}</span>
                    </span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">{timeAgo(lead.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border">
            <button
              onClick={handleViewAll}
              className="w-full px-4 py-2.5 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:bg-accent transition-colors"
            >
              View all leads
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export function NotificationBell() {
  return useWorkspace() === "MANUFACTURING" ? <MfgBell /> : <EdTechBell />;
}
