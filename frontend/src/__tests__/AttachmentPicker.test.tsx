import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AttachmentPicker } from "../components/AttachmentPicker";
import { useAttachments } from "../hooks/useAttachments";
import * as client from "../api/client";
import { toast } from "sonner";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function Harness() {
  const attachments = useAttachments();
  return (
    <AttachmentPicker
      attachments={attachments.attachments}
      uploading={attachments.uploading}
      onAddFiles={(files) => void attachments.addFiles(files)}
      onRemove={attachments.remove}
    />
  );
}

function selectFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("AttachmentPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("uploads an allowed file and renders it as a chip", async () => {
    vi.mocked(client.initAttachment).mockResolvedValue({
      attachmentId: "att-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeAttachment).mockResolvedValue(undefined);

    render(<Harness />);
    const file = new File(["pdf-bytes"], "brochure.pdf", { type: "application/pdf" });
    selectFiles([file]);

    await waitFor(() => expect(client.initAttachment).toHaveBeenCalledWith({
      fileName: "brochure.pdf",
      mimeType: "application/pdf",
      fileSize: file.size,
    }));
    await waitFor(() => expect(client.completeAttachment).toHaveBeenCalledWith("att-1"));
    await waitFor(() => expect(screen.getByText("brochure.pdf")).toBeInTheDocument());
  });

  it("rejects a disallowed file type without calling the API", async () => {
    render(<Harness />);
    const file = new File(["exe-bytes"], "installer.exe", {
      type: "application/x-msdownload",
    });
    selectFiles([file]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("installer.exe isn't a supported file type."));
    expect(client.initAttachment).not.toHaveBeenCalled();
  });

  it("rejects a file over 20MB without calling the API", async () => {
    render(<Harness />);
    const bigFile = new File([new Uint8Array(1)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 21 * 1024 * 1024 });
    selectFiles([bigFile]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("big.pdf is larger than 20MB."));
    expect(client.initAttachment).not.toHaveBeenCalled();
  });

  it("rejects selecting more than 5 files at once", async () => {
    render(<Harness />);
    const files = Array.from({ length: 6 }, (_, i) => new File(["x"], `f${i}.pdf`, { type: "application/pdf" }));
    selectFiles(files);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can attach up to 5 files."));
    expect(client.initAttachment).not.toHaveBeenCalled();
  });

  it("removes an attached file via its remove button", async () => {
    vi.mocked(client.initAttachment).mockResolvedValue({
      attachmentId: "att-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeAttachment).mockResolvedValue(undefined);

    render(<Harness />);
    const file = new File(["pdf-bytes"], "brochure.pdf", { type: "application/pdf" });
    selectFiles([file]);
    await waitFor(() => expect(screen.getByText("brochure.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Remove brochure.pdf"));
    expect(screen.queryByText("brochure.pdf")).toBeNull();
  });
});
