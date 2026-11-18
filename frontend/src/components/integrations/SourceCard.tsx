import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { OrgIntegrationInfo, WebhookInfoDto } from "../../types";
import type { TabKey, ProviderKey } from "./types";
import { cn } from "../../lib/utils";

export type ProviderMeta = {
  key: ProviderKey;
  name: string;
  desc: string;
  brand: string; // hex (e.g. "#1877F2") or "hsl(var(--primary))" — used ONLY for the icon chip
  icon: LucideIcon;
  real: boolean;
  tab?: TabKey;
};

type SourceCardProps = {
  provider: ProviderMeta;
  status?: OrgIntegrationInfo;
  webhookInfo?: WebhookInfoDto | null;
  onOpen: (tab: TabKey) => void;
};

type Pill = { label: string; cls: string; dot?: string };

function resolvePill(provider: ProviderMeta, status?: OrgIntegrationInfo): Pill {
  if (!provider.real) {
    return { label: "Coming soon", cls: "bg-muted text-muted-foreground" };
  }
  if (status?.status === "CONNECTED") {
    return { label: "Connected", cls: "bg-green-500/10 text-green-600", dot: "bg-green-500" };
  }
  if (status?.status === "ERROR") {
    return { label: "Action needed", cls: "bg-amber-500/10 text-amber-600" };
  }
  if (status?.status === "PENDING") {
    return { label: "Verifying…", cls: "bg-amber-500/10 text-amber-600" };
  }
  return { label: "Not connected", cls: "bg-muted text-muted-foreground" };
}

// Footer renders only when we have a truthful value — never fabricated metrics.
function resolveFooter(
  provider: ProviderMeta,
  status?: OrgIntegrationInfo,
  webhookInfo?: WebhookInfoDto | null,
): string | null {
  if (!provider.real) return null;
  if (provider.key === "webhook") {
    return webhookInfo?.webhookUrl ? "Endpoint ready" : "Not set up";
  }
  if (status?.accountName) {
    return status.maskedAccountId
      ? `${status.accountName} · ${status.maskedAccountId}`
      : status.accountName;
  }
  return null;
}

export function SourceCard({ provider, status, webhookInfo, onOpen }: SourceCardProps) {
  const { icon: Icon } = provider;
  const pill = resolvePill(provider, status);
  const footer = resolveFooter(provider, status, webhookInfo);
  const isVar = provider.brand.startsWith("hsl");
  const chipStyle = {
    background: isVar ? "hsl(var(--primary) / 0.12)" : `${provider.brand}1f`,
    color: provider.brand,
  };

  const inner = (
    <>
      <div className="flex w-full items-start justify-between mb-2.5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={chipStyle}
        >
          <Icon className="w-4 h-4" />
        </div>
        <span
          className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1",
            pill.cls,
          )}
        >
          {pill.dot && <span className={cn("w-1.5 h-1.5 rounded-full", pill.dot)} />}
          {pill.label}
        </span>
      </div>
      <div
        className={cn(
          "text-sm font-semibold",
          provider.real ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {provider.name}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5 leading-snug min-h-[2.5rem]">
        {provider.desc}
      </div>
      {footer && (
        <div className="mt-3 w-full pt-2.5 border-t border-card-border text-[11px] text-muted-foreground flex items-center justify-between gap-2">
          <span className="truncate" title={footer}>
            {footer}
          </span>
          {provider.real && <ChevronRight className="w-3 h-3 flex-shrink-0" />}
        </div>
      )}
    </>
  );

  const base =
    "bg-card border border-card-border rounded-lg p-3.5 flex flex-col text-left w-full";

  if (provider.real && provider.tab) {
    return (
      <button
        type="button"
        onClick={() => onOpen(provider.tab!)}
        className={cn(base, "hover:border-primary/40 transition-colors")}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={cn(base, "cursor-default opacity-80")} title="Coming soon">
      {inner}
    </div>
  );
}
