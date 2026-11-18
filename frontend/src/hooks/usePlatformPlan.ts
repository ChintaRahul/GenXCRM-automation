import { useEffect, useState } from "react";
import { getBillingPlans } from "../api/client";

export interface DefaultPlan {
  name: string;
  pricePerUser: number;
  minUsers: number;
}

// The plan to default template `plan`/`amount` to: only when the catalog has exactly one active
// plan (with several there's no obvious default). Only fetched when `enabled` — i.e. for the
// platform org, whose leads are prospects for the CRM itself.
export function usePlatformPlan(enabled: boolean): DefaultPlan | null {
  const [plan, setPlan] = useState<DefaultPlan | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const active = (await getBillingPlans()).filter((p) => p.isActive);
        if (cancelled) return;
        const [only] = active;
        setPlan(
          active.length === 1 && only
            ? { name: only.name, pricePerUser: only.pricePerUser, minUsers: Math.max(1, only.minUsers) }
            : null,
        );
      } catch {
        if (!cancelled) setPlan(null); // no default — the rep fills the value in
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return plan;
}
