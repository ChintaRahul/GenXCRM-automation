import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentsTab } from "../components/module/DocumentsTab";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("DocumentsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each document with a download link", async () => {
    vi.mocked(modulesApi.getModuleDocuments).mockResolvedValue([
      { id: "d1", name: "Quote.pdf", type: "pdf", createdAt: "2026-09-28", url: "https://x/quote.pdf" },
    ]);
    render(<DocumentsTab moduleKey="quotes" id="Q-1" />);
    await waitFor(() => expect(screen.getByText("Quote.pdf")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("href", "https://x/quote.pdf");
  });

  it("shows an empty state when there are no documents", async () => {
    vi.mocked(modulesApi.getModuleDocuments).mockResolvedValue([]);
    render(<DocumentsTab moduleKey="quotes" id="Q-1" />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeInTheDocument());
  });

  it("shows a loading state before the fetch resolves", () => {
    vi.mocked(modulesApi.getModuleDocuments).mockReturnValue(new Promise(() => {}));
    render(<DocumentsTab moduleKey="quotes" id="Q-1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
