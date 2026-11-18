import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdministrationPage from "../pages/Administration";

let mockRole = "SALES_REP";
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Rep", role: mockRole }, updateUser: vi.fn(), signIn: vi.fn() }),
}));
vi.mock("../hooks/useWorkspace", () => ({ useWorkspace: () => "MANUFACTURING" }));
vi.mock("../components/layout/Header", () => ({ Header: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../hooks/useOrgSettings", () => ({ useOrgSettings: () => ({ loading: true }) }));
vi.mock("../hooks/useFieldMappings", () => ({ useFieldMappings: () => ({ loading: true }) }));
vi.mock("../hooks/useApiKey", () => ({ useApiKey: () => ({}) }));
vi.mock("../hooks/useImportMappings", () => ({ useImportMappings: () => ({ mappings: [] }) }));
vi.mock("../hooks/useTeams", () => ({ useTeams: () => ({ teams: [] }) }));
vi.mock("../hooks/useIntegrations", () => ({ useIntegrations: () => ({}) }));
vi.mock("../hooks/useTemplates", () => ({ useTemplates: () => ({ templates: [] }) }));

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdministrationPage />
    </MemoryRouter>,
  );

describe("Administration access", () => {
  it("shows the no-access page to a Sales Rep and never loads settings", () => {
    mockRole = "SALES_REP";
    renderPage();
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByText("Organization settings & configuration")).toBeNull();
  });

  it.each(["DIRECTOR", "MANAGER"])("lets a %s open the page", (role) => {
    mockRole = role;
    renderPage();
    expect(screen.queryByText("You don't have access to this page")).toBeNull();
    expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
  });

  it("lists Audit log in the Manufacturing group of the section menu", () => {
    mockRole = "DIRECTOR";
    renderPage();
    const select = screen.getByLabelText("Administration section");
    const group = select.querySelector('optgroup[label="Manufacturing"]');
    expect(group?.textContent).toContain("Audit log");
  });
});
