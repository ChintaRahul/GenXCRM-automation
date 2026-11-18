import {
  Share2,
  Globe,
  Link2,
  MessageCircle,
  Mail,
  Phone,
  CreditCard,
} from "lucide-react";
import type { IntegrationProvider, OrgIntegrationInfo, WebhookInfoDto } from "../../types";
import type { TabKey } from "./types";
import { SourceCard, type ProviderMeta } from "./SourceCard";

// Static provider registry (config, not runtime data). Only facebook/google/webhook
// are wired to live state; the rest are honest "Coming soon" placeholders.
const PROVIDERS: ProviderMeta[] = [
  {
    key: "facebook",
    name: "Meta Ads",
    desc: "Facebook & Instagram lead forms, Messenger and Audience Network.",
    brand: "#1877F2",
    icon: Share2,
    real: true,
    tab: "facebook",
  },
  {
    key: "google",
    name: "Google Ads",
    desc: "Import leads from Google Lead Form extensions.",
    brand: "#34A853",
    icon: Globe,
    real: true,
    tab: "google",
  },
  {
    key: "webhook",
    name: "Generic webhook",
    desc: "Receive leads from any source via a signed HTTP endpoint.",
    brand: "hsl(var(--primary))",
    icon: Link2,
    real: true,
    tab: "webhook",
  },
  {
    key: "whatsapp",
    name: "WhatsApp Business",
    desc: "Capture and reply to leads over WhatsApp.",
    brand: "#25D366",
    icon: MessageCircle,
    real: true,
    tab: "whatsapp",
  },
  {
    key: "email",
    name: "Email (SMTP / your domain)",
    desc: "Send from your own Gmail/SMTP account, or GenXCRM's SES with your verified domain.",
    brand: "#1A82E2",
    icon: Mail,
    real: true,
    tab: "email",
  },
  {
    key: "twilio",
    name: "Twilio",
    desc: "SMS and voice for lead outreach.",
    brand: "#F22F46",
    icon: Phone,
    real: false,
  },
  {
    key: "razorpay",
    name: "Razorpay",
    desc: "Collect payments from your students and share payment links.",
    brand: "#3395FF",
    icon: CreditCard,
    real: true,
    tab: "razorpay",
  },
  {
    key: "cashfree",
    name: "Cashfree",
    desc: "Collect payments through Cashfree payment links.",
    brand: "#7C3AED",
    icon: CreditCard,
    real: true,
    tab: "cashfree",
  },
  {
    key: "stripe",
    name: "Stripe",
    desc: "Global card payments and subscriptions.",
    brand: "#635BFF",
    icon: CreditCard,
    real: false,
  },
];

export const PROVIDER_COUNT = PROVIDERS.length;

const PROVIDER_TO_INTEGRATION: Record<string, IntegrationProvider> = {
  facebook: "FACEBOOK",
  google: "GOOGLE_ADS",
  webhook: "WEBHOOK",
  whatsapp: "WHATSAPP",
  email: "EMAIL",
  razorpay: "RAZORPAY",
  cashfree: "CASHFREE",
};

type SourcesGridProps = {
  onOpen: (tab: TabKey) => void;
  getStatus: (provider: IntegrationProvider) => OrgIntegrationInfo | undefined;
  webhookInfo: WebhookInfoDto | null;
};

export function SourcesGrid({ onOpen, getStatus, webhookInfo }: SourcesGridProps) {
  const resolved = PROVIDERS.map((provider) => {
    const integration = PROVIDER_TO_INTEGRATION[provider.key];
    const status = provider.real && integration ? getStatus(integration) : undefined;
    return { provider, status };
  });

  const connected = resolved.filter(({ status }) => status?.status === "CONNECTED").length;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Connected sources &amp; channels
        </h2>
        <span className="text-xs text-muted-foreground">
          {connected} connected · {PROVIDER_COUNT - connected} available
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {resolved.map(({ provider, status }) => (
          <SourceCard
            key={provider.key}
            provider={provider}
            status={status}
            webhookInfo={webhookInfo}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
