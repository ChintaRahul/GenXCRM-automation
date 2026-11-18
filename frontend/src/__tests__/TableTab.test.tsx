import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TableTab } from "../components/module/TableTab";
import * as modulesApi from "../api/modules";
import { REGISTRY } from "../modules/registry";

vi.mock("../api/modules");

describe("TableTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state, then the table", async () => {
    vi.mocked(modulesApi.getModuleTable).mockResolvedValue({
      columns: [{ key: "name", label: "Plant", type: "text" }],
      rows: [{ name: "Plant 1" }],
    });
    render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" />);
    await waitFor(() => expect(screen.getByText("Plant 1")).toBeInTheDocument());
    expect(screen.getByText("Plant")).toBeInTheDocument();
  });

  it("shows an error message on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleTable).mockRejectedValue(new Error("boom"));
    render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("shows an empty state when there are no rows", async () => {
    vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns: [], rows: [] });
    render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" />);
    await waitFor(() => expect(screen.getByText(/no data/i)).toBeInTheDocument());
  });

  it("renders a totals row when totals are present, and skips it otherwise", async () => {
    vi.mocked(modulesApi.getModuleTable).mockResolvedValue({
      columns: [{ key: "amount", label: "Amount", type: "money" }],
      rows: [{ amount: 100000 }],
      totals: { amount: 100000 },
    });
    render(<TableTab moduleKey="costing" id="C-1" tabKey="breakdown" />);
    await waitFor(() => expect(screen.getAllByText("₹1.0 L").length).toBe(2)); // one row, one totals cell
  });

  describe("editable rows (account plants)", () => {
    const plantsTab = REGISTRY.accounts.tabs.find((t) => t.key === "plants")!;
    const columns = [{ key: "name", label: "Plant", type: "text" as const }];

    it("adds a plant and shows the refreshed table", async () => {
      vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns, rows: [] });
      vi.mocked(modulesApi.addModuleTableRow).mockResolvedValue({ columns, rows: [{ id: "p-1", name: "Plant 2" }] });
      render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" tab={plantsTab} />);
      fireEvent.click(await screen.findByRole("button", { name: /add plant/i }));
      fireEvent.change(screen.getByLabelText(/plant name/i), { target: { value: "Plant 2" } });
      fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "Warehouse" } });
      fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "Nashik" } });
      fireEvent.click(screen.getByRole("button", { name: /^add plant$/i }));
      await waitFor(() => expect(screen.getByText("Plant 2")).toBeInTheDocument());
      expect(modulesApi.addModuleTableRow).toHaveBeenCalledWith("accounts", "A-1", "plants", { name: "Plant 2", type: "Warehouse", city: "Nashik" });
    });

    it("blocks an incomplete plant without calling the server", async () => {
      vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns, rows: [] });
      render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" tab={plantsTab} />);
      fireEvent.click(await screen.findByRole("button", { name: /add plant/i }));
      fireEvent.click(screen.getByRole("button", { name: /^add plant$/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/required/i);
      expect(modulesApi.addModuleTableRow).not.toHaveBeenCalled();
    });

    it("removes a plant row", async () => {
      vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns, rows: [{ id: "p-1", name: "Plant 1" }] });
      vi.mocked(modulesApi.removeModuleTableRow).mockResolvedValue({ columns, rows: [] });
      render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" tab={plantsTab} />);
      fireEvent.click(await screen.findByRole("button", { name: /remove plant plant 1/i }));
      await waitFor(() => expect(screen.getByText(/no data yet/i)).toBeInTheDocument());
      expect(modulesApi.removeModuleTableRow).toHaveBeenCalledWith("accounts", "A-1", "plants", "p-1");
    });

    it("has no add button on a read-only table", async () => {
      vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns, rows: [] });
      render(<TableTab moduleKey="accounts" id="A-1" tabKey="plants" />);
      await screen.findByText(/no data yet/i);
      expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
    });
  });
});
