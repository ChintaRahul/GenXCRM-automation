import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { toast } from "sonner";
import { getRecentLeads, type RecentLead } from "../api/client";
import { useAuth } from "./AuthContext";
import { useLeadStats } from "./LeadStatsContext";
import { startVisiblePolling } from "../lib/visiblePolling";

interface NotificationsCtx {
  /** Number of new leads received since the user last opened the bell. */
  count: number;
  /** The recent new leads (capped server-side), newest first. Persists until cleared. */
  leads: RecentLead[];
  /** Reset the unread badge — treats everything up to now as seen. Keeps the list. */
  markSeen: () => void;
  /** Empty the visible list and reset the badge. Cleared leads do not come back. */
  clear: () => void;
  /** Bumped whenever a poll detects genuinely-new leads — a reactivity signal other
   *  lead-derived hooks (reports/dashboard) can watch to auto-refetch. */
  newLeadVersion: number;
}

// Default lets consumers outside a <NotificationsProvider> (e.g. report hooks
// exercised in isolation in tests) work with no reactivity rather than crashing.
const NotificationsContext = createContext<NotificationsCtx>({
  count: 0,
  leads: [],
  markSeen: () => {},
  clear: () => {},
  newLeadVersion: 0,
});

const POLL_INTERVAL_MS = 30_000;
// `lastSeen` gates the unread badge; `listSince` gates which leads stay in the list. They are
// separate so opening the bell (markSeen) clears the badge WITHOUT emptying the list — the list
// only empties on an explicit clear().
const seenKey = (userId: string) => `genx:lead-lastseen:${userId}`;
const listKey = (userId: string) => `genx:lead-listsince:${userId}`;
// Persists which leads have already been toasted, so a remount (hard refresh, direct
// navigation) doesn't re-announce leads that were already shown in a prior mount.
const toastedKey = (userId: string) => `genx:lead-toasted:${userId}`;
const MAX_TOASTED_KEYS = 50;

const isAfter = (iso: string, ref: string) => Date.parse(iso) > Date.parse(ref);

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const leadStats = useLeadStats();
  const [count, setCount] = useState(0);
  const [leads, setLeads] = useState<RecentLead[]>([]);
  const [newLeadVersion, setNewLeadVersion] = useState(0);

  // Seeded to `now` on first ever load so the historical backlog never shows as new.
  const lastSeenRef = useRef<string>(new Date().toISOString());
  const listSinceRef = useRef<string>(new Date().toISOString());
  // Leads we've already toasted, so a lead isn't announced twice across polls.
  const toastedRef = useRef<Set<string>>(new Set());
  // Stable handle to LeadStatsContext.refresh — kept in a ref so the poll effect
  // (deps: [user]) doesn't need to re-run when the context value object changes identity.
  const refreshLeadStatsRef = useRef(leadStats.refresh);
  refreshLeadStatsRef.current = leadStats.refresh;

  useEffect(() => {
    if (!user) return;

    const now = new Date().toISOString();
    // Restore the seen anchor; seed to now on first ever load.
    const storedSeen = localStorage.getItem(seenKey(user.id));
    lastSeenRef.current = storedSeen ?? now;
    if (!storedSeen) localStorage.setItem(seenKey(user.id), now);
    // Restore the list anchor; fall back to the seen anchor (so old leads aren't resurfaced).
    const storedList = localStorage.getItem(listKey(user.id));
    listSinceRef.current = storedList ?? lastSeenRef.current;
    if (!storedList) localStorage.setItem(listKey(user.id), listSinceRef.current);

    // Restore already-toasted keys so a remount doesn't re-announce them.
    const storedToasted = localStorage.getItem(toastedKey(user.id));
    toastedRef.current = new Set(storedToasted ? (JSON.parse(storedToasted) as string[]) : []);
    setCount(0);
    setLeads([]);

    let cancelled = false;

    const poll = async () => {
      try {
        // Query the LIST window so already-seen leads remain visible until cleared.
        const { leads } = await getRecentLeads(listSinceRef.current);
        if (cancelled) return;
        setLeads(leads);
        // Unread badge = leads created or resubmitted (updatedAt) since lastSeen
        // (derived; list is capped at 20, which the "9+" badge already collapses past 9).
        setCount(leads.filter((l) => isAfter(l.updatedAt, lastSeenRef.current)).length);
        // Only announce genuinely-new (unseen) activity, once per updatedAt — keyed on
        // id+updatedAt (not just id) so a resubmission that bumps updatedAt re-announces.
        let sawNewLead = false;
        for (const lead of leads) {
          const toastKey = `${lead.id}:${lead.updatedAt}`;
          if (isAfter(lead.updatedAt, lastSeenRef.current) && !toastedRef.current.has(toastKey)) {
            toastedRef.current.add(toastKey);
            toast(`New lead: ${lead.name}`);
            sawNewLead = true;
          }
        }
        // A new lead landed — refresh the sidebar total and signal report/dashboard
        // hooks (via newLeadVersion) to re-fetch so every lead-derived count stays live.
        if (sawNewLead) {
          const capped = Array.from(toastedRef.current).slice(-MAX_TOASTED_KEYS);
          toastedRef.current = new Set(capped);
          localStorage.setItem(toastedKey(user.id), JSON.stringify(capped));
          refreshLeadStatsRef.current();
          setNewLeadVersion((v) => v + 1);
        }
      } catch {
        /* leave the last-known state in place on a transient error */
      }
    };

    // Only polls while the tab is visible — no background-tab API calls.
    const stopPolling = startVisiblePolling(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [user]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    lastSeenRef.current = now;
    if (user) localStorage.setItem(seenKey(user.id), now);
    setCount(0);
  }, [user]);

  const clear = useCallback(() => {
    const now = new Date().toISOString();
    lastSeenRef.current = now;
    listSinceRef.current = now;
    if (user) {
      localStorage.setItem(seenKey(user.id), now);
      localStorage.setItem(listKey(user.id), now);
      localStorage.removeItem(toastedKey(user.id));
    }
    toastedRef.current = new Set();
    setCount(0);
    setLeads([]);
  }, [user]);

  return (
    <NotificationsContext.Provider
      value={{ count, leads, markSeen, clear, newLeadVersion }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
