import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsRow } from "../settings/SettingsRow";
import { Messages } from "../../lib/messages";
import { apiErrorMessage } from "../../lib/apiError";

interface ApiWebhooksTabProps {
  apiKey: string | null;
  regenerating: boolean;
  onRegenerate: () => Promise<void>;
  canEdit: boolean;
  facebookWebhookUrl: string;
  googleWebhookUrl: string | null;
  genericWebhookUrl: string | null;
  // TradeIndia has no push option, so its API Link is saved here for the (not yet switched on) poller.
  tradeIndiaStatus?: string;
  onSaveTradeIndiaLink?: (apiLink: string) => Promise<void>;
}

const TRADEINDIA_STATUS_TEXT: Record<string, string> = {
  PENDING: "Link saved. Enquiries are not imported automatically yet.",
  CONNECTED: "Syncing enquiries.",
  ERROR: "The last sync failed. Check the link and save it again.",
};

const MARKETPLACES = [
  { label: "IndiaMART", slug: "indiamart", hint: "Lead Manager → ⋮ menu → Import/Export Leads → Push API. Paste this as the Webhook Listener URL, set Source to Other, enter the OTP IndiaMART sends, then use Test Your Webhook Listener URL." },
  { label: "TradeIndia", slug: "tradeindia", hint: "TradeIndia's documented route is a pull feed (My Inquiry API), not a push. Ask your TradeIndia account manager whether they can push enquiries to this URL." },
  { label: "ExportersIndia", slug: "exportersindia", hint: "ExportersIndia has no public push setting we could confirm. Ask your account manager whether they can send enquiries to this URL." },
  { label: "JustDial", slug: "justdial", hint: "No self-serve setting. Send this URL to your JustDial account manager and ask them to deliver leads to it (JustDial sends them as GET requests)." },
] as const;

// The generic ingest URL is `.../integrations/webhook/{orgToken}/ingest`; marketplaces use `.../integrations/hubs/{orgToken}/{slug}`.
function marketplaceUrl(genericUrl: string | null, slug: string): string | null {
  const match = genericUrl?.match(/^(.*)\/webhook\/([^/]+)\/ingest$/);
  return match ? `${match[1]}/hubs/${match[2]}/${slug}` : null;
}

function mask(key: string): string {
  return `${key.slice(0, 9)}${"•".repeat(12)}${key.slice(-4)}`;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text);
  toast.success(Messages.admin.copied);
}

export function ApiWebhooksTab({ apiKey, regenerating, onRegenerate, canEdit, facebookWebhookUrl, googleWebhookUrl, genericWebhookUrl, tradeIndiaStatus, onSaveTradeIndiaLink }: ApiWebhooksTabProps) {
  const [revealed, setRevealed] = useState(false);
  const [tradeIndiaLink, setTradeIndiaLink] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  async function handleSaveLink() {
    if (!onSaveTradeIndiaLink) return;
    setSavingLink(true);
    try {
      await onSaveTradeIndiaLink(tradeIndiaLink.trim());
      setTradeIndiaLink("");
    } catch {
      // the hook already showed the error toast
    } finally {
      setSavingLink(false);
    }
  }

  async function handleRegenerate() {
    try {
      await onRegenerate();
      toast.success(Messages.admin.apiKeyRegenerated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    }
  }

  const webhooks = [
    { label: "Facebook", url: facebookWebhookUrl },
    { label: "Google Ads", url: googleWebhookUrl },
    { label: "Generic", url: genericWebhookUrl },
  ];

  return (
    <div className="space-y-4">
      <SettingsCard title="API key" description="Use this key to send leads to GenXCRM from your own systems.">
        <SettingsRow label="Key">
          <code className="break-all rounded-full bg-muted px-3 py-1.5 font-mono text-sm [overflow-wrap:anywhere]">
            {apiKey ? (revealed ? apiKey : mask(apiKey)) : canEdit ? "Loading…" : "Only Directors can view the API key."}
          </code>
          <Button variant="outline" size="sm" disabled={!apiKey || !canEdit} onClick={() => setRevealed((v) => !v)}>
            {revealed ? "Hide" : "Reveal"}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" className="border-destructive/40 text-destructive" disabled={regenerating} onClick={handleRegenerate}>
              {regenerating ? "Regenerating…" : "Regenerate"}
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title="Inbound webhooks"
        description={
          <>
            Manage connection status and credentials on the{" "}
            <a href="/integrations" className="text-primary hover:underline">Integrations page</a>.
          </>
        }
      >
        {webhooks.map((wh) => (
          <SettingsRow key={wh.label} label={wh.label}>
            <code className="min-w-0 flex-1 break-all font-mono text-sm [overflow-wrap:anywhere]">
              {wh.url ?? "Connect this integration to get a webhook URL"}
            </code>
            {wh.url && (
              <Button variant="outline" size="sm" onClick={() => copy(wh.url as string)}>
                Copy
              </Button>
            )}
          </SettingsRow>
        ))}
      </SettingsCard>

      <SettingsCard title="Marketplace leads" description="Paste each URL into the marketplace so enquiries arrive here as leads. Keep these URLs private.">
        {MARKETPLACES.map(({ label, slug, hint }) => {
          const url = marketplaceUrl(genericWebhookUrl, slug);
          return (
            <SettingsRow key={slug} label={label}>
              <div className="min-w-0 flex-1">
                <code className="block break-all font-mono text-sm [overflow-wrap:anywhere]">{url ?? "URL not available yet"}</code>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
              </div>
              {url && (
                <Button variant="outline" size="sm" onClick={() => copy(url)}>
                  Copy
                </Button>
              )}
            </SettingsRow>
          );
        })}
      </SettingsCard>

      {canEdit && onSaveTradeIndiaLink && (
        <SettingsCard title="TradeIndia API Link" description="TradeIndia can't push leads, so GenXCRM reads them from your inquiry feed. Find the link under TradeIndia → Inquiries & Contacts → My Inquiry API.">
          <SettingsRow label="API Link">
            <Input
              type="password"
              autoComplete="off"
              className="min-w-0 flex-1"
              placeholder="https://www.tradeindia.com/…"
              value={tradeIndiaLink}
              onChange={(e) => setTradeIndiaLink(e.target.value)}
            />
            <Button variant="outline" size="sm" disabled={!tradeIndiaLink.trim() || savingLink} onClick={handleSaveLink}>
              {savingLink ? "Saving…" : "Save"}
            </Button>
          </SettingsRow>
          {tradeIndiaStatus && <p className="px-1 text-xs text-muted-foreground">{TRADEINDIA_STATUS_TEXT[tradeIndiaStatus] ?? tradeIndiaStatus}</p>}
        </SettingsCard>
      )}
    </div>
  );
}
