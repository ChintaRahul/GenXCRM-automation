import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ImportWizardModal } from "../components/leads/ImportWizardModal";
import { LeadStatsProvider } from "../context/LeadStatsContext";
import * as client from "../api/client";
import * as mappingsHook from "../hooks/useImportMappings";

vi.mock("../api/client");
vi.mock("../hooks/useImportMappings");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function renderWizard() {
  return render(
    <MemoryRouter>
      <LeadStatsProvider>
        <ImportWizardModal open onClose={vi.fn()} />
      </LeadStatsProvider>
    </MemoryRouter>,
  );
}

function uploadCsv(csv: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([csv], "leads.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportWizardModal — org field mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getStageStats).mockResolvedValue([]);
    vi.mocked(mappingsHook.useImportMappings).mockReturnValue({
      mappings: [],
      loading: false,
      error: null,
      createMapping: vi.fn(),
      updateMapping: vi.fn(),
      deleteMapping: vi.fn(),
      refetch: vi.fn(),
    });
  });

  it("adds a mapping row for an org-configured custom field and auto-detects it from a matching CSV header", async () => {
    vi.mocked(client.getFieldMappings).mockResolvedValue({
      coreFieldAliases: {},
      customFieldDefs: [
        { id: "cf-1", name: "Organization Type", aliases: "what_type_of_organization_do_you_run?" },
      ],
      detectedFields: [],
    });
    renderWizard();
    await waitFor(() => expect(client.getFieldMappings).toHaveBeenCalled());

    uploadCsv(
      "name,phone,what_type_of_organization_do_you_run?\nJane Doe,9876543210,EdTech\n",
    );

    await waitFor(() => expect(screen.getByText("Organization Type")).toBeInTheDocument());
    // Auto-detected: the matching CSV header appears selected inside that row.
    expect(screen.getByText("what_type_of_organization_do_you_run?")).toBeInTheDocument();
  });

  it("sends the org-configured custom field value keyed by its stable id on import", async () => {
    vi.mocked(client.getFieldMappings).mockResolvedValue({
      coreFieldAliases: {},
      customFieldDefs: [
        { id: "cf-1", name: "Organization Type", aliases: "what_type_of_organization_do_you_run?" },
      ],
      detectedFields: [],
    });
    vi.mocked(client.importLeads).mockResolvedValue({
      total: 1,
      imported: 1,
      skipped: 0,
      errors: [],
      warnings: [],
    });
    renderWizard();
    await waitFor(() => expect(client.getFieldMappings).toHaveBeenCalled());

    uploadCsv(
      "name,phone,what_type_of_organization_do_you_run?\nJane Doe,9876543210,EdTech\n",
    );
    await waitFor(() => expect(screen.getByText("Organization Type")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /import 1 leads/i }));

    await waitFor(() =>
      expect(client.importLeads).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "Jane Doe",
          phone: "9876543210",
          customFields: { "cf-1": "EdTech" },
        }),
      ]),
    );
  });

  it("merges an org-configured core field alias into auto-detection for Location", async () => {
    vi.mocked(client.getFieldMappings).mockResolvedValue({
      coreFieldAliases: { location: "which_city_are_you_in" },
      customFieldDefs: [],
      detectedFields: [],
    });
    vi.mocked(client.importLeads).mockResolvedValue({
      total: 1,
      imported: 1,
      skipped: 0,
      errors: [],
      warnings: [],
    });
    renderWizard();
    await waitFor(() => expect(client.getFieldMappings).toHaveBeenCalled());

    uploadCsv("name,phone,which_city_are_you_in\nJane Doe,9876543210,Pune\n");
    await waitFor(() => expect(screen.getByText("City / Location")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /import 1 leads/i }));

    await waitFor(() =>
      expect(client.importLeads).toHaveBeenCalledWith([
        expect.objectContaining({ location: "Pune" }),
      ]),
    );
  });
});
