import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OrganizationTab } from "../components/admin/OrganizationTab";
import { SecurityTab } from "../components/admin/SecurityTab";
import { NotificationsTab } from "../components/admin/NotificationsTab";
import { RolesTab } from "../components/admin/RolesTab";
import { RoutingTab } from "../components/admin/RoutingTab";
import { PaymentsTab } from "../components/admin/PaymentsTab";
import { FieldMappingTab } from "../components/admin/FieldMappingTab";
import { PrivacyTab } from "../components/admin/PrivacyTab";
import { ApiWebhooksTab } from "../components/admin/ApiWebhooksTab";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Rep", email: "rep@co.com", role: "SALES_REP", teamId: null, mfaConfigured: false },
    updateUser: vi.fn(),
  }),
}));

vi.mock("../api/client", () => ({
  getOrgLogoDownloadUrl: vi.fn().mockResolvedValue({ url: null }),
  getOrgLogoUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: "https://s3.example.com/upload" }),
}));

const profile = {
  id: "org-1",
  name: "Acme EdTech",
  slug: "acme",
  industry: "EDTECH" as const,
  workspaceType: "EDTECH" as const,
  size: "SMALL" as const,
  country: "India",
  timezone: "Asia/Kolkata",
  planStatus: "TRIAL" as const,
  trialEndsAt: "2026-10-01",
};

const security = {
  passwordMinLength: 8,
  sessionTimeoutMinutes: 60,
  requireNumber: true,
  requireSymbol: false,
  mfaEnabled: false,
  mfaEnforced: false,
  ssoProvider: "NONE" as const,
  ssoConnected: false,
};

describe("OrganizationTab", () => {
  it("renders the organization profile fields", () => {
    render(<OrganizationTab profile={profile} canEdit={true} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue("Acme EdTech")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });

  it("disables inputs when canEdit is false", () => {
    render(<OrganizationTab profile={profile} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue("Acme EdTech")).toBeDisabled();
    expect(screen.getByLabelText(/gst number/i)).toBeDisabled();
    expect(screen.getByLabelText(/email reps when a lead is assigned/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("defaults the assignment-notification checkbox on when the org has not set it", () => {
    render(<OrganizationTab profile={profile} canEdit={true} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/email reps when a lead is assigned/i)).toBeChecked();
  });

  it("reflects the org opting out of assignment notifications and includes it in the save payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<OrganizationTab profile={{ ...profile, notifyRepOnAssignment: false }} canEdit={true} onSave={onSave} />);

    const checkbox = screen.getByLabelText(/email reps when a lead is assigned/i);
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ notifyRepOnAssignment: true }));
  });

  it("lets a Director edit the GST number and includes it in the save payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<OrganizationTab profile={{ ...profile, gstNumber: null }} canEdit={true} onSave={onSave} />);

    const gstInput = screen.getByLabelText(/gst number/i);
    expect(gstInput).toBeEnabled();
    await user.type(gstInput, "27abcde1234f1z5");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ gstNumber: "27ABCDE1234F1Z5" }));
  });

  it("rejects an invalid GST number without calling onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<OrganizationTab profile={{ ...profile, gstNumber: null }} canEdit={true} onSave={onSave} />);

    await user.type(screen.getByLabelText(/gst number/i), "not-a-gstin");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/enter a valid 15-character gstin/i)).toBeInTheDocument();
  });

  it("lets a Director edit contact email and phone and includes them in the save payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<OrganizationTab profile={profile} canEdit={true} onSave={onSave} />);

    await user.type(screen.getByLabelText(/contact email/i), "hello@acme.edu");
    await user.type(screen.getByLabelText(/contact phone/i), "+91 98765 43210");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ email: "hello@acme.edu", phone: "+91 98765 43210" }),
    );
  });

  it("shows a no-logo placeholder and disables the upload button when canEdit is false", () => {
    render(<OrganizationTab profile={profile} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByText(/no logo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload logo/i })).toBeDisabled();
  });
});

describe("SecurityTab", () => {
  it("renders password policy, MFA, and SSO cards", () => {
    render(
      <MemoryRouter>
        <SecurityTab security={security} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/password policy/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /multi-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByText(/single sign-on/i)).toBeInTheDocument();
  });

  it("disables the enforce-MFA switch when MFA is off", () => {
    render(
      <MemoryRouter>
        <SecurityTab security={security} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    const enforceSwitch = screen.getByRole("switch", { name: /enforce mfa for all users/i });
    expect(enforceSwitch).toBeDisabled();
  });

  it("renders the caller's own two-factor authentication status", () => {
    render(
      <MemoryRouter>
        <SecurityTab security={security} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^your account$/i)).toBeInTheDocument();
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
  });

  it("opens the session timeout in the largest unit that shows a whole number", () => {
    render(
      <MemoryRouter>
        <SecurityTab security={security} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    // security.sessionTimeoutMinutes is 60 -> 1 hour, not 0.04 days.
    expect(screen.getByLabelText(/session timeout/i)).toHaveValue(1);
  });

  it("rejects a session timeout below the 5-minute floor (entered in Days) without calling onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <MemoryRouter>
        <SecurityTab security={{ ...security, sessionTimeoutMinutes: 1440 }} canEdit={true} onSave={onSave} />
      </MemoryRouter>,
    );
    const input = screen.getByLabelText(/session timeout/i);
    await user.clear(input);
    await user.type(input, "0.001"); // 0.001 day ≈ 1.4 minutes, rounds below the 5-minute floor
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects a session timeout above the 7-day ceiling (entered in Days) without calling onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <MemoryRouter>
        <SecurityTab security={{ ...security, sessionTimeoutMinutes: 1440 }} canEdit={true} onSave={onSave} />
      </MemoryRouter>,
    );
    const input = screen.getByLabelText(/session timeout/i);
    await user.clear(input);
    await user.type(input, "8"); // 8 days > 7-day ceiling
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("accepts a session timeout within range (entered in Days) and converts it to minutes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <SecurityTab security={{ ...security, sessionTimeoutMinutes: 1440 }} canEdit={true} onSave={onSave} />
      </MemoryRouter>,
    );
    const input = screen.getByLabelText(/session timeout/i);
    await user.clear(input);
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sessionTimeoutMinutes: 3 * 1440 }));
  });

  it("renders the minimum-length and session-timeout inputs at a fixed width, not full width", () => {
    render(
      <MemoryRouter>
        <SecurityTab security={security} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    const minLength = screen.getByLabelText(/minimum length/i);
    const timeout = screen.getByLabelText(/session timeout/i);
    expect(minLength.className).not.toMatch(/w-full/);
    expect(minLength.className).toMatch(/w-20/);
    expect(timeout.className).not.toMatch(/w-full|flex-1/);
    expect(timeout.className).toMatch(/w-20/);
  });

  it("marks Single sign-on as coming soon and disables its controls", () => {
    render(
      <MemoryRouter>
        <SecurityTab security={security} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /connect/i })).toBeDisabled();
  });
});

const notifications = {
  newLeadAssigned: { email: true, inApp: true },
  dailyDigest: { email: true, inApp: false },
  paymentReceived: { email: true, inApp: true },
  leadIngestionFailures: { email: true, inApp: false },
  trialEndingReminders: { email: true, inApp: false },
  weeklyPerformanceSummary: { email: false, inApp: false },
  followUpReminders: { enabled: false, sendHour: 9, reps: true, managers: true, overdue: true, today: true, email: true, inApp: true, skipSundays: true },
};

describe("NotificationsTab", () => {
  it("renders all notification rows with email/in-app switches (lead import failures is email-only)", () => {
    render(<NotificationsTab notifications={notifications} canEdit={true} onSave={vi.fn()} />);
    expect(screen.getByText(/new lead assigned/i)).toBeInTheDocument();
    expect(screen.getByText(/weekly performance summary/i)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(11);
  });
});

describe("RolesTab", () => {
  it("renders the 3-role permission matrix", () => {
    render(<MemoryRouter><RolesTab /></MemoryRouter>);
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("Sales Rep")).toBeInTheDocument();
    expect(screen.getByText(/view leads/i)).toBeInTheDocument();
  });
});

const routing = {
  autoAssign: true,
  skipWeekends: false,
  alwaysOn: false,
  workingHoursStart: "09:00",
  workingHoursEnd: "18:00",
  sourceRouting: { facebookInstagram: "", googleAds: "", website: "", referral: "", walkIn: "" },
};

const teams = [{ id: "t1", name: "Inbound Sales", type: "MEMBER" as const, managerId: null, manager: null, members: [], orgId: "org-1", createdAt: "2026-01-01" }];

describe("RoutingTab", () => {
  it("renders assignment engine and source routing rows", () => {
    render(<RoutingTab routing={routing} teams={teams} canEdit={true} onSave={vi.fn()} />);
    expect(screen.getByText(/auto-assign new leads/i)).toBeInTheDocument();
    expect(screen.getByText(/facebook \/ instagram/i)).toBeInTheDocument();
  });
});

const payments = { emiReminderTemplateId: null, emiReminderEmailTemplateId: null };

const approvedWaTemplate = {
  id: "tpl-1",
  channel: "WHATSAPP" as const,
  name: "EMI Installment Reminder",
  body: "Hi {{name}}...",
  isSystem: false,
  status: "APPROVED" as const,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("PaymentsTab", () => {
  it("points to the Templates page instead of a template picker when no WhatsApp template is approved yet", () => {
    render(
      <MemoryRouter>
        <PaymentsTab payments={payments} templates={[]} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no approved whatsapp templates yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /templates/i })).toHaveAttribute("href", "/templates");
  });

  it("shows the template picker instead of the empty state once at least one WhatsApp template is approved", () => {
    render(
      <MemoryRouter>
        <PaymentsTab
          payments={payments}
          templates={[
            approvedWaTemplate,
            { ...approvedWaTemplate, id: "tpl-2", name: "Draft Reminder", status: "DRAFT" as const },
            { ...approvedWaTemplate, id: "tpl-3", name: "Email Reminder", channel: "EMAIL" as const, status: null },
          ]}
          canEdit={true}
          onSave={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("combobox", { name: /whatsapp installment reminder template/i })).toBeInTheDocument();
    expect(screen.queryByText(/no approved whatsapp templates yet/i)).not.toBeInTheDocument();
  });

  it("offers EMAIL templates in a separate email picker and keeps WhatsApp on approved templates only", () => {
    render(
      <MemoryRouter>
        <PaymentsTab
          payments={payments}
          templates={[
            approvedWaTemplate,
            { ...approvedWaTemplate, id: "tpl-3", name: "Email Reminder", channel: "EMAIL" as const, status: null },
          ]}
          canEdit={true}
          onSave={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("combobox", { name: /email installment reminder template/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /whatsapp installment reminder template/i })).toBeInTheDocument();
    expect(screen.queryByText(/no email templates yet/i)).not.toBeInTheDocument();
  });

  it("shows an empty state for the email picker when there are no email templates", () => {
    render(
      <MemoryRouter>
        <PaymentsTab payments={payments} templates={[approvedWaTemplate]} canEdit={true} onSave={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no email templates yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /email installment reminder template/i })).not.toBeInTheDocument();
  });

  it("stays on the empty state when WhatsApp templates exist but none are approved yet", () => {
    render(
      <MemoryRouter>
        <PaymentsTab
          payments={payments}
          templates={[{ ...approvedWaTemplate, status: "PENDING" as const }]}
          canEdit={true}
          onSave={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no approved whatsapp templates yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /whatsapp installment reminder template/i })).not.toBeInTheDocument();
  });
});

const mapping = { coreFieldAliases: { name: "", email: "", phone: "", altPhone: "", course: "", location: "", language: "", source: "", tags: "" }, customFieldDefs: [], detectedFields: [] };

describe("FieldMappingTab", () => {
  it("renders the 9 fixed field rows and an add-custom-field button", () => {
    render(
      <FieldMappingTab
        mapping={mapping}
        canEdit={true}
        onSave={vi.fn()}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    expect(screen.getByText(/lead column mapping/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add custom field/i })).toBeInTheDocument();
  });

  it("does not show the suggestions panel when there are no detected fields", () => {
    render(
      <FieldMappingTab
        mapping={mapping}
        canEdit={true}
        onSave={vi.fn()}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    expect(screen.queryByText(/fields seen on your connected lead forms/i)).not.toBeInTheDocument();
  });

  it("clicking a suggested field appends it to the focused aliases input", async () => {
    const user = userEvent.setup();
    render(
      <FieldMappingTab
        mapping={{ ...mapping, detectedFields: ["Preferred Batch"] }}
        canEdit={true}
        onSave={vi.fn()}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    const nameAliasInput = screen.getAllByPlaceholderText(/comma-separated header aliases/i)[0];
    await user.click(nameAliasInput);
    await user.click(screen.getByRole("button", { name: "Preferred Batch" }));
    expect(nameAliasInput).toHaveValue("Preferred Batch");
  });

  it("does not suggest a field that is already used as an alias", () => {
    render(
      <FieldMappingTab
        mapping={{ ...mapping, coreFieldAliases: { ...mapping.coreFieldAliases, course: "Preferred Batch" }, detectedFields: ["Preferred Batch"] }}
        canEdit={true}
        onSave={vi.fn()}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Preferred Batch" })).not.toBeInTheDocument();
  });

  it("moves a field down with the arrow buttons and saves the new order", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <FieldMappingTab
        mapping={{ ...mapping, customFieldDefs: [{ id: "a", name: "Alpha", aliases: "" }], fieldOrder: ["a", "course"] }}
        canEdit={true}
        onSave={onSave}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Move Alpha down" }));
    await user.click(screen.getByRole("button", { name: /save mapping/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fieldOrder: ["course", "a"] }));
  });

  it("keeps name, phone and email fixed (no move arrows)", () => {
    render(
      <FieldMappingTab
        mapping={mapping}
        canEdit={true}
        onSave={vi.fn()}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /move name/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /move phone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /move email/i })).not.toBeInTheDocument();
  });

  it("runs backfill with the chosen sources and fields", async () => {
    const user = userEvent.setup();
    const onBackfill = vi.fn().mockResolvedValue({ scanned: 5, updated: 2, skipped: 3 });
    render(
      <FieldMappingTab
        mapping={mapping}
        canEdit={true}
        onSave={vi.fn()}
        onBackfill={onBackfill}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /backfill leads/i }));
    await user.click(screen.getByRole("checkbox", { name: "Google Ads" }));
    await user.click(screen.getByRole("checkbox", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: /run backfill/i }));
    const payload = onBackfill.mock.calls[0][0];
    expect(payload.sources).not.toContain("GOOGLE_ADS");
    expect(payload.sources).toContain("FACEBOOK");
    expect(payload.fields).not.toContain("tags");
    expect(payload.fields).toContain("course");
  });

  it("hides the backfill button for read-only users", () => {
    render(
      <FieldMappingTab
        mapping={mapping}
        canEdit={false}
        onSave={vi.fn()}
        onBackfill={vi.fn()}
        templates={[]}
        onSaveTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /backfill leads/i })).not.toBeInTheDocument();
  });
});

describe("PrivacyTab", () => {
  it("renders export, erasure, and audit log cards", () => {
    render(
      <PrivacyTab
        canEdit={true}
        auditLog={{ items: [], total: 0, page: 1, pageSize: 20 }}
        auditLoading={false}
        auditPage={1}
        onAuditPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /data export/i })).toBeInTheDocument();
    expect(screen.getByText(/right to erasure/i)).toBeInTheDocument();
    expect(screen.getByText(/audit log/i)).toBeInTheDocument();
  });

  it("marks data export and right-to-erasure as coming soon", () => {
    render(
      <PrivacyTab
        canEdit={true}
        auditLog={{ items: [], total: 0, page: 1, pageSize: 20 }}
        auditLoading={false}
        auditPage={1}
        onAuditPageChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  });
});

describe("ApiWebhooksTab", () => {
  it("renders the masked API key and webhook list", () => {
    render(
      <ApiWebhooksTab
        apiKey="gxc_live_abcdefghijklmnop3b4c"
        regenerating={false}
        onRegenerate={vi.fn()}
        canEdit={true}
        facebookWebhookUrl="https://app.example/api/v1/integrations/facebook/webhook"
        googleWebhookUrl={null}
        genericWebhookUrl={null}
      />,
    );
    expect(screen.getByText(/api key/i)).toBeInTheDocument();
    expect(screen.getByText(/inbound webhooks/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
  });

  it("tells a non-Director the key is Director-only instead of hanging on Loading", () => {
    render(
      <ApiWebhooksTab
        apiKey={null}
        regenerating={false}
        onRegenerate={vi.fn()}
        canEdit={false}
        facebookWebhookUrl="https://app.example/api/v1/integrations/facebook/webhook"
        googleWebhookUrl={null}
        genericWebhookUrl={null}
      />,
    );
    expect(screen.getByText("Only Directors can view the API key.")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("derives each marketplace URL from the org's generic webhook URL", () => {
    render(
      <ApiWebhooksTab
        apiKey={null}
        regenerating={false}
        onRegenerate={vi.fn()}
        canEdit={true}
        facebookWebhookUrl="https://app.example/api/v1/integrations/facebook/webhook"
        googleWebhookUrl={null}
        genericWebhookUrl="https://app.example/api/v1/integrations/webhook/tok123/ingest"
      />,
    );
    expect(screen.getByText("https://app.example/api/v1/integrations/hubs/tok123/indiamart")).toBeInTheDocument();
    expect(screen.getByText("https://app.example/api/v1/integrations/hubs/tok123/tradeindia")).toBeInTheDocument();
  });

  it("saves the TradeIndia API Link and shows the sync is not on yet", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ApiWebhooksTab
        apiKey={null}
        regenerating={false}
        onRegenerate={vi.fn()}
        canEdit={true}
        facebookWebhookUrl="https://app.example/api/v1/integrations/facebook/webhook"
        googleWebhookUrl={null}
        genericWebhookUrl={null}
        tradeIndiaStatus="PENDING"
        onSaveTradeIndiaLink={onSave}
      />,
    );
    expect(screen.getByText(/not imported automatically yet/i)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/tradeindia\.com/i), " https://www.tradeindia.com/api?key=k ");
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith("https://www.tradeindia.com/api?key=k");
  });
});
