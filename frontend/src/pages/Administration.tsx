import { apiUrl } from "../lib/apiUrl";
import { useEffect, useState } from "react";
import { AlertTriangle, Moon, Sun } from "lucide-react";
import { Header } from "../components/layout/Header";
import { NoAccessPage } from "../components/shared/NoAccessPage";
import { LoadError } from "../components/shared/LoadError";
import { Skeleton } from "../components/ui/skeleton";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../hooks/useWorkspace";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { useOrgSettings } from "../hooks/useOrgSettings";
import { useFieldMappings } from "../hooks/useFieldMappings";
import { useApiKey } from "../hooks/useApiKey";
import { useImportMappings } from "../hooks/useImportMappings";
import { useTeams } from "../hooks/useTeams";
import { useIntegrations } from "../hooks/useIntegrations";
import { useTemplates } from "../hooks/useTemplates";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { OrganizationTab } from "../components/admin/OrganizationTab";
import { ProfileTab } from "../components/admin/ProfileTab";
import { SecurityTab } from "../components/admin/SecurityTab";
import { NotificationsTab } from "../components/admin/NotificationsTab";
import { FollowUpRemindersTab } from "../components/admin/FollowUpRemindersTab";
import { RoutingTab } from "../components/admin/RoutingTab";
import { PaymentsTab } from "../components/admin/PaymentsTab";
import { FieldMappingTab } from "../components/admin/FieldMappingTab";
import { ApiWebhooksTab } from "../components/admin/ApiWebhooksTab";
import { RolesPermissionsTab } from "../components/admin/RolesPermissionsTab";
import { AuditLogTab } from "../components/admin/AuditLogTab";
import { SlaPoliciesTab } from "../components/admin/SlaPoliciesTab";
import { BusinessCalendarTab } from "../components/admin/BusinessCalendarTab";
import { AdminModuleTab } from "../components/admin/AdminModuleTab";

interface AdminSection {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

interface AdminGroup {
  readonly label: string;
  readonly sections: readonly AdminSection[];
}

const SHARED_GROUPS = [
  {
    label: "Account",
    sections: [
      {
        key: "profile",
        label: "My Profile",
        description: "Your name, photo and password.",
      },
      {
        key: "notifications",
        label: "Notifications",
        description: "Choose how you hear about each event.",
      },
    ],
  },
  {
    label: "Organization",
    sections: [
      {
        key: "organization",
        label: "General",
        description: "Your organization's profile and defaults.",
      },
      {
        key: "security",
        label: "Security",
        description: "Password rules, two-factor authentication and sign-in.",
      },
      {
        key: "followUpReminders",
        label: "Follow-up Reminders",
        description: "Daily digest of each person's follow-ups. Off by default.",
      },
      {
        key: "payments",
        label: "Payments",
        description: "Payment links, reminders and templates.",
      },
    ],
  },
  {
    label: "Leads",
    sections: [
      {
        key: "routing",
        label: "Lead Routing",
        description: "How new leads are assigned to your team.",
      },
      {
        key: "fieldMapping",
        label: "Field Mapping",
        description: "Map incoming lead fields to your CRM fields.",
      },
    ],
  },
  {
    label: "Data",
    sections: [
      {
        key: "apiWebhooks",
        label: "API & Webhooks",
        description: "Keys and URLs for connecting other tools.",
      },
    ],
  },
] as const satisfies readonly AdminGroup[];

// README §3.6 "Administration (Manufacturing) > Manufacturing" group.
const MANUFACTURING_GROUP = {
  label: "Manufacturing",
  sections: [
    {
      key: "slaPolicies",
      label: "SLA Policies",
      description: "Response and resolution targets per module.",
    },
    {
      key: "businessCalendar",
      label: "Business Hours & Holidays",
      description: "When SLA clocks run.",
    },
    {
      key: "approvalRules",
      label: "Approval Rules",
      description: "Who must approve what.",
    },
    {
      key: "automationRules",
      label: "Automation Rules",
      description: "Actions that run automatically on events.",
    },
    {
      key: "masters",
      label: "Masters",
      description: "Reference lists used across modules.",
    },
    {
      key: "rolesPermissions",
      label: "Roles & Permissions",
      description: "What each role can see and do.",
    },
    {
      key: "docTemplates",
      label: "Document Templates",
      description: "Templates for generated documents.",
    },
    {
      key: "erp",
      label: "ERP & Accounting",
      description: "Push customers, items, orders, dispatches and receipts to your ERP.",
    },
    {
      key: "auditLog",
      label: "Audit log",
      description: "Who did what, and when.",
    },
  ],
} as const satisfies AdminGroup;

const ALL_GROUPS = [...SHARED_GROUPS, MANUFACTURING_GROUP] as const;

type TabKey = (typeof ALL_GROUPS)[number]["sections"][number]["key"];

const AdministrationContent = () => {
  const { user } = useAuth();
  const workspaceType = useWorkspace();
  const isManufacturing = workspaceType === "MANUFACTURING";
  const groups: readonly AdminGroup[] = isManufacturing
    ? ALL_GROUPS
    : SHARED_GROUPS;
  const canEdit = user?.role === "DIRECTOR";
  const [tab, setTab] = useState<TabKey>("organization");
  const { theme, setTheme } = useTheme();
  const activeSection = groups
    .flatMap((g) => g.sections)
    .find((sec) => sec.key === tab);

  const orgSettings = useOrgSettings();
  const fieldMappings = useFieldMappings();
  const apiKeyState = useApiKey(user?.role === "DIRECTOR");
  const importMappings = useImportMappings();
  const { teams } = useTeams();
  const integrations = useIntegrations();
  const { templates } = useTemplates();

  useEffect(() => {
    if (tab === "apiWebhooks" && !integrations.googleWebhookInfo) {
      void integrations.loadGoogleWebhookInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const facebookWebhookUrl = apiUrl("/integrations/facebook/webhook");

  const loading = orgSettings.loading || fieldMappings.loading;

  return (
    <>
      <Header
        title="Administration"
        subtitle="Organization settings & configuration"
        actions={
          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="Theme"
              className="flex rounded-lg border border-border bg-sub2 p-0.5"
            >
              {(
                [
                  ["light", Sun, "Light"],
                  ["dark", Moon, "Dark"],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  aria-label={`${label} mode`}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 max-[767px]:min-h-11 max-[767px]:min-w-11 text-xs font-medium transition-colors",
                    theme === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <span
              className={cn(
                "hidden rounded-full px-3 py-1 text-xs font-medium sm:inline-block",
                canEdit
                  ? "bg-primary text-primary-foreground"
                  : "bg-warning-soft text-warning-text",
              )}
            >
              {canEdit ? "Director access" : "Manager · read-only"}
            </span>
          </div>
        }
      />

      <div className="space-y-5 p-4 sm:p-6">
        {!canEdit && (
          <div className="flex items-center gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning-text">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              You're viewing in read-only mode. Only Directors can change these
              settings.
            </span>
          </div>
        )}

        <div className="grid items-start gap-6 min-[900px]:grid-cols-[240px_minmax(0,1fr)]">
          <select
            aria-label="Administration section"
            value={tab}
            onChange={(e) => setTab(e.target.value as TabKey)}
            className="h-11 w-full rounded-lg border border-input-border bg-card px-3 text-sm font-medium text-foreground min-[900px]:hidden"
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.sections.map((sec) => (
                  <option key={sec.key} value={sec.key}>
                    {sec.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <nav
            aria-label="Administration sections"
            className="hidden space-y-4 min-[900px]:sticky min-[900px]:top-4 min-[900px]:block"
          >
            {groups.map((group) => (
              <div key={group.label} className="space-y-0.5">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.sections.map((sec) => (
                  <button
                    key={sec.key}
                    type="button"
                    onClick={() => setTab(sec.key as TabKey)}
                    aria-current={tab === sec.key ? "page" : undefined}
                    className={cn(
                      "flex h-9 w-full items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors",
                      tab === sec.key
                        ? "bg-primary-soft font-semibold text-primary-text"
                        : "text-muted-foreground hover:bg-sub hover:text-foreground",
                    )}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="max-w-[800px] min-w-0 space-y-4">
            {activeSection && (
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {activeSection.label}
                </h2>
                <p className="text-[13px] text-muted-foreground">
                  {activeSection.description}
                </p>
              </div>
            )}

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (orgSettings.error && ORG_SETTINGS_TABS.has(tab)) || (fieldMappings.error && tab === "fieldMapping") ? (
              <LoadError
                message={orgSettings.error ?? fieldMappings.error ?? apiErrorMessage(null, Messages.common.genericError)}
                onRetry={() => {
                  void orgSettings.refetch();
                  void fieldMappings.refetch();
                }}
                className="py-12"
              />
            ) : (
              <>
                {tab === "profile" && <ProfileTab />}
                {tab === "organization" && orgSettings.profile && (
                  <OrganizationTab
                    profile={orgSettings.profile}
                    canEdit={canEdit}
                    onSave={orgSettings.saveProfile}
                  />
                )}
                {tab === "security" && orgSettings.settings && (
                  <SecurityTab
                    security={orgSettings.settings.security}
                    canEdit={canEdit}
                    onSave={orgSettings.saveSecurity}
                  />
                )}
                {tab === "notifications" && orgSettings.settings && (
                  <NotificationsTab
                    notifications={orgSettings.settings.notifications}
                    canEdit={canEdit}
                    onSave={orgSettings.saveNotifications}
                  />
                )}
                {tab === "followUpReminders" && orgSettings.settings && (
                  <FollowUpRemindersTab
                    notifications={orgSettings.settings.notifications}
                    canEdit={canEdit}
                    onSave={orgSettings.saveNotifications}
                  />
                )}
                {tab === "routing" && orgSettings.settings && (
                  <RoutingTab
                    routing={orgSettings.settings.routing}
                    teams={teams}
                    canEdit={canEdit}
                    onSave={orgSettings.saveRouting}
                  />
                )}
                {tab === "payments" && orgSettings.settings && (
                  <PaymentsTab
                    payments={orgSettings.settings.payments}
                    templates={templates}
                    canEdit={canEdit}
                    onSave={orgSettings.savePayments}
                  />
                )}
                {tab === "fieldMapping" && fieldMappings.mapping && (
                  <FieldMappingTab
                    mapping={fieldMappings.mapping}
                    canEdit={canEdit}
                    onSave={fieldMappings.save}
                    onBackfill={fieldMappings.backfill}
                    templates={importMappings.mappings}
                    onSaveTemplate={(name, mappings) =>
                      importMappings
                        .createMapping({ name, mappings })
                        .then(() => undefined)
                    }
                    onDeleteTemplate={importMappings.deleteMapping}
                  />
                )}
                {tab === "apiWebhooks" && (
                  <ApiWebhooksTab
                    apiKey={apiKeyState.apiKey}
                    regenerating={apiKeyState.regenerating}
                    onRegenerate={apiKeyState.regenerate}
                    canEdit={canEdit}
                    facebookWebhookUrl={facebookWebhookUrl}
                    googleWebhookUrl={
                      integrations.googleWebhookInfo?.webhookUrl ?? null
                    }
                    genericWebhookUrl={
                      integrations.webhookInfo?.webhookUrl ?? null
                    }
                    tradeIndiaStatus={integrations.getStatus("TRADEINDIA")?.status}
                    onSaveTradeIndiaLink={integrations.connectTradeIndiaLink}
                  />
                )}
                {tab === "slaPolicies" && <SlaPoliciesTab canEdit={canEdit} />}
                {tab === "businessCalendar" && (
                  <BusinessCalendarTab canEdit={canEdit} />
                )}
                {tab === "approvalRules" && (
                  <AdminModuleTab moduleKey="approvalRules" canEdit={canEdit} />
                )}
                {tab === "automationRules" && (
                  <AdminModuleTab
                    moduleKey="automationRules"
                    canEdit={canEdit}
                  />
                )}
                {tab === "masters" && (
                  <AdminModuleTab moduleKey="masters" canEdit={canEdit} />
                )}
                {tab === "rolesPermissions" && (
                  <RolesPermissionsTab canEdit={canEdit} />
                )}
                {tab === "docTemplates" && (
                  <AdminModuleTab moduleKey="docTemplates" canEdit={canEdit} />
                )}
                {tab === "erp" && <AdminModuleTab moduleKey="erp" canEdit={canEdit} />}
                {tab === "auditLog" && <AuditLogTab />}
              </>
            )}

          </div>
        </div>
      </div>
    </>
  );
};

// Reps and other non-admin roles never get this page's data (every call behind it is 403),
// so show the standard no-access page instead of a half-empty read-only view.
// Tabs whose content comes from the organization settings request.
const ORG_SETTINGS_TABS = new Set(["organization", "security", "payments", "routing", "notifications", "followUpReminders"]);

export default function AdministrationPage() {
  const { user } = useAuth();
  if (user && user.role !== "DIRECTOR" && user.role !== "MANAGER") return <NoAccessPage />;
  return <AdministrationContent />;
}
