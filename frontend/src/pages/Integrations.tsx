import { apiUrl } from "../lib/apiUrl";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Upload,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  Link2,
  FileSpreadsheet,
  Globe,
  Share2,
  Pencil,
  Trash2,
  LayoutTemplate,
  Plus,
  ArrowLeft,
  BookOpen,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
  RotateCcw,
  RefreshCw,
  History,
  MessageCircle,
  Mail,
  CreditCard,
} from "lucide-react";
import { useIntegrations } from "../hooks/useIntegrations";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Header } from "../components/layout/Header";
import {
  SourcesGrid,
  PROVIDER_COUNT,
} from "../components/integrations/SourcesGrid";
import { RecoverLeadsDialog } from "../components/integrations/RecoverLeadsDialog";
import { GoogleFormsTab } from "../components/integrations/GoogleFormsTab";
import type { TabKey } from "../components/integrations/types";
import type { FacebookAdAccount } from "../api/client";
import type { EmailConfigDto, OrgIntegrationInfo, RazorpayWebhookInfoDto } from "../types";
import { ImportWizardModal } from "../components/leads/ImportWizardModal";
import { useImportMappings } from "../hooks/useImportMappings";
import { toast } from "sonner";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { cn } from "../lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-lg bg-muted/50 border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">
          endpoint
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="px-4 py-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}

function StepInstruction({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex gap-3 items-start text-sm text-muted-foreground">
      <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
        {num}
      </div>
      <span>{text}</span>
    </div>
  );
}

// ─── Tab: CSV Import (inline dashboard + wizard trigger) ─────────────────────

function CsvImportTab() {
  const {
    mappings: savedTemplates,
    loading: templatesLoading,
    updateMapping,
    deleteMapping,
  } = useImportMappings();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState<
    Record<string, string> | undefined
  >(undefined);
  const [templateOnly, setTemplateOnly] = useState(false);

  // Rename / delete state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openWizard = (opts?: {
    template?: Record<string, string>;
    templateOnly?: boolean;
  }) => {
    setWizardTemplate(opts?.template);
    setTemplateOnly(opts?.templateOnly ?? false);
    setWizardOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Start import CTA */}
      <div className="rounded-xl border border-border bg-muted/20 p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            Import leads from a CSV or Excel file
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-detects column names · supports mapping templates ·
            deduplicates on phone & email
          </p>
        </div>
        <Button onClick={() => openWizard()} className="gap-1.5 flex-shrink-0">
          <Upload className="w-4 h-4" />
          Start import wizard
        </Button>
      </div>

      {/* Templates section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Mapping Templates
            </p>
            <p className="text-xs text-muted-foreground">
              Save field mappings to skip manual setup on future imports
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => openWizard({ templateOnly: true })}
          >
            <Plus className="w-3.5 h-3.5" />
            New template
          </Button>
        </div>

        {templatesLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : savedTemplates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center rounded-xl border border-dashed border-border">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <LayoutTemplate className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                No templates yet
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">
                After mapping columns in the wizard, save as a template to reuse
                it next time.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 mt-1"
              onClick={() => openWizard({ templateOnly: true })}
            >
              <Plus className="w-3.5 h-3.5" />
              Create first template
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {savedTemplates.map((tpl) => {
              const fieldCount = Object.keys(tpl.mappings).length;
              const isRenaming = renamingId === tpl.id;
              const isDeleting = deletingId === tpl.id;

              return (
                <div
                  key={tpl.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <LayoutTemplate className="w-4 h-4 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <div className="flex gap-2 items-center">
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          className="h-6 text-xs px-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-48"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && renameValue.trim()) {
                              void updateMapping(tpl.id, {
                                name: renameValue.trim(),
                              })
                                .then(() => {
                                  toast.success(Messages.integrations.renamed);
                                  setRenamingId(null);
                                })
                                .catch((err) =>
                                  toast.error(apiErrorMessage(err, Messages.integrations.renameFailed)),
                                );
                            }
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                        />
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => {
                            if (renameValue.trim())
                              void updateMapping(tpl.id, {
                                name: renameValue.trim(),
                              })
                                .then(() => {
                                  toast.success(Messages.integrations.renamed);
                                  setRenamingId(null);
                                })
                                .catch((err) =>
                                  toast.error(apiErrorMessage(err, Messages.integrations.renameFailed)),
                                );
                          }}
                        >
                          Save
                        </button>
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setRenamingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p
                        className="text-sm font-medium text-foreground truncate"
                        title={tpl.name}
                      >
                        {tpl.name}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fieldCount} field{fieldCount !== 1 ? "s" : ""} mapped ·{" "}
                      {new Date(tpl.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  {isDeleting ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Delete?</span>
                      <button
                        className="text-destructive font-medium hover:underline"
                        onClick={() =>
                          void deleteMapping(tpl.id)
                            .then(() => {
                              toast.success(Messages.integrations.deleted);
                              setDeletingId(null);
                            })
                            .catch((err) =>
                              toast.error(apiErrorMessage(err, Messages.integrations.deleteFailed)),
                            )
                        }
                      >
                        Yes
                      </button>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setDeletingId(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2.5"
                        onClick={() => openWizard({ template: tpl.mappings })}
                      >
                        Use for import
                      </Button>
                      <button
                        onClick={() => {
                          setRenamingId(tpl.id);
                          setRenameValue(tpl.name);
                        }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingId(tpl.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Wizard modal */}
      <ImportWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialTemplate={wizardTemplate}
        templateOnly={templateOnly}
      />
    </div>
  );
}

// ─── Shared: Connection Status Badge ─────────────────────────────────────────

type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "ERROR" | "PENDING" | undefined;

function StatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === "CONNECTED")
    return (
      <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-medium">
        <Wifi className="w-3 h-3" /> Connected
      </span>
    );
  if (status === "ERROR")
    return (
      <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 font-medium">
        <AlertTriangle className="w-3 h-3" /> Error
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 font-medium">
      <WifiOff className="w-3 h-3" /> Not Connected
    </span>
  );
}

// ─── Tab: Meta Ads ────────────────────────────────────────────────────────────

const META_PLACEMENTS = [
  {
    name: "Facebook",
    color: "bg-[#1877F2]/10 text-[#1877F2] border-[#1877F2]/20",
    desc: "Feed, Stories, Reels, Marketplace",
  },
  {
    name: "Instagram",
    color: "bg-[#E1306C]/10 text-[#E1306C] border-[#E1306C]/20",
    desc: "Feed, Stories, Reels, Explore",
  },
  {
    name: "Messenger",
    color: "bg-[#0084FF]/10 text-[#0084FF] border-[#0084FF]/20",
    desc: "Sponsored messages, Inbox ads",
  },
  {
    name: "Audience Network",
    color: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    desc: "Third-party apps & websites",
  },
];

interface MetaAdsTabProps {
  status: ConnectionStatus;
  accountName?: string | null;
  maskedAccountId?: string | null;
  adAccountName?: string | null;
  lastSyncedAt?: string | null;
  lastBackfillAt?: string | null;
  lastBackfillLeadsCount?: number | null;
  backfilling: boolean;
  onBackfill: (sinceIso: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
  adAccounts: FacebookAdAccount[] | null;
  adAccountsLoading: boolean;
  onLoadAdAccounts: () => void;
  onPickAdAccount: (adAccountId: string) => void;
  syncing: boolean;
  onRefreshInsights: () => void;
}

function MetaAdsTab({
  status,
  accountName,
  maskedAccountId,
  adAccountName,
  lastSyncedAt,
  lastBackfillAt,
  lastBackfillLeadsCount,
  backfilling,
  onBackfill,
  onConnect,
  onDisconnect,
  connecting,
  adAccounts,
  adAccountsLoading,
  onLoadAdAccounts,
  onPickAdAccount,
  syncing,
  onRefreshInsights,
}: MetaAdsTabProps) {
  const [showManual, setShowManual] = useState(false);
  const [openFb, setOpenFb] = useState(false);
  const [openIg, setOpenIg] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const webhookUrl = apiUrl("/integrations/facebook/webhook");
  const verifyToken = "genxcrm-fb-verify";

  return (
    <div className="space-y-5">
      {/* Connection card */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#1877F2]/10 flex items-center justify-center">
            <Share2 className="w-5 h-5 text-[#1877F2]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground">
              Meta Ads — All Placements
            </p>
            {(() => {
              const desc =
                status === "CONNECTED" && accountName
                  ? `Connected: ${accountName}${maskedAccountId ? ` (${maskedAccountId})` : ""}`
                  : "Connect your Facebook Page to receive leads automatically";
              return (
                <p
                  className="text-xs text-muted-foreground truncate"
                  title={desc}
                >
                  {desc}
                </p>
              );
            })()}
          </div>
          <StatusBadge status={status} />
        </div>

        {status === "CONNECTED" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">Page connected</p>
              <p className="text-sm font-medium text-foreground truncate">
                {accountName ?? "Facebook Page"}
              </p>
              {maskedAccountId && (
                <p className="text-xs text-muted-foreground font-mono">
                  {maskedAccountId}
                </p>
              )}
            </div>
            {!confirmDisconnect ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 flex-shrink-0"
                onClick={() => setConfirmDisconnect(true)}
              >
                Disconnect
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Disconnect?</span>
                <button
                  className="text-destructive font-medium hover:underline"
                  onClick={() => {
                    onDisconnect();
                    setConfirmDisconnect(false);
                  }}
                >
                  Yes
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setConfirmDisconnect(false)}
                >
                  No
                </button>
              </div>
            )}
          </div>
        ) : null}

        {status === "CONNECTED" && (
          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
            {lastBackfillAt ? (
              <p className="text-xs text-muted-foreground">
                Recovered {lastBackfillLeadsCount ?? 0} lead
                {lastBackfillLeadsCount === 1 ? "" : "s"} generated while disconnected —{" "}
                {new Date(lastBackfillAt).toLocaleString()}
              </p>
            ) : (
              <span />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground gap-1.5 -mr-2"
              onClick={() => setRecoverOpen(true)}
            >
              <History className="w-3.5 h-3.5" />
              Recover missed leads
            </Button>
          </div>
        )}

        <RecoverLeadsDialog
          open={recoverOpen}
          onOpenChange={setRecoverOpen}
          submitting={backfilling}
          lastRecovered={
            lastBackfillAt ? { at: lastBackfillAt, count: lastBackfillLeadsCount ?? 0 } : null
          }
          onRecover={(sinceIso) => {
            onBackfill(sinceIso);
            setRecoverOpen(false);
          }}
        />

        {status === "CONNECTED" && (
          <div className="mt-3 rounded-lg bg-muted/30 border border-border px-3 py-2.5">
            {adAccountName ? (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-xs text-muted-foreground">Ad account (spend sync)</p>
                  <p className="text-sm font-medium text-foreground truncate">
                    {adAccountName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lastSyncedAt
                      ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
                      : "Not synced yet"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncing}
                  onClick={onRefreshInsights}
                  className="gap-1.5 flex-shrink-0"
                >
                  {syncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Refresh from Facebook
                </Button>
              </div>
            ) : adAccounts ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Choose the ad account to sync spend/CPL/CTR from:
                </p>
                {adAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No ad accounts found on this Facebook Business.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {adAccounts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => onPickAdAccount(a.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition-colors"
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Connect an ad account to sync real spend, CPL, and CTR into reports.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={adAccountsLoading}
                  onClick={onLoadAdAccounts}
                  className="gap-1.5 flex-shrink-0"
                >
                  {adAccountsLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  Connect ad account
                </Button>
              </div>
            )}
          </div>
        )}

        {status !== "CONNECTED" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {META_PLACEMENTS.map(({ name, color, desc }) => (
                <div
                  key={name}
                  className={`flex items-start gap-2 p-3 rounded-xl border text-xs ${color}`}
                >
                  <div className="font-semibold">{name}</div>
                  <div className="text-muted-foreground ml-auto text-right leading-tight">
                    {desc}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-card-border pt-4 mt-1">
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[15rem]">
                Opens a secure Meta window. You’ll{" "}
                <span className="text-foreground font-medium">choose which Page</span>{" "}
                to link.
              </p>
              <Button
                onClick={onConnect}
                disabled={connecting}
                className="gap-2 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white"
              >
                {connecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
                Connect Facebook
              </Button>
            </div>
            {status === "ERROR" && (
              <p className="text-xs text-destructive text-center">
                Connection error — click above to reconnect your Facebook Page.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Advanced / Manual setup */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowManual(!showManual)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
        >
          <span className="flex items-center gap-2 text-muted-foreground text-xs">
            Advanced / Manual Setup (self-hosted)
          </span>
          {showManual ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        {showManual && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
            <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                How source detection works:
              </span>{" "}
              Meta sends{" "}
              <code className="bg-muted px-1 rounded">object: "instagram"</code>{" "}
              for Instagram and{" "}
              <code className="bg-muted px-1 rounded">object: "page"</code> for
              Facebook / Messenger / Audience Network.
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  Webhook URL
                </Label>
                <CodeBlock code={webhookUrl} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  Verify Token
                </Label>
                <CodeBlock code={verifyToken} />
              </div>
            </div>
            {[
              {
                label: "Facebook Page Setup",
                icon: (
                  <span className="w-5 h-5 rounded-full bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center text-[10px] font-bold">
                    f
                  </span>
                ),
                open: openFb,
                toggle: () => setOpenFb(!openFb),
                steps: [
                  "Go to developers.facebook.com → Your App → Webhooks",
                  "Click 'Add Callback URL', paste the Webhook URL above",
                  "Enter the Verify Token and click 'Verify and Save'",
                  "Under the 'Page' object, subscribe to the 'leadgen' field",
                  "In your Lead Ad campaign, ensure Instant Form is enabled",
                ],
              },
              {
                label: "Instagram Setup",
                icon: (
                  <span className="w-5 h-5 rounded-full bg-[#E1306C]/10 text-[#E1306C] flex items-center justify-center text-[10px] font-bold">
                    ig
                  </span>
                ),
                open: openIg,
                toggle: () => setOpenIg(!openIg),
                steps: [
                  "In the same Meta App, go to Webhooks → Instagram object",
                  "Add the same Callback URL and Verify Token as above",
                  "Subscribe to the 'leadgen' field under the Instagram object",
                  "Connect your Instagram Business Account to the app via the Instagram Graph API product",
                ],
              },
            ].map(({ label, icon, open, toggle, steps }) => (
              <div
                key={label}
                className="bg-muted/20 border border-border rounded-xl overflow-hidden"
              >
                <button
                  onClick={toggle}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-foreground hover:bg-muted/30 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    {icon}
                    {label}
                  </span>
                  {open ? (
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
                {open && (
                  <div className="px-4 pb-4 space-y-2.5 border-t border-border pt-3">
                    {steps.map((text, i) => (
                      <StepInstruction key={i} num={i + 1} text={text} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Google Ads ──────────────────────────────────────────────────────────

interface GoogleAdsTabProps {
  status: ConnectionStatus;
  accountName?: string | null;
  maskedAccountId?: string | null;
  webhookUrl?: string | null;
  webhookKey?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRegenerateKey: () => Promise<unknown>;
  connecting: boolean;
}

function GoogleAdsTab({
  status,
  accountName,
  maskedAccountId,
  webhookUrl,
  webhookKey,
  onConnect,
  onDisconnect,
  onRegenerateKey,
  connecting,
}: GoogleAdsTabProps) {
  const [showManual, setShowManual] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const displayWebhookUrl =
    webhookUrl ?? "Connect your account to get your unique webhook URL";
  // Real Google Ads Lead Form webhook shape — fields are keyed by stable column_id.
  const payload = `{\n  "lead_id": "987654321",\n  "campaign_id": "123456789",\n  "adgroup_id": "456789012",\n  "creative_id": "789012345",\n  "google_key": "<your webhook key>",\n  "is_test": false,\n  "user_column_data": [\n    { "column_id": "FULL_NAME", "string_value": "Jane Smith" },\n    { "column_id": "EMAIL", "string_value": "jane@example.com" },\n    { "column_id": "PHONE_NUMBER", "string_value": "+91 98765 43210" }\n  ]\n}`;

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerateKey();
    } finally {
      setRegenerating(false);
      setConfirmRegen(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Webhook card — the primary, always-available path. No account connection
          or server env config is required for leads to flow. */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#4285F4]/10 flex items-center justify-center flex-shrink-0">
            <Globe className="w-5 h-5 text-[#4285F4]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground">
              Google Ads Lead Forms
            </p>
            <p className="text-xs text-muted-foreground">
              Paste this URL and key into your lead form — no account connection
              needed.
            </p>
          </div>
          {webhookUrl && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-medium flex-shrink-0">
              Ready
            </span>
          )}
        </div>

        {!webhookUrl ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Preparing your webhook…
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Your Webhook URL (use in Google Ads Lead Forms)
              </Label>
              <CodeBlock code={displayWebhookUrl} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs text-muted-foreground">
                  Webhook key (paste into Google Ads)
                </Label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showKey ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    {showKey ? "Hide" : "Show"}
                  </button>
                  {!confirmRegen ? (
                    <button
                      onClick={() => setConfirmRegen(true)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Regenerate
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Regenerate?</span>
                      <button
                        className="text-destructive font-medium hover:underline"
                        onClick={() => void handleRegenerate()}
                        disabled={regenerating}
                      >
                        {regenerating ? "..." : "Yes"}
                      </button>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setConfirmRegen(false)}
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="relative rounded-lg bg-muted/50 border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">
                    Webhook key
                  </span>
                  {webhookKey && <CopyButton text={webhookKey} />}
                </div>
                <pre className="px-4 py-3 text-xs font-mono text-foreground break-all whitespace-pre-wrap">
                  {webhookKey
                    ? showKey
                      ? webhookKey
                      : "••••••••••••••••••••••••••••"
                    : "Regenerate to create a key"}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Google echoes this key back on every lead — leads with a wrong or
                missing key are rejected. Regenerating invalidates the old key.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Optional: connect the Google Ads account to display the Customer ID.
          Not required for lead delivery — purely informational. */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Connect Google Ads account{" "}
              <span className="text-xs font-normal text-muted-foreground">
                · optional
              </span>
            </p>
            {(() => {
              const desc =
                status === "CONNECTED" && accountName
                  ? `Connected: ${accountName}${maskedAccountId ? ` · Customer ID ${maskedAccountId}` : ""}`
                  : "Link your account to show your Customer ID here. Leads work without it.";
              return (
                <p
                  className="text-xs text-muted-foreground mt-0.5 truncate"
                  title={desc}
                >
                  {desc}
                </p>
              );
            })()}
            {status === "ERROR" && (
              <p className="text-xs text-destructive mt-1">
                Token expired — reconnect to refresh your account details.
              </p>
            )}
          </div>
          <div className="flex-shrink-0">
            {status === "CONNECTED" ? (
              !confirmDisconnect ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Disconnect?</span>
                  <button
                    className="text-destructive font-medium hover:underline"
                    onClick={() => {
                      onDisconnect();
                      setConfirmDisconnect(false);
                    }}
                  >
                    Yes
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setConfirmDisconnect(false)}
                  >
                    No
                  </button>
                </div>
              )
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Globe className="w-4 h-4" />
                )}
                Connect
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Manual setup */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowManual(!showManual)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
        >
          <span className="text-xs text-muted-foreground">
            Setup Instructions &amp; Payload Format
          </span>
          {showManual ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        {showManual && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
            <div className="space-y-3">
              {[
                "In Google Ads, go to Assets → Lead forms (or Campaigns → your lead-form asset)",
                "Open the lead form and expand 'Webhook integration (optional)'",
                "Paste your unique Webhook URL into 'Webhook URL'",
                "Paste your Webhook key (above) into the 'Key' field — they must match exactly",
                "Click 'Send test data' to verify, then Save",
              ].map((text, i) => (
                <StepInstruction key={i} num={i + 1} text={text} />
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Expected Payload
              </p>
              <div className="relative rounded-lg bg-muted/50 border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground">JSON</span>
                  <CopyButton text={payload} />
                </div>
                <pre className="px-4 py-3 text-xs font-mono text-foreground overflow-x-auto">
                  {payload}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Generic Webhook ─────────────────────────────────────────────────────

interface GenericWebhookTabProps {
  webhookUrl: string | null;
  webhookSecret: string | null;
  onRegenerate: () => Promise<unknown>;
}

function GenericWebhookTab({
  webhookUrl,
  webhookSecret,
  onRegenerate,
}: GenericWebhookTabProps) {
  const manufacturing = useAuth()?.user?.org?.workspaceType === "MANUFACTURING";
  const [codeTab, setCodeTab] = useState<"curl" | "js">("curl");
  const [showSecret, setShowSecret] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const endpoint = webhookUrl ?? "Connect to get your unique ingest URL";

  const fields = manufacturing
    ? [
        { name: "name", type: "string", desc: "Contact person (required)" },
        { name: "company", type: "string", desc: "Company name" },
        { name: "phone", type: "string", desc: "Phone number (required)" },
        { name: "email", type: "string", desc: "Email address" },
        { name: "product", type: "string", desc: "Product of interest, e.g. Weighbridge" },
        { name: "source", type: "string", desc: "Lead source, e.g. Website" },
        { name: "external_id", type: "string", desc: "Your own id for the enquiry — a repeat with the same id is not added twice" },
        { name: "requirement", type: "string", desc: "What the customer needs" },
      ]
    : [
        { name: "name", type: "string", desc: "Full name of the lead (required)" },
        { name: "phone", type: "string", desc: "Phone number (required)" },
        { name: "email", type: "string", desc: "Email address" },
        { name: "course", type: "string", desc: "Program or course of interest" },
        { name: "source", type: "string", desc: "Lead source identifier" },
      ];
  const sample = manufacturing
    ? { external_id: "WEB-1001", name: "Meera Joshi", phone: "9822012345", email: "meera@acmefab.in", company: "Acme Fabricators", product: "Weighbridge" }
    : { name: "Priya Sharma", phone: "9876543210", email: "priya@example.com", course: "MBA", source: "WEBSITE" };
  const compactBody = JSON.stringify(sample);
  // The signature covers the exact bytes sent, so the example signs one compact line and sends that same line.
  const curlCode = `BODY='${compactBody}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "<your HMAC secret>" | sed 's/^.* //')

curl -X POST "${endpoint}" \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: sha256=$SIG" \
  -d "$BODY"`;
  const jsCode = `const body = JSON.stringify(${JSON.stringify(sample)});
const sig = "sha256=" + createHmacSha256(yourWebhookSecret, body);

const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-webhook-signature": sig,
  },
  body,
});
const lead = await res.json();`;

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
      setConfirmRegen(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Endpoint card */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground">Generic Webhook</p>
            <p className="text-xs text-muted-foreground">
              Send leads from any platform using HTTP POST
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
            {webhookUrl ? "Ready" : "Setup Required"}
          </span>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Ingest Endpoint (org-specific)
            </Label>
            <CodeBlock code={endpoint} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-muted-foreground">
                HMAC Secret
              </Label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSecret(!showSecret)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showSecret ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  {showSecret ? "Hide" : "Show"}
                </button>
                {!confirmRegen ? (
                  <button
                    onClick={() => setConfirmRegen(true)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Regenerate
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Regenerate?</span>
                    <button
                      className="text-destructive font-medium hover:underline"
                      onClick={() => void handleRegenerate()}
                      disabled={regenerating}
                    >
                      {regenerating ? "..." : "Yes"}
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setConfirmRegen(false)}
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="relative rounded-lg bg-muted/50 border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-xs text-muted-foreground font-mono">
                  Your secret — used to sign requests, never sent itself
                </span>
                {webhookSecret && <CopyButton text={webhookSecret} />}
              </div>
              <pre className="px-4 py-3 text-xs font-mono text-foreground break-all whitespace-pre-wrap">
                {webhookSecret
                  ? showSecret
                    ? webhookSecret
                    : `${"•".repeat(24)}${webhookSecret.slice(-4)}`
                  : "No secret set — click Regenerate to create one"}
              </pre>
            </div>
            {webhookSecret && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Sign the exact request body with HMAC-SHA256 using this secret and send the result in the{" "}
                <code className="bg-muted px-1 rounded">x-webhook-signature</code> header as{" "}
                <code className="bg-muted px-1 rounded">sha256={"<hex>"}</code>. A request without a matching signature is refused with 401.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Accepted Fields
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {fields.map(({ name, type, desc }) => (
            <div key={name} className="flex gap-2 text-sm">
              <code className="px-1.5 py-0.5 rounded bg-muted text-primary text-xs font-mono h-fit mt-0.5">
                {name}
              </code>
              <div>
                <span className="text-muted-foreground text-xs italic">
                  {type}
                </span>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Code examples */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex gap-2 mb-4">
          {(["curl", "js"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setCodeTab(t)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                codeTab === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "curl" ? "cURL" : "JavaScript"}
            </button>
          ))}
        </div>
        <div className="relative rounded-lg bg-muted/50 border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-xs text-muted-foreground">
              {codeTab === "curl" ? "cURL" : "JavaScript (fetch)"}
            </span>
            <CopyButton text={codeTab === "curl" ? curlCode : jsCode} />
          </div>
          <pre className="px-4 py-3 text-xs font-mono text-foreground overflow-x-auto">
            {codeTab === "curl" ? curlCode : jsCode}
          </pre>
        </div>
      </div>
    </div>
  );
}

interface WhatsAppTabProps {
  status?: string;
  connectMethod?: "EMBEDDED_SIGNUP" | "MANUAL" | null;
  accountName?: string | null;
  maskedAccountId?: string | null;
  webhookUrl: string | null;
  verifyToken: string | null;
  connecting: boolean;
  embeddedSignupConnecting: boolean;
  onConnect: (dto: {
    phoneNumberId: string;
    accessToken: string;
    appSecret: string;
    businessAccountId: string;
  }) => Promise<unknown>;
  onConnectEmbeddedSignup: () => Promise<unknown>;
  onDisconnect: () => void;
  onRegenerate: () => Promise<unknown>;
}

function WhatsAppTab({
  status,
  connectMethod,
  accountName,
  maskedAccountId,
  webhookUrl,
  verifyToken,
  connecting,
  embeddedSignupConnecting,
  onConnect,
  onConnectEmbeddedSignup,
  onDisconnect,
  onRegenerate,
}: WhatsAppTabProps) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const connected = status === "CONNECTED";

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
      setConfirmRegen(false);
    }
  };

  if (!connected) {
    return (
      <div className="space-y-4 max-w-md">
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-[#25D366]" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Connect your WhatsApp Business Account</p>
              <p className="text-xs text-muted-foreground">
                One click — no separate Meta App needed.
              </p>
            </div>
          </div>
          <Button
            onClick={() => void onConnectEmbeddedSignup()}
            disabled={embeddedSignupConnecting}
            className="w-full"
          >
            {embeddedSignupConnecting ? "Connecting…" : "Connect with WhatsApp"}
          </Button>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full text-sm font-medium text-foreground"
          >
            Advanced: connect your own Meta app instead
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showAdvanced && (
            <div className="space-y-3 mt-4">
              <div>
                <Label htmlFor="wa-phone-id" className="text-xs text-muted-foreground mb-1.5 block">
                  Phone Number ID
                </Label>
                <Input
                  id="wa-phone-id"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="123456789012345"
                />
              </div>
              <div>
                <Label htmlFor="wa-access-token" className="text-xs text-muted-foreground mb-1.5 block">
                  Access Token
                </Label>
                <Input
                  id="wa-access-token"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Permanent System User token"
                />
              </div>
              <div>
                <Label htmlFor="wa-app-secret" className="text-xs text-muted-foreground mb-1.5 block">
                  App Secret
                </Label>
                <Input
                  id="wa-app-secret"
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="From your Meta App's Basic Settings"
                />
              </div>
              <div>
                <Label htmlFor="wa-waba-id" className="text-xs text-muted-foreground mb-1.5 block">
                  WhatsApp Business Account ID
                </Label>
                <Input
                  id="wa-waba-id"
                  value={businessAccountId}
                  onChange={(e) => setBusinessAccountId(e.target.value)}
                  placeholder="109876543210987"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Needed to manage and send your own approved message templates. Find it next to the Phone
                  Number ID in Meta's WhatsApp Manager.
                </p>
              </div>
              <Button
                onClick={() =>
                  void onConnect({ phoneNumberId, accessToken, appSecret, businessAccountId }).then(() => {
                    setPhoneNumberId("");
                    setAccessToken("");
                    setAppSecret("");
                    setBusinessAccountId("");
                  })
                }
                disabled={connecting || !phoneNumberId || !accessToken || !appSecret || !businessAccountId}
                className="w-full"
                variant="outline"
              >
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-[#25D366]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate" title={accountName ?? undefined}>
              {accountName ?? "WhatsApp Business"}
            </p>
            <p className="text-xs text-muted-foreground">{maskedAccountId ?? "Connected"}</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-medium flex-shrink-0">
            Connected
          </span>
        </div>

        {connectMethod !== "EMBEDDED_SIGNUP" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Webhook URL (paste into your Meta App's Configuration → Webhooks)
              </Label>
              <CodeBlock code={webhookUrl ?? "Loading…"} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs text-muted-foreground">Verify Token</Label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showToken ? "Hide" : "Show"}
                  </button>
                  {!confirmRegen ? (
                    <button
                      onClick={() => setConfirmRegen(true)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Regenerate
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Regenerate?</span>
                      <button
                        className="text-destructive font-medium hover:underline"
                        onClick={() => void handleRegenerate()}
                        disabled={regenerating}
                      >
                        {regenerating ? "..." : "Yes"}
                      </button>
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => setConfirmRegen(false)}>
                        No
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="relative rounded-lg bg-muted/50 border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">hub.verify_token value</span>
                  {verifyToken && <CopyButton text={verifyToken} />}
                </div>
                <pre className="px-4 py-3 text-xs font-mono text-foreground break-all whitespace-pre-wrap">
                  {verifyToken ? (showToken ? verifyToken : `${"•".repeat(24)}${verifyToken.slice(-4)}`) : "Loading…"}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!confirmDisconnect ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Disconnect WhatsApp?</span>
            <Button variant="destructive" size="sm" onClick={onDisconnect}>
              Yes, disconnect
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface EmailTabProps {
  config: EmailConfigDto | null;
  connecting: boolean;
  checking: boolean;
  onConnectSmtp: (dto: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
  }) => Promise<unknown>;
  onConnectSesDomain: (dto: { domain: string; fromEmail: string; fromName: string }) => Promise<unknown>;
  onCheckStatus: () => void;
  onDisconnect: () => void;
}

function EmailTab({
  config,
  connecting,
  checking,
  onConnectSmtp,
  onConnectSesDomain,
  onCheckStatus,
  onDisconnect,
}: EmailTabProps) {
  const [method, setMethod] = useState<"SMTP" | "SES_DOMAIN">(config?.method ?? "SMTP");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const connected = config?.status === "CONNECTED";
  const pending = config?.status === "PENDING";

  const handleConnectSmtp = async () => {
    await onConnectSmtp({ host, port: Number(port), secure, username, password, fromEmail, fromName });
    setHost("");
    setPort("587");
    setSecure(false);
    setUsername("");
    setPassword("");
    setFromEmail("");
    setFromName("");
  };

  const handleConnectSesDomain = async () => {
    await onConnectSesDomain({ domain, fromEmail, fromName });
    setDomain("");
    setFromEmail("");
    setFromName("");
  };

  if (pending) {
    return (
      <div className="space-y-5">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#1A82E2]/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-[#1A82E2]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground truncate" title={config?.domain ?? undefined}>
                {config?.domain}
              </p>
              <p className="text-xs text-muted-foreground">Sending from {config?.fromEmail}</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 font-medium flex-shrink-0">
              Verifying…
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Add these DNS records at your domain provider, then check status. Verification can take a few
            minutes to a few hours to propagate.
          </p>
          <div className="space-y-2">
            {config?.dnsRecords?.map((record) => (
              <div key={`${record.type}-${record.name}`} className="rounded-lg bg-muted/50 border border-border p-3 text-xs space-y-1.5">
                <span className="font-mono font-semibold text-foreground">{record.type}</span>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground truncate min-w-0" title={record.name}>
                    Name: <span className="font-mono">{record.name}</span>
                  </p>
                  <CopyButton text={record.name} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground truncate min-w-0" title={record.value}>
                    Value: <span className="font-mono">{record.value}</span>
                  </p>
                  <CopyButton text={record.value} />
                </div>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-4" onClick={onCheckStatus} disabled={checking}>
            {checking ? "Checking…" : "Check status"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {!confirmDisconnect ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Disconnect email?</span>
              <Button variant="destructive" size="sm" onClick={onDisconnect}>
                Yes, disconnect
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4 max-w-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1A82E2]/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-[#1A82E2]" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Connect your email sending</p>
            <p className="text-xs text-muted-foreground">
              Send from your own SMTP account (e.g. Gmail), or GenXCRM's email service with your verified domain.
            </p>
          </div>
        </div>

        <div className="flex gap-1 p-1 rounded-lg bg-muted/50 border border-border">
          <button
            type="button"
            onClick={() => setMethod("SMTP")}
            className={cn(
              "flex-1 text-xs font-medium py-1.5 rounded-md transition-colors",
              method === "SMTP" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            Custom SMTP
          </button>
          <button
            type="button"
            onClick={() => setMethod("SES_DOMAIN")}
            className={cn(
              "flex-1 text-xs font-medium py-1.5 rounded-md transition-colors",
              method === "SES_DOMAIN" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            Use my own domain
          </button>
        </div>

        {method === "SMTP" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="smtp-host" className="text-xs text-muted-foreground mb-1.5 block">
                  SMTP Host
                </Label>
                <Input id="smtp-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
              </div>
              <div>
                <Label htmlFor="smtp-port" className="text-xs text-muted-foreground mb-1.5 block">
                  Port
                </Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                />
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
                  Use TLS (port 465)
                </label>
              </div>
            </div>
            <div>
              <Label htmlFor="smtp-username" className="text-xs text-muted-foreground mb-1.5 block">
                Username
              </Label>
              <Input
                id="smtp-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@gmail.com"
              />
            </div>
            <div>
              <Label htmlFor="smtp-password" className="text-xs text-muted-foreground mb-1.5 block">
                Password
              </Label>
              <Input
                id="smtp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="App password"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                For Gmail, use a 16-character App Password, not your account password.
              </p>
            </div>
            <div>
              <Label htmlFor="smtp-from-email" className="text-xs text-muted-foreground mb-1.5 block">
                From email
              </Label>
              <Input
                id="smtp-from-email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="sales@yourdomain.com"
              />
            </div>
            <div>
              <Label htmlFor="smtp-from-name" className="text-xs text-muted-foreground mb-1.5 block">
                From name
              </Label>
              <Input
                id="smtp-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your Academy"
              />
            </div>
            <Button
              onClick={() => void handleConnectSmtp()}
              disabled={connecting || !host || !port || !username || !password || !fromEmail || !fromName}
              className="w-full"
            >
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="ses-domain" className="text-xs text-muted-foreground mb-1.5 block">
                Your domain
              </Label>
              <Input
                id="ses-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="yourdomain.com"
              />
            </div>
            <div>
              <Label htmlFor="ses-from-email" className="text-xs text-muted-foreground mb-1.5 block">
                From email
              </Label>
              <Input
                id="ses-from-email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="sales@yourdomain.com"
              />
            </div>
            <div>
              <Label htmlFor="ses-from-name" className="text-xs text-muted-foreground mb-1.5 block">
                From name
              </Label>
              <Input
                id="ses-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your Academy"
              />
            </div>
            <Button
              onClick={() => void handleConnectSesDomain()}
              disabled={connecting || !domain || !fromEmail || !fromName}
              className="w-full"
            >
              {connecting ? "Starting verification…" : "Start domain verification"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#1A82E2]/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-[#1A82E2]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate" title={config?.fromName ?? undefined}>
              {config?.fromName ?? "Email"}
            </p>
            <p className="text-xs text-muted-foreground truncate" title={config?.fromEmail ?? undefined}>
              {config?.fromEmail} · {config?.method === "SMTP" ? config?.maskedUsername : config?.domain}
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-medium flex-shrink-0">
            Connected
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!confirmDisconnect ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Disconnect email?</span>
            <Button variant="destructive" size="sm" onClick={onDisconnect}>
              Yes, disconnect
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface RazorpayTabProps {
  status?: OrgIntegrationInfo["status"];
  maskedAccountId?: string | null;
  connecting: boolean;
  webhookInfo: RazorpayWebhookInfoDto | null;
  onConnect: (dto: { keyId: string; keySecret: string }) => Promise<unknown>;
  onDisconnect: () => void;
  onRegenerateWebhookSecret: () => Promise<unknown>;
}

function RazorpayTab({
  status,
  maskedAccountId,
  connecting,
  webhookInfo,
  onConnect,
  onDisconnect,
  onRegenerateWebhookSecret,
}: RazorpayTabProps) {
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const connected = status === "CONNECTED";
  const webhookUrl = webhookInfo?.webhookUrl ?? null;
  const webhookSecret = webhookInfo?.webhookSecret ?? null;

  const handleConnect = async () => {
    await onConnect({ keyId, keySecret });
    setKeyId("");
    setKeySecret("");
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerateWebhookSecret();
    } finally {
      setRegenerating(false);
      setConfirmRegen(false);
    }
  };

  const webhookCard = (
    <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs space-y-2">
      <p className="text-muted-foreground">
        In your Razorpay dashboard, go to <span className="font-medium text-foreground">Settings → Webhooks</span>,
        add this URL, and subscribe to the <span className="font-mono">payment_link.paid</span> event:
      </p>
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground break-all font-mono">
          {webhookUrl ?? "Loading…"}
        </p>
        {webhookUrl && <CopyButton text={webhookUrl} />}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">
          Razorpay will ask for a <span className="font-medium text-foreground">Secret</span> — paste this one in:
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showSecret ? "Hide" : "Show"}
          </button>
          {!confirmRegen ? (
            <button
              onClick={() => setConfirmRegen(true)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Regenerate
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Regenerate?</span>
              <button
                className="text-destructive font-medium hover:underline"
                onClick={() => void handleRegenerate()}
                disabled={regenerating}
              >
                {regenerating ? "…" : "Yes"}
              </button>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setConfirmRegen(false)}>
                No
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md bg-card border border-border px-2.5 py-1.5">
        <p className="text-foreground break-all font-mono">
          {webhookSecret ? (showSecret ? webhookSecret : "•".repeat(24) + webhookSecret.slice(-4)) : "Loading…"}
        </p>
        {webhookSecret && <CopyButton text={webhookSecret} />}
      </div>
      <p className="text-muted-foreground">
        Then add an API Key from <span className="font-medium text-foreground">Settings → API Keys</span> below.
      </p>
    </div>
  );

  if (connected) {
    return (
      <div className="space-y-5">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#3395FF]/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-[#3395FF]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">Razorpay</p>
              <p className="text-xs text-muted-foreground truncate" title={maskedAccountId ?? undefined}>
                Key ID {maskedAccountId}
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-medium flex-shrink-0">
              Connected
            </span>
          </div>
          {webhookCard}
        </div>
        <div className="flex items-center gap-2">
          {!confirmDisconnect ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Disconnect Razorpay?</span>
              <Button variant="destructive" size="sm" onClick={onDisconnect}>
                Yes, disconnect
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4 max-w-md">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#3395FF]/10 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-[#3395FF]" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Connect your Razorpay account</p>
          <p className="text-xs text-muted-foreground">
            Payment links you send to leads/students collect straight into your own Razorpay account.
          </p>
        </div>
      </div>

      {webhookCard}

      <div>
        <Label htmlFor="rzp-key-id" className="text-xs text-muted-foreground mb-1.5 block">
          Key ID
        </Label>
        <Input id="rzp-key-id" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_live_..." />
      </div>
      <div>
        <Label htmlFor="rzp-key-secret" className="text-xs text-muted-foreground mb-1.5 block">
          Key Secret
        </Label>
        <Input
          id="rzp-key-secret"
          type="password"
          value={keySecret}
          onChange={(e) => setKeySecret(e.target.value)}
          placeholder="Key Secret"
        />
      </div>
      <Button
        onClick={() => void handleConnect()}
        disabled={connecting || !keyId || !keySecret}
        className="w-full"
      >
        {connecting ? "Connecting…" : "Connect"}
      </Button>
    </div>
  );
}

// Cashfree webhooks live in the merchant's own dashboard (one endpoint per product tab), so
// this card gives them the exact URL and events — payments and mandates only update once set.
function CashfreeWebhookGuide() {
  const webhookUrl = apiUrl("/payments/webhook/CASHFREE");
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
      <div>
        <p className="font-semibold text-foreground">Set up the webhook</p>
        <p className="text-xs text-muted-foreground">
          Needed so paid links and auto-debit status update here automatically.
        </p>
      </div>
      <CodeBlock code={webhookUrl} />
      <ol className="list-decimal pl-5 space-y-1.5 text-xs text-muted-foreground">
        <li>
          In <span className="font-medium text-foreground">Cashfree → Payment Gateway → Developers → Webhooks</span>,
          open the <span className="font-medium text-foreground">Payment Link</span> tab, click Add Webhook
          Endpoint, paste the URL above and tick the payment link paid event.
        </li>
        <li>
          Open the <span className="font-medium text-foreground">Subscriptions</span> tab, add the same URL and
          tick: subscription status changed, auth status, payment success and payment failed.
        </li>
        <li>
          Choose the latest webhook version and save. No webhook secret is needed — Cashfree signs with your
          Secret Key.
        </li>
      </ol>
    </div>
  );
}

interface CashfreeTabProps {
  status?: OrgIntegrationInfo["status"];
  maskedAccountId?: string | null;
  connecting: boolean;
  onConnect: (dto: { appId: string; secretKey: string }) => Promise<unknown>;
  onDisconnect: () => void;
}

function CashfreeTab({ status, maskedAccountId, connecting, onConnect, onDisconnect }: CashfreeTabProps) {
  const [appId, setAppId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connected = status === "CONNECTED";

  const handleConnect = async () => {
    await onConnect({ appId: appId.trim(), secretKey: secretKey.trim() });
    setAppId("");
    setSecretKey("");
  };

  const logo = (
    <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
      <CreditCard className="w-5 h-5 text-[#7C3AED]" />
    </div>
  );

  if (connected) {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            {logo}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">Cashfree</p>
              <p className="text-xs text-muted-foreground truncate" title={maskedAccountId ?? undefined}>
                App ID {maskedAccountId}
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-medium flex-shrink-0">
              Connected
            </span>
          </div>
        </div>
        <CashfreeWebhookGuide />
        </div>
        <div className="flex items-center gap-2">
          {!confirmDisconnect ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Disconnect Cashfree?</span>
              <Button variant="destructive" size="sm" onClick={onDisconnect}>
                Yes, disconnect
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        {logo}
        <div>
          <p className="font-semibold text-foreground">Connect your Cashfree account</p>
          <p className="text-xs text-muted-foreground">
            Payment links you send to leads/students collect straight into your own Cashfree account.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Find these in <span className="font-medium text-foreground">Cashfree dashboard → Developers → API Keys</span>.
        Test keys (App ID starting with TEST) create test links; live keys create real ones.
      </p>
      <div>
        <Label htmlFor="cf-app-id" className="text-xs text-muted-foreground mb-1.5 block">
          App ID
        </Label>
        <Input
          id="cf-app-id"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="App ID"
          autoComplete="off"
        />
      </div>
      <div>
        <Label htmlFor="cf-secret-key" className="text-xs text-muted-foreground mb-1.5 block">
          Secret Key
        </Label>
        <Input
          id="cf-secret-key"
          type="password"
          autoComplete="new-password"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder="Secret Key"
        />
      </div>
      <Button
        onClick={() => void handleConnect()}
        disabled={connecting || !appId.trim() || !secretKey.trim()}
        className="w-full"
      >
        {connecting ? "Connecting…" : "Connect"}
      </Button>
      </div>
      <CashfreeWebhookGuide />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DOCS_URL = "https://genxcrm.co.in/docs/integrations.html";

// Top-level underline tabs. Meta/Google/Webhook are also reached from the Sources grid,
// so only Sources, CSV and Webhooks appear in the bar (plus a disabled API keys entry).
const BAR_TABS: { key: TabKey; label: string; count?: number }[] = [
  { key: "sources", label: "Sources & channels", count: PROVIDER_COUNT },
  { key: "csv", label: "CSV / Excel import" },
  { key: "webhook", label: "Webhooks", count: 1 },
  { key: "forms", label: "Google Forms" },
];

export default function IntegrationsPage() {
  const [tab, setTab] = useState<TabKey>("sources");
  // Manufacturing leads live in their own table with their own Import button on the Leads list; this wizard would write to the EdTech table.
  const isManufacturingOrg = useAuth()?.user?.org?.workspaceType === "MANUFACTURING";
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    webhookInfo,
    googleWebhookInfo,
    connectFacebook,
    connectGoogle,
    facebookConnecting,
    googleConnecting,
    disconnect,
    regenerateSecret,
    loadGoogleWebhookInfo,
    regenerateGoogleKey,
    getStatus,
    adAccounts,
    adAccountsLoading,
    loadAdAccounts,
    pickAdAccount,
    syncing,
    refreshInsights,
    backfilling,
    backfillFacebook,
    whatsappWebhookInfo,
    whatsappConnecting,
    connectWhatsAppAccount,
    loadWhatsAppWebhookInfo,
    regenerateWhatsAppKey,
    connectWhatsAppEmbeddedSignup,
    whatsappEmbeddedSignupConnecting,
    emailConfig,
    emailConnecting,
    loadEmailConfig,
    connectEmailSmtpAccount,
    connectEmailSesDomainAccount,
    checkEmailStatus,
    razorpayConnecting,
    connectRazorpayAccount,
    cashfreeConnecting,
    connectCashfreeAccount,
    razorpayWebhookInfo,
    loadRazorpayWebhookInfo,
    regenerateRazorpayKey,
  } = useIntegrations();
  const [emailChecking, setEmailChecking] = useState(false);

  // Handle OAuth redirect back. The provider callback redirects the popup here.
  // If we're running inside that popup (opened with name "oauth-popup"), close
  // it — the opener polls popup.closed and refreshes the statuses. In a normal
  // tab, just switch to the provider's tab and clear the param.
  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected !== "facebook" && connected !== "google") return;

    const isOAuthPopup =
      window.name === "oauth-popup" || (!!window.opener && window.opener !== window);
    if (isOAuthPopup) {
      window.close();
      return;
    }

    setTab(connected);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  // Provision + load the Google webhook URL/key only when the user opens the tab.
  useEffect(() => {
    if (tab === "google" && !googleWebhookInfo) void loadGoogleWebhookInfo();
  }, [tab, googleWebhookInfo, loadGoogleWebhookInfo]);

  // Provision + load the WhatsApp webhook verify token only when the user opens the tab.
  useEffect(() => {
    if (tab === "whatsapp" && !whatsappWebhookInfo) void loadWhatsAppWebhookInfo();
  }, [tab, whatsappWebhookInfo, loadWhatsAppWebhookInfo]);

  // Provision + load the Razorpay webhook secret only when the user opens the tab.
  useEffect(() => {
    if (tab === "razorpay" && !razorpayWebhookInfo) void loadRazorpayWebhookInfo();
  }, [tab, razorpayWebhookInfo, loadRazorpayWebhookInfo]);

  // Provision + load the email config only when the user opens the tab.
  useEffect(() => {
    if (tab === "email" && !emailConfig) void loadEmailConfig();
  }, [tab, emailConfig, loadEmailConfig]);

  // Auto-check SES domain verification once per visit if it's still PENDING — the org
  // shouldn't have to click "Check status" just because they came back to look.
  const emailAutoCheckedRef = useRef(false);
  useEffect(() => {
    if (tab !== "email") {
      emailAutoCheckedRef.current = false;
      return;
    }
    if (emailConfig?.status === "PENDING" && !emailAutoCheckedRef.current) {
      emailAutoCheckedRef.current = true;
      setEmailChecking(true);
      void checkEmailStatus().finally(() => setEmailChecking(false));
    }
  }, [tab, emailConfig, checkEmailStatus]);

  const fbStatus = getStatus("FACEBOOK");
  const googleStatus = getStatus("GOOGLE_ADS");
  const whatsappStatus = getStatus("WHATSAPP");
  const razorpayStatus = getStatus("RAZORPAY");
  const cashfreeStatus = getStatus("CASHFREE");

  return (
    <>
      <Header
        title="Integrations"
        subtitle="Connect lead sources and import data into GenX CRM"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a
                href={`${DOCS_URL}?return=${encodeURIComponent(window.location.href)}`}
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen className="w-4 h-4 mr-1.5" />
                Docs
              </a>
            </Button>
            <Button size="sm" onClick={() => setTab("sources")}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add integration
            </Button>
          </>
        }
      />
      <div className="p-4 sm:p-6">
        <div className="flex gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border mb-5">
          {BAR_TABS.filter(({ key }) => !(key === "csv" && isManufacturingOrg)).map(({ key, label, count }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                  active
                    ? "text-foreground border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground",
                )}
              >
                {label}
                {count !== undefined && (
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-px rounded",
                      active
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {/* API keys — disabled until a backend exists (see plan PR 5) */}
          <button
            type="button"
            disabled
            title="Coming soon"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-medium text-muted-foreground border-b-2 border-transparent cursor-not-allowed -mb-px"
          >
            API keys
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded bg-muted text-muted-foreground">
              Soon
            </span>
          </button>
        </div>

        {tab === "sources" && (
          <SourcesGrid
            onOpen={setTab}
            getStatus={getStatus}
            webhookInfo={webhookInfo}
          />
        )}
        {tab === "csv" && (
          <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6">
            <CsvImportTab />
          </div>
        )}
        {tab === "forms" && (
          <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6">
            <GoogleFormsTab />
          </div>
        )}
        {(tab === "facebook" ||
          tab === "google" ||
          tab === "webhook" ||
          tab === "whatsapp" ||
          tab === "email" ||
          tab === "razorpay" ||
          tab === "cashfree") && (
          <div className="space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTab("sources")}
              className="gap-1.5 -ml-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to all sources
            </Button>
            <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6">
              {tab === "facebook" && (
                <MetaAdsTab
                  status={fbStatus?.status}
                  accountName={fbStatus?.accountName}
                  maskedAccountId={fbStatus?.maskedAccountId}
                  adAccountName={fbStatus?.adAccountName}
                  lastSyncedAt={fbStatus?.lastSyncedAt}
                  lastBackfillAt={fbStatus?.lastBackfillAt}
                  lastBackfillLeadsCount={fbStatus?.lastBackfillLeadsCount}
                  backfilling={backfilling}
                  onBackfill={(sinceIso) => void backfillFacebook(sinceIso)}
                  onConnect={() => void connectFacebook()}
                  onDisconnect={() => void disconnect("FACEBOOK")}
                  connecting={facebookConnecting}
                  adAccounts={adAccounts}
                  adAccountsLoading={adAccountsLoading}
                  onLoadAdAccounts={() => void loadAdAccounts()}
                  onPickAdAccount={(id) => void pickAdAccount(id)}
                  syncing={syncing}
                  onRefreshInsights={() => void refreshInsights()}
                />
              )}
              {tab === "google" && (
                <GoogleAdsTab
                  status={googleStatus?.status}
                  accountName={googleStatus?.accountName}
                  maskedAccountId={googleStatus?.maskedAccountId}
                  webhookUrl={googleWebhookInfo?.webhookUrl ?? null}
                  webhookKey={googleWebhookInfo?.webhookKey ?? null}
                  onConnect={() => void connectGoogle()}
                  onDisconnect={() => void disconnect("GOOGLE_ADS")}
                  onRegenerateKey={regenerateGoogleKey}
                  connecting={googleConnecting}
                />
              )}
              {tab === "webhook" && (
                <GenericWebhookTab
                  webhookUrl={webhookInfo?.webhookUrl ?? null}
                  webhookSecret={webhookInfo?.webhookSecret ?? null}
                  onRegenerate={regenerateSecret}
                />
              )}
              {tab === "whatsapp" && (
                <WhatsAppTab
                  status={whatsappStatus?.status}
                  connectMethod={whatsappStatus?.connectMethod}
                  accountName={whatsappStatus?.accountName}
                  maskedAccountId={whatsappStatus?.maskedAccountId}
                  webhookUrl={whatsappWebhookInfo?.webhookUrl ?? null}
                  verifyToken={whatsappWebhookInfo?.verifyToken ?? null}
                  connecting={whatsappConnecting}
                  embeddedSignupConnecting={whatsappEmbeddedSignupConnecting}
                  onConnect={connectWhatsAppAccount}
                  onConnectEmbeddedSignup={connectWhatsAppEmbeddedSignup}
                  onDisconnect={() => void disconnect("WHATSAPP")}
                  onRegenerate={regenerateWhatsAppKey}
                />
              )}
              {tab === "email" && (
                <EmailTab
                  config={emailConfig}
                  connecting={emailConnecting}
                  checking={emailChecking}
                  onConnectSmtp={connectEmailSmtpAccount}
                  onConnectSesDomain={connectEmailSesDomainAccount}
                  onCheckStatus={() => {
                    setEmailChecking(true);
                    void checkEmailStatus().finally(() => setEmailChecking(false));
                  }}
                  onDisconnect={() => void disconnect("EMAIL")}
                />
              )}
              {tab === "cashfree" && (
                <CashfreeTab
                  status={cashfreeStatus?.status}
                  maskedAccountId={cashfreeStatus?.maskedAccountId}
                  connecting={cashfreeConnecting}
                  onConnect={connectCashfreeAccount}
                  onDisconnect={() => void disconnect("CASHFREE")}
                />
              )}
              {tab === "razorpay" && (
                <RazorpayTab
                  status={razorpayStatus?.status}
                  maskedAccountId={razorpayStatus?.maskedAccountId}
                  connecting={razorpayConnecting}
                  webhookInfo={razorpayWebhookInfo}
                  onConnect={connectRazorpayAccount}
                  onDisconnect={() => void disconnect("RAZORPAY")}
                  onRegenerateWebhookSecret={regenerateRazorpayKey}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
