import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModuleBoard } from "../components/module/ModuleBoard";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function dataTransfer(id: string) {
  const store: Record<string, string> = { "text/plain": id };
  return {
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? "",
  } as unknown as DataTransfer;
}

describe("ModuleBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one column per stage with the right record counts", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Qualified", value: 100000, owner: "Jane" }],
      total: 1, page: 1, limit: 1000, pages: 1,
    });
    render(<ModuleBoard moduleKey="opps" onRowClick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OP-1")).toBeInTheDocument());
    expect(screen.getByText("Qualified")).toBeInTheDocument();
  });

  it("dropping a card on a plain stage column PATCHes the status", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Qualified", value: 100000, owner: "Jane" }],
      total: 1, page: 1, limit: 1000, pages: 1,
    });
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "OP-1", stage: "Technical discussion" });
    render(<ModuleBoard moduleKey="opps" onRowClick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OP-1")).toBeInTheDocument());

    const card = screen.getByText("OP-1").closest("[draggable]")!;
    const targetColumn = screen.getByTestId("board-column-Technical discussion");
    fireEvent.dragStart(card, { dataTransfer: dataTransfer("OP-1") });
    fireEvent.drop(targetColumn, { dataTransfer: dataTransfer("OP-1") });

    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("opps", "OP-1", { stage: "Technical discussion" }),
    );
  });

  it("dropping a card on Lost opens the ActionDialog instead of calling the API directly", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Negotiation", value: 100000, owner: "Jane" }],
      total: 1, page: 1, limit: 1000, pages: 1,
    });
    render(<ModuleBoard moduleKey="opps" onRowClick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OP-1")).toBeInTheDocument());

    const card = screen.getByText("OP-1").closest("[draggable]")!;
    const targetColumn = screen.getByTestId("board-column-Lost");
    fireEvent.dragStart(card, { dataTransfer: dataTransfer("OP-1") });
    fireEvent.drop(targetColumn, { dataTransfer: dataTransfer("OP-1") });

    await waitFor(() => expect(screen.getByText("Mark lost")).toBeInTheDocument()); // ActionDialog title
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
    expect(modulesApi.updateModuleRecord).not.toHaveBeenCalled();
  });

  it("confirming the ActionDialog after an ask-required drop performs the action and refreshes the board", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Negotiation", value: 100000, owner: "Jane" }],
      total: 1, page: 1, limit: 1000, pages: 1,
    });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "OP-1", stage: "Lost" });
    render(<ModuleBoard moduleKey="opps" onRowClick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OP-1")).toBeInTheDocument());
    expect(modulesApi.getModuleList).toHaveBeenCalledTimes(1);

    const card = screen.getByText("OP-1").closest("[draggable]")!;
    const targetColumn = screen.getByTestId("board-column-Lost");
    fireEvent.dragStart(card, { dataTransfer: dataTransfer("OP-1") });
    fireEvent.drop(targetColumn, { dataTransfer: dataTransfer("OP-1") });
    await waitFor(() => expect(screen.getByText("Mark lost")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Lost reason/), { target: { value: "Price" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(modulesApi.performModuleAction).toHaveBeenCalledWith("opps", "OP-1", "Mark lost", { lost: "Price" }),
    );
    // The ask-confirmed path must refresh the board the same way the other two
    // success paths do (moveRecord's direct-action and plain-PATCH branches),
    // otherwise the card is left showing stale data in its old column.
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenCalledTimes(2));
  });

  it("on phones shows one stage at a time with stage chips to switch", async () => {
    const prev = window.innerWidth;
    window.innerWidth = 390;
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [
        { id: "OP-1", stage: "Qualified", value: 100000, owner: "Jane" },
        { id: "OP-2", stage: "Technical discussion", value: 50000, owner: "Jane" },
      ],
      total: 2, page: 1, limit: 1000, pages: 1,
    });
    try {
      render(<ModuleBoard moduleKey="opps" onRowClick={vi.fn()} />);
      await screen.findByRole("tablist", { name: /stages/i });
      expect(screen.queryByText("OP-2")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: /technical discussion/i }));
      expect(await screen.findByText("OP-2")).toBeInTheDocument();
      expect(screen.queryByText("OP-1")).not.toBeInTheDocument();
    } finally {
      window.innerWidth = prev;
    }
  });
});
