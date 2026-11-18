import { useEffect, useState } from "react";
import { getModuleList } from "../api/modules";
import { REGISTRY } from "../modules/registry";

type KnownValues = Readonly<Record<string, readonly string[]>>;

const LIMIT = 100;

const stringValues = (rows: readonly Record<string, unknown>[], key: string): string[] =>
  rows.map((r) => r[key]).filter((v): v is string => typeof v === "string" && v !== "");

// Values already stored for a module's text fields, so the form can suggest them. One list request
// for the module itself (every field reads from it), plus accounts and leads for `city`.
export function useKnownValues(moduleKey: string, enabled: boolean): KnownValues {
  const [known, setKnown] = useState<KnownValues>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const moduleDef = REGISTRY[moduleKey];
    const textKeys = moduleDef.fields.filter((f) => f.type === "text").map((f) => f.key);

    const load = async () => {
      const fetchRows = async (key: string) => {
        try {
          return (await getModuleList(key, { page: 1, limit: LIMIT }))?.data ?? [];
        } catch {
          return [];
        }
      };
      const wantsCity = textKeys.includes("city");
      const [own, accounts, leads] = await Promise.all([
        fetchRows(moduleKey),
        wantsCity && moduleKey !== "accounts" ? fetchRows("accounts") : Promise.resolve([]),
        wantsCity && moduleKey !== "leads" ? fetchRows("leads") : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setKnown(
        Object.fromEntries(
          textKeys.map((key) => [key, key === "city" ? [...stringValues(own, key), ...stringValues(accounts, key), ...stringValues(leads, key)] : stringValues(own, key)]),
        ),
      );
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleKey, enabled]);

  return known;
}
