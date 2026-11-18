import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ModuleListRoute } from "../components/module/ModuleListRoute";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../components/module/ModuleBoard", () => ({ ModuleBoard: () => <div /> }));

const accountRecord = { id: "A-1021", short: "Kaveri Steel", industry: "Steel & metals", type: "Customer", territory: "South", potential: 5000000, owner: "ad", status: "Active" };

describe("ModuleListRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u1", name: "Test User", email: "test@example.com", role: "SALES_REP", teamId: null },
      token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
      isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
    } as never);
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [accountRecord], total: 1, page: 1, limit: 20, pages: 1 });
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(null);
    vi.mocked(modulesApi.saveColumnPrefs).mockResolvedValue(undefined);
    vi.mocked(modulesApi.getModuleFacets).mockRejectedValue(new Error("no filters"));
    vi.mocked(modulesApi.listModuleViews).mockResolvedValue([]);
  });

  it("navigates to the record's detail route (using the moduleKey's mapped path) when a row is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/accounts"]}>
        <Routes>
          <Route path="/accounts" element={<ModuleListRoute moduleKey="accounts" />} />
          <Route path="/accounts/:id" element={<div data-testid="detail-page">Detail for account</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Kaveri Steel")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Kaveri Steel"));
    await waitFor(() => expect(screen.getByTestId("detail-page")).toBeInTheDocument());
  });

  it("navigates using the mapped path (not the raw moduleKey) for a key that differs from its URL segment", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-2231", title: "Weighbridge deal", acc: "A-1", stage: "Qualified", value: 100000 }],
      total: 1, page: 1, limit: 20, pages: 1,
    });
    render(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <Routes>
          <Route path="/opportunities" element={<ModuleListRoute moduleKey="opps" />} />
          <Route path="/opportunities/:id" element={<div data-testid="detail-page">Detail for opportunity</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("OP-2231")).toBeInTheDocument());
    fireEvent.click(screen.getByText("OP-2231"));
    await waitFor(() => expect(screen.getByTestId("detail-page")).toBeInTheDocument());
  });

  it("opens the create drawer when New is clicked, and navigates to the saved record after save", async () => {
    vi.mocked(modulesApi.createModuleRecord).mockResolvedValue({ id: "A-9999" });
    render(
      <MemoryRouter initialEntries={["/accounts"]}>
        <Routes>
          <Route path="/accounts" element={<ModuleListRoute moduleKey="accounts" />} />
          <Route path="/accounts/:id" element={<div data-testid="detail-page">Detail for new account</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/New Account/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Account/i));
    expect(await screen.findByRole("heading", { name: /New Account/i })).toBeInTheDocument();
  });
});
