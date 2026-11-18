import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinesTab } from "../components/module/LinesTab";
import * as modulesApi from "../api/modules";
import type { ModuleTab } from "../modules/registry";

vi.mock("../api/modules");

const TAB: ModuleTab = {
  key: "lines",
  label: "Lines",
  kind: "lines",
  lineColumns: [
    { key: "item", label: "Item", type: "text" },
    { key: "amount", label: "Amount", type: "money" },
  ],
} as const;

describe("LinesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a placeholder message when the tab has no lineColumns", () => {
    render(<LinesTab moduleKey="quotes" id="Q-1" tab={{ key: "lines", label: "Lines", kind: "lines" }} initialRows={[]} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it("renders a row per initial line and totals the money columns", () => {
    render(<LinesTab moduleKey="quotes" id="Q-1" tab={TAB} initialRows={[{ item: "Widget", amount: 100 }]} />);
    expect(screen.getByDisplayValue("Widget")).toBeInTheDocument();
    expect(screen.getByText("₹100")).toBeInTheDocument(); // totals row
  });

  it("Add row appends an empty row", () => {
    render(<LinesTab moduleKey="quotes" id="Q-1" tab={TAB} initialRows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("Save calls updateModuleRecord with the current rows", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "Q-1" });
    render(<LinesTab moduleKey="quotes" id="Q-1" tab={TAB} initialRows={[{ item: "Widget", amount: 100 }]} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("quotes", "Q-1", {
        lines: [{ item: "Widget", amount: 100 }],
      }),
    );
  });
});
