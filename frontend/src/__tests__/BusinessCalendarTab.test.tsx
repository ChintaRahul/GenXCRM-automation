import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { BusinessCalendarTab } from "../components/admin/BusinessCalendarTab";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../components/module/ModuleBoard", () => ({ ModuleBoard: () => <div /> }));
// The holidays list underneath (AdminModuleTab -> ModuleListPage) is covered by
// ModuleListPage's own tests — stub it here so these tests exercise only the
// business-hours editor itself, without its async fetch/debounce noise.
vi.mock("../components/admin/AdminModuleTab", () => ({
  AdminModuleTab: ({ moduleKey }: { moduleKey: string }) => <div data-testid={`admin-module-tab-${moduleKey}`} />,
}));

const calendarRecord = {
  id: "cal-1",
  timezone: "Asia/Kolkata",
  days: [
    { day: "Mon", isOpen: true, from: "09:00", to: "18:00" },
    { day: "Tue", isOpen: true, from: "09:00", to: "18:00" },
    { day: "Wed", isOpen: true, from: "09:00", to: "18:00" },
    { day: "Thu", isOpen: true, from: "09:00", to: "18:00" },
    { day: "Fri", isOpen: true, from: "09:00", to: "18:00" },
    { day: "Sat", isOpen: true, from: "09:00", to: "13:00" },
    { day: "Sun", isOpen: false, from: "09:00", to: "18:00" },
  ],
};

describe("BusinessCalendarTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u1", name: "Test User", email: "test@example.com", role: "DIRECTOR", teamId: null },
      token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
      isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
    });
    vi.mocked(modulesApi.getModuleList).mockImplementation(async (moduleKey) => {
      if (moduleKey === "businessCalendar") return { data: [calendarRecord], total: 1, page: 1, limit: 1, pages: 1 };
      if (moduleKey === "holidays") return { data: [], total: 0, page: 1, limit: 20, pages: 1 };
      throw new Error(`unexpected moduleKey ${moduleKey}`);
    });
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(null);
    vi.mocked(modulesApi.saveColumnPrefs).mockResolvedValue(undefined);
    vi.mocked(modulesApi.getModuleFacets).mockRejectedValue(new Error("no filters"));
    vi.mocked(modulesApi.listModuleViews).mockResolvedValue([]);
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "cal-1" });
  });

  it("renders all 7 days with their configured open/closed state and hours", async () => {
    render(
      <MemoryRouter>
        <BusinessCalendarTab canEdit={true} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Business hours (Asia/Kolkata)")).toBeInTheDocument());
    // The day rows fill in one render after the card appears.
    await waitFor(() => expect(screen.getAllByLabelText("Open")).toHaveLength(7));
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Sun")).toBeInTheDocument();
    const openCheckboxes = screen.getAllByLabelText("Open") as HTMLInputElement[];
    expect(openCheckboxes[6].checked).toBe(false); // Sunday
  });

  it("saves the edited hours", async () => {
    render(
      <MemoryRouter>
        <BusinessCalendarTab canEdit={true} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Save business hours")).toBeInTheDocument());
    // The saved hours load after the form renders; editing before they land would be overwritten.
    await waitFor(() => expect(screen.getByLabelText("Mon opens at")).not.toHaveValue(""));
    fireEvent.change(screen.getByLabelText("Mon opens at"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByText("Save business hours"));
    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith(
        "businessCalendar",
        "cal-1",
        { days: expect.arrayContaining([expect.objectContaining({ day: "Mon", from: "08:00" })]) },
      ),
    );
  });

  it("hides the Save button and disables inputs when canEdit is false", async () => {
    const { container } = render(
      <MemoryRouter>
        <BusinessCalendarTab canEdit={false} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Business hours (Asia/Kolkata)")).toBeInTheDocument());
    expect(screen.queryByText("Save business hours")).not.toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(7));
    for (const el of Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      expect(el).toBeDisabled();
    }
  });

  it("renders the Holidays list below the hours editor", async () => {
    render(
      <MemoryRouter>
        <BusinessCalendarTab canEdit={true} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("admin-module-tab-holidays")).toBeInTheDocument();
  });
});
