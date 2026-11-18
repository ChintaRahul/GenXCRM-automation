import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Composer } from "../components/leadDetail/Composer";
import * as client from "../api/client";
import type { MessageTemplate } from "../types";

vi.mock("../api/client");

const capacitorHttpPutMock = vi.fn();
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    CapacitorHttp: { put: (...args: unknown[]) => capacitorHttpPutMock(...args) },
  };
});

const isNativeMock = vi.fn().mockReturnValue(false);
vi.mock("../lib/platform", () => ({
  isNative: () => isNativeMock(),
}));

describe("Composer", () => {
  it("labels every action tab with a visible caption and an accessible name, on mobile too", () => {
    render(
      <Composer onSaveNote={vi.fn()} onSendComm={vi.fn()} onLogCall={vi.fn()} />,
    );
    for (const label of ["Note", "WhatsApp", "Email"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("title", label);
      // The label text itself must not be hidden at mobile widths (no `hidden` class) —
      // an accessible name alone isn't enough since `title` tooltips don't surface on tap.
      const labelSpan = within(button).getByText(label);
      expect(labelSpan.className).not.toMatch(/\bhidden\b/);
    }
  });

  it("hides the ⌘+Enter keyboard-shortcut hint on mobile (no physical keyboard to use it)", () => {
    render(
      <Composer onSaveNote={vi.fn()} onSendComm={vi.fn()} onLogCall={vi.fn()} />,
    );
    const hint = screen.getByText("⌘+Enter to save");
    expect(hint.className).toMatch(/\bhidden\b/);
    expect(hint.className).toMatch(/sm:inline/);
  });

  it("defaults to the Note tab and calls onSaveNote on Save", () => {
    const onSaveNote = vi.fn();
    render(
      <Composer
        onSaveNote={onSaveNote}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Add a note…"), {
      target: { value: "Called back later" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveNote).toHaveBeenCalledWith("Called back later");
  });

  it("switches to the WhatsApp tab and calls onSendComm with type WHATSAPP", () => {
    const onSendComm = vi.fn();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={onSendComm}
        onLogCall={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    fireEvent.change(screen.getByPlaceholderText("Write a message…"), {
      target: { value: "Hi there" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(onSendComm).toHaveBeenCalledWith("WHATSAPP", "Hi there", "", undefined);
  });

  it("shows a subject field only on the Email tab and includes it in onSendComm", () => {
    const onSendComm = vi.fn();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={onSendComm}
        onLogCall={vi.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText("Subject")).toBeNull();
    fireEvent.click(screen.getByText("Email"));
    expect(screen.getByPlaceholderText("Subject")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Subject"), {
      target: { value: "Follow up" },
    });
    fireEvent.change(screen.getByPlaceholderText("Write a message…"), {
      target: { value: "See attached" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(onSendComm).toHaveBeenCalledWith(
      "EMAIL",
      "See attached",
      "Follow up",
      undefined,
    );
  });

  it("attaches a file on the Email tab and includes its id in onSendComm", async () => {
    vi.mocked(client.initAttachment).mockResolvedValue({
      attachmentId: "att-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeAttachment).mockResolvedValue(undefined);
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const onSendComm = vi.fn();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={onSendComm}
        onLogCall={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Email"));
    fireEvent.change(screen.getByPlaceholderText("Subject"), {
      target: { value: "Follow up" },
    });
    fireEvent.change(screen.getByPlaceholderText("Write a message…"), {
      target: { value: "See attached" },
    });

    const fileInput = document.querySelector(
      'input[type="file"][accept*=".pdf"]',
    ) as HTMLInputElement;
    const file = new File(["pdf-bytes"], "brochure.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(client.completeAttachment).toHaveBeenCalledWith("att-1"));

    fireEvent.click(screen.getByText("Send"));
    expect(onSendComm).toHaveBeenCalledWith(
      "EMAIL",
      "See attached",
      "Follow up",
      ["att-1"],
    );
  });

  it("attaches a file on the WhatsApp tab and includes its id in onSendComm", async () => {
    vi.mocked(client.initAttachment).mockResolvedValue({
      attachmentId: "att-9",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeAttachment).mockResolvedValue(undefined);
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const onSendComm = vi.fn();
    render(<Composer onSaveNote={vi.fn()} onSendComm={onSendComm} onLogCall={vi.fn()} />);
    fireEvent.click(screen.getByText("WhatsApp"));
    fireEvent.change(screen.getByPlaceholderText("Write a message…"), {
      target: { value: "Brochure attached" },
    });

    const fileInput = document.querySelector(
      'input[type="file"][accept*=".pdf"]',
    ) as HTMLInputElement;
    const file = new File(["pdf-bytes"], "brochure.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(client.completeAttachment).toHaveBeenCalledWith("att-9"));

    fireEvent.click(screen.getByText("Send"));
    expect(onSendComm).toHaveBeenCalledWith("WHATSAPP", "Brochure attached", "", ["att-9"]);
  });

  it("Log call tab calls onLogCall", () => {
    const onLogCall = vi.fn();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={onLogCall}
      />,
    );
    fireEvent.click(screen.getByText("Log call"));
    fireEvent.change(
      screen.getByPlaceholderText("What happened on the call?"),
      {
        target: { value: "No answer" },
      },
    );
    fireEvent.click(screen.getByText("Log Call"));
    expect(onLogCall).toHaveBeenCalledWith("No answer");
  });

  it("Save is disabled when the textarea is empty", () => {
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
      />,
    );
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("⌘+Enter submits the active tab", () => {
    const onSaveNote = vi.fn();
    render(
      <Composer
        onSaveNote={onSaveNote}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText("Add a note…");
    fireEvent.change(textarea, { target: { value: "Quick note" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSaveNote).toHaveBeenCalledWith("Quick note");
  });

  it("switching tabs clears the draft text", () => {
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Add a note…"), {
      target: { value: "Draft" },
    });
    fireEvent.click(screen.getByText("WhatsApp"));
    expect(screen.getByPlaceholderText("Write a message…")).toHaveValue("");
  });
});

describe("Composer WhatsApp template mode", () => {
  const approvedTemplate: MessageTemplate = {
    id: "tpl-1",
    channel: "WHATSAPP",
    name: "Welcome Offer",
    body: "Hi {{1}}, welcome to {{2}}",
    isSystem: false,
    status: "APPROVED",
    language: "en_US",
    category: "MARKETING",
    metaTemplateName: "welcome_offer_org1_ab12",
    variables: ["name", "course"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const draftTemplate: MessageTemplate = {
    ...approvedTemplate,
    id: "tpl-2",
    name: "Unapproved Draft",
    status: "DRAFT",
  };

  it("hides the mode toggle when there are no approved WhatsApp templates", () => {
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[draftTemplate]}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    expect(screen.queryByText("Template")).toBeNull();
    expect(screen.getByPlaceholderText("Write a message…")).toBeInTheDocument();
  });

  it("lets the user pick an approved template, fill in {{1}}/{{2}}, and sends the literal params", async () => {
    const user = userEvent.setup();
    const onSendWhatsAppTemplate = vi.fn();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[approvedTemplate, draftTemplate]}
        onSendWhatsAppTemplate={onSendWhatsAppTemplate}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    fireEvent.click(screen.getByText("Template"));

    // Only the APPROVED template is offered — a DRAFT one isn't safe to send.
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Welcome Offer")).toBeInTheDocument();
    expect(screen.queryByText("Unapproved Draft")).toBeNull();
    await user.click(screen.getByText("Welcome Offer"));

    expect(screen.getByText("Hi {{1}}, welcome to {{2}}")).toBeInTheDocument();
    const sendButton = screen.getByText("Send");
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("{{1}} — name"), {
      target: { value: "Asha" },
    });
    fireEvent.change(screen.getByPlaceholderText("{{2}} — course"), {
      target: { value: "MBA" },
    });
    expect(sendButton).not.toBeDisabled();

    fireEvent.click(sendButton);
    expect(onSendWhatsAppTemplate).toHaveBeenCalledWith(approvedTemplate, [
      "Asha",
      "MBA",
    ]);
  });

  it("pre-fills template variables from the lead values and lets the rep send without typing", async () => {
    const user = userEvent.setup();
    const onSendWhatsAppTemplate = vi.fn();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[approvedTemplate]}
        templateValues={{ name: "Asha", course: "MBA" }}
        onSendWhatsAppTemplate={onSendWhatsAppTemplate}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    fireEvent.click(screen.getByText("Template"));
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Welcome Offer"));

    expect(screen.getByPlaceholderText("{{1}} — name")).toHaveValue("Asha");
    expect(screen.getByPlaceholderText("{{2}} — course")).toHaveValue("MBA");
    fireEvent.click(screen.getByText("Send"));
    expect(onSendWhatsAppTemplate).toHaveBeenCalledWith(approvedTemplate, ["Asha", "MBA"]);
  });

  it("leaves variables it cannot resolve empty for the rep to fill in", async () => {
    const user = userEvent.setup();
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[approvedTemplate]}
        templateValues={{ name: "Asha" }}
        onSendWhatsAppTemplate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    fireEvent.click(screen.getByText("Template"));
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Welcome Offer"));

    expect(screen.getByPlaceholderText("{{2}} — course")).toHaveValue("");
    expect(screen.getByText("Send")).toBeDisabled();
  });

  describe("email templates", () => {
    const emailTemplate: MessageTemplate = {
      id: "em-1",
      channel: "EMAIL",
      name: "Payment Link",
      subject: "Your payment link from {{org}}",
      body: "Hi {{name}}, pay ₹{{amount}}: {{payment_link}}",
      isSystem: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    it("hides the template picker when there are no email templates", () => {
      render(<Composer onSaveNote={vi.fn()} onSendComm={vi.fn()} onLogCall={vi.fn()} />);
      fireEvent.click(screen.getByText("Email"));
      expect(screen.queryByRole("combobox", { name: /email template/i })).toBeNull();
    });

    it("fills subject and body from the template, resolving known values and keeping unknown placeholders", async () => {
      const user = userEvent.setup();
      const onSendComm = vi.fn();
      render(
        <Composer
          onSaveNote={vi.fn()}
          onSendComm={onSendComm}
          onLogCall={vi.fn()}
          emailTemplates={[emailTemplate]}
          templateValues={{ name: "Asha", org: "Acme", amount: "25000" }}
        />,
      );
      fireEvent.click(screen.getByText("Email"));
      await user.click(screen.getByRole("combobox", { name: /email template/i }));
      await user.click(screen.getByText("Payment Link"));

      expect(screen.getByPlaceholderText("Subject")).toHaveValue("Your payment link from Acme");
      const body = screen.getByPlaceholderText("Write a message…");
      expect(body).toHaveValue("Hi Asha, pay ₹25000: {{payment_link}}");

      fireEvent.click(screen.getByText("Send"));
      expect(onSendComm).toHaveBeenCalledWith(
        "EMAIL",
        "Hi Asha, pay ₹25000: {{payment_link}}",
        "Your payment link from Acme",
        undefined,
      );
    });
  });

  it("forces Template mode and disables Free-form when the lead has no open WhatsApp conversation", () => {
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[approvedTemplate]}
        whatsappConversationOpen={false}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));

    expect(screen.getByText("Free-form")).toBeDisabled();
    // Auto-forced into Template mode — the free-form textarea never shows.
    expect(screen.queryByPlaceholderText("Write a message…")).toBeNull();
    expect(screen.getByText(/Free-form unlocks once the lead replies/)).toBeInTheDocument();
  });

  it("clicking the disabled Free-form button does nothing", () => {
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[approvedTemplate]}
        whatsappConversationOpen={false}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    fireEvent.click(screen.getByText("Free-form"));
    expect(screen.queryByPlaceholderText("Write a message…")).toBeNull();
  });

  it("still allows free-form when there are no approved templates at all, even with no open conversation", () => {
    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        whatsappTemplates={[draftTemplate]}
        whatsappConversationOpen={false}
      />,
    );
    fireEvent.click(screen.getByText("WhatsApp"));
    expect(screen.getByPlaceholderText("Write a message…")).toBeInTheDocument();
  });
});

describe("Composer recording upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLMediaElement.prototype.load = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 12,
    });
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  function uploadFile(file: File) {
    fireEvent.click(screen.getByText("Log call"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("uploads a selected file and calls onRecordingUploaded on success", async () => {
    vi.mocked(client.initCallRecording).mockResolvedValue({
      recordingId: "rec-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeCallRecording).mockResolvedValue({
      id: "rec-1",
      status: "UPLOADED",
      durationSec: 12,
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const onRecordingUploaded = vi.fn();

    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        leadId="lead-1"
        leadPhone="+919876543210"
        onRecordingUploaded={onRecordingUploaded}
      />,
    );

    const file = new File(["fake-audio"], "recording.mp3", { type: "audio/mpeg" });
    uploadFile(file);

    const audioEls = document.getElementsByTagName("audio");
    fireEvent.loadedMetadata(audioEls[audioEls.length - 1]);

    await waitFor(() =>
      expect(client.initCallRecording).toHaveBeenCalledWith({
        leadId: "lead-1",
        mimeType: "audio/mpeg",
        durationSec: 12,
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://s3.example.com/upload",
      expect.objectContaining({ method: "PUT" }),
    );
    await waitFor(() =>
      expect(client.completeCallRecording).toHaveBeenCalledWith("rec-1", {
        durationSec: 12,
        fileSize: file.size,
      }),
    );
    await waitFor(() => expect(onRecordingUploaded).toHaveBeenCalled());
  });

  it("shows an error toast and does not call onRecordingUploaded when the S3 PUT fails", async () => {
    vi.mocked(client.initCallRecording).mockResolvedValue({
      recordingId: "rec-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const onRecordingUploaded = vi.fn();

    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        leadId="lead-1"
        leadPhone="+919876543210"
        onRecordingUploaded={onRecordingUploaded}
      />,
    );

    const file = new File(["fake-audio"], "recording.mp3", { type: "audio/mpeg" });
    uploadFile(file);
    const audioEls = document.getElementsByTagName("audio");
    fireEvent.loadedMetadata(audioEls[audioEls.length - 1]);

    await waitFor(() => expect(client.initCallRecording).toHaveBeenCalled());
    await waitFor(() => expect(client.completeCallRecording).not.toHaveBeenCalled());
    expect(onRecordingUploaded).not.toHaveBeenCalled();
  });

  it("uploads via CapacitorHttp (not fetch) on native, bypassing WebView CORS", async () => {
    isNativeMock.mockReturnValue(true);
    vi.mocked(client.initCallRecording).mockResolvedValue({
      recordingId: "rec-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeCallRecording).mockResolvedValue({
      id: "rec-1",
      status: "UPLOADED",
      durationSec: 12,
    });
    capacitorHttpPutMock.mockResolvedValue({ status: 200 });
    const fetchSpy = vi.spyOn(global, "fetch");
    const onRecordingUploaded = vi.fn();

    render(
      <Composer
        onSaveNote={vi.fn()}
        onSendComm={vi.fn()}
        onLogCall={vi.fn()}
        leadId="lead-1"
        leadPhone="+919876543210"
        onRecordingUploaded={onRecordingUploaded}
      />,
    );

    const file = new File(["fake-audio"], "recording.mp3", { type: "audio/mpeg" });
    uploadFile(file);
    const audioEls = document.getElementsByTagName("audio");
    fireEvent.loadedMetadata(audioEls[audioEls.length - 1]);

    await waitFor(() =>
      expect(capacitorHttpPutMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://s3.example.com/upload",
          dataType: "file",
          headers: { "Content-Type": "audio/mpeg" },
        }),
      ),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith("https://s3.example.com/upload", expect.anything());
    await waitFor(() => expect(onRecordingUploaded).toHaveBeenCalled());

    isNativeMock.mockReturnValue(false); // reset for subsequent tests
  });
});
