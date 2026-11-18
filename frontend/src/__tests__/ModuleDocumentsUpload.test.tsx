import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentsTab } from "../components/module/DocumentsTab";
import { useModuleDocuments } from "../hooks/useModuleDocuments";
import * as modulesApi from "../api/modules";
import * as uploadLib from "../lib/upload";

vi.mock("../api/modules");
vi.mock("../lib/upload");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const pdf = (name = "spec.pdf", size = 1000) => {
  const file = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("module document upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modulesApi.getModuleDocuments).mockResolvedValue([]);
  });

  it("runs init, S3 PUT and complete in order, then refetches the list", async () => {
    vi.mocked(modulesApi.initModuleDocument).mockResolvedValue({ documentId: "d1", uploadUrl: "https://s3/put" });
    const { result } = renderHook(() => useModuleDocuments("rfqs", "R-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const file = pdf();
    await act(() => result.current.upload(file));
    expect(modulesApi.initModuleDocument).toHaveBeenCalledWith("rfqs", "R-1", { fileName: "spec.pdf", mimeType: "application/pdf", fileSize: 1000 });
    expect(uploadLib.uploadToS3).toHaveBeenCalledWith("https://s3/put", file);
    expect(modulesApi.completeModuleDocument).toHaveBeenCalledWith("rfqs", "R-1", "d1");
    await waitFor(() => expect(modulesApi.getModuleDocuments).toHaveBeenCalledTimes(2));
  });

  it("rejects an oversized or unsupported file before calling the API", async () => {
    const { result } = renderHook(() => useModuleDocuments("rfqs", "R-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.upload(pdf("big.pdf", 21 * 1024 * 1024)));
    await act(() => result.current.upload(new File(["x"], "run.exe", { type: "application/x-msdownload" })));
    expect(modulesApi.initModuleDocument).not.toHaveBeenCalled();
  });

  it("does not mark the upload complete when the S3 PUT fails", async () => {
    vi.mocked(modulesApi.initModuleDocument).mockResolvedValue({ documentId: "d1", uploadUrl: "https://s3/put" });
    vi.mocked(uploadLib.uploadToS3).mockRejectedValue(new Error("s3 down"));
    const { result } = renderHook(() => useModuleDocuments("rfqs", "R-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.upload(pdf()));
    expect(modulesApi.completeModuleDocument).not.toHaveBeenCalled();
  });

  it("removes a document from the list after deleting it", async () => {
    vi.mocked(modulesApi.getModuleDocuments).mockResolvedValue([
      { id: "d1", name: "Quote.pdf", type: "pdf", createdAt: "2026-09-28", url: "https://x/q.pdf" },
    ]);
    render(<DocumentsTab moduleKey="quotes" id="Q-1" />);
    await screen.findByText("Quote.pdf");
    await userEvent.click(screen.getByRole("button", { name: /delete quote\.pdf/i }));
    expect(modulesApi.deleteModuleDocument).toHaveBeenCalledWith("quotes", "Q-1", "d1");
    await waitFor(() => expect(screen.queryByText("Quote.pdf")).toBeNull());
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
  });

  it("keeps the upload control visible when there are no documents", async () => {
    render(<DocumentsTab moduleKey="quotes" id="Q-1" />);
    await screen.findByText(/no documents yet/i);
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });
});
