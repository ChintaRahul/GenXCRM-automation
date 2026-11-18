import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import LeadDetailPage from "../pages/LeadDetail";
import { TooltipProvider } from "../components/ui/tooltip";
import * as client from "../api/client";
import * as authCtx from "../context/AuthContext";
import type { Lead, User } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockUser: User = {
  id: "rep-1",
  name: "Rep One",
  email: "rep@t.com",
  role: "SALES_REP",
  teamId: "team-1",
};

const mockLead: Lead = {
  id: "lead-1",
  name: "Sneha Patel",
  phone: "+919876543210",
  source: "INSTAGRAM",
  stage: "INTERESTED",
  score: 84,
  interestedCount: 1,
  tags: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  assignedTo: { id: "rep-1", name: "Rep One" },
  activities: [],
  communications: [],
  payments: [],
  callRecordings: [],
  assignmentChain: {
    owner: { id: "rep-1", name: "Rep One", role: "SALES_REP" },
    manager: { id: "mgr-1", name: "Manager One" },
    director: null,
  },
};

describe("LeadDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockUser,
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(client.getUsers).mockResolvedValue([]);
    vi.mocked(client.getLead).mockResolvedValue(mockLead);
    vi.mocked(client.getTemplates).mockResolvedValue([]);
    vi.mocked(client.getFormSubmissions).mockResolvedValue([]);
  });

  it("renders the stage stepper, composer, and right-rail cards once the lead loads", async () => {
    render(
      <MemoryRouter initialEntries={["/leads/lead-1"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sneha Patel" }),
      ).toBeInTheDocument(),
    );

    // Stage stepper (labels unique to the stepper, unlike "Interested" which
    // also appears as the header/profile-card status badge)
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Negotiation")).toBeInTheDocument();
    // Composer tabs (SMS/Log call hidden for phase 1 — SCRUM-49)
    expect(screen.getByRole("button", { name: "WhatsApp" })).toBeInTheDocument();
    // Right rail
    expect(screen.getByText("Deal value")).toBeInTheDocument();
    expect(screen.getByText("Up next")).toBeInTheDocument();
    expect(screen.getByText("Hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Manager One")).toBeInTheDocument();
  });

  // Regression test: onSendComm's wiring in LeadDetail once dropped the attachmentIds
  // argument (`(type, body, subject) => sendComm(type, body, subject)`), so a picked
  // attachment silently never reached the send request.
  it("forwards attachmentIds from the Composer through to sendEmail", async () => {
    vi.mocked(client.initAttachment).mockResolvedValue({
      attachmentId: "att-1",
      uploadUrl: "https://s3.example.com/upload",
    });
    vi.mocked(client.completeAttachment).mockResolvedValue(undefined);
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(client.sendEmail).mockResolvedValue({
      id: "comm-1",
      leadId: "lead-1",
      type: "EMAIL",
      direction: "outbound",
      subject: "Follow up",
      body: "See attached",
      status: "sent",
      sentAt: "2026-08-01T00:00:00.000Z",
      attachmentIds: ["att-1"],
    } as never);

    render(
      <MemoryRouter initialEntries={["/leads/lead-1"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sneha Patel" }),
      ).toBeInTheDocument(),
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

    await waitFor(() =>
      expect(client.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentIds: ["att-1"] }),
      ),
    );
  });

  // Regression test for SCRUM-43: clicking a non-active stage in the stepper did nothing
  // because StageStepper disabled every stage before the current one. It should call the
  // same updateLead path the stage dropdown uses and reflect the new active stage.
  it("updates the lead's stage when a stage-stepper pill is clicked", async () => {
    vi.mocked(client.updateLead).mockResolvedValue({
      ...mockLead,
      stage: "CONTACTED",
    } as Lead);

    render(
      <MemoryRouter initialEntries={["/leads/lead-1"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sneha Patel" }),
      ).toBeInTheDocument(),
    );

    // Lead starts at INTERESTED; "Contacted" is a past (already-completed) stage in
    // the stepper — clicking it must still fire the update.
    fireEvent.click(screen.getByText("Contacted"));

    await waitFor(() =>
      expect(client.updateLead).toHaveBeenCalledWith("lead-1", {
        stage: "CONTACTED",
      }),
    );
    expect(client.getLead).toHaveBeenCalledTimes(2); // initial load + refetch after change
  });

  // Regression test for SCRUM-50: Meta can accept a free-form WhatsApp send synchronously
  // (200 OK) and only report the real failure asynchronously via its status webhook — the
  // rep should be told about that failure without needing to manually refresh the page.
  it("surfaces a WhatsApp send that fails asynchronously, via the delayed recheck", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { toast } = await import("sonner");

    let whatsappSent = false;
    const failedLead: Lead = {
      ...mockLead,
      communications: [
        {
          id: "comm-1",
          type: "WHATSAPP",
          body: "hi",
          status: "failed",
          sentAt: "2026-08-01T00:00:00.000Z",
          metadata: { error: "Re-engagement message" },
        },
      ],
    };
    vi.mocked(client.sendWhatsApp).mockImplementation(async () => {
      whatsappSent = true;
      return {
        id: "comm-1",
        leadId: "lead-1",
        type: "WHATSAPP",
        direction: "outbound",
        body: "hi",
        status: "sent",
        sentAt: "2026-08-01T00:00:00.000Z",
      } as never;
    });
    vi.mocked(client.getLead).mockImplementation(async () =>
      whatsappSent ? failedLead : mockLead,
    );

    render(
      <MemoryRouter initialEntries={["/leads/lead-1"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sneha Patel" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    fireEvent.change(screen.getByPlaceholderText("Write a message…"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(client.sendWhatsApp).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8000);

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Re-engagement message"),
    );

    vi.useRealTimers();
  });

  it("navigates to the register-student wizard with the lead preselected", async () => {
    render(
      <MemoryRouter initialEntries={["/leads/lead-1"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/register/new" element={<div>Register wizard</div>} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sneha Patel" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Register Student/i }));

    await waitFor(() => expect(screen.getByText("Register wizard")).toBeInTheDocument());
  });

  it("labels an org-configured custom field by its current name instead of its raw id", async () => {
    vi.mocked(client.getFieldMappings).mockResolvedValue({
      coreFieldAliases: {},
      customFieldDefs: [{ id: "cf-1", name: "Organization Type", aliases: "org_type" }],
      detectedFields: [],
    });
    vi.mocked(client.getLead).mockResolvedValue({
      ...mockLead,
      customFields: { "cf-1": "EdTech" },
    });

    render(
      <MemoryRouter initialEntries={["/leads/lead-1"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/leads/:id" element={<LeadDetailPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sneha Patel" })).toBeInTheDocument(),
    );

    await waitFor(() => expect(screen.getByText("Organization Type")).toBeInTheDocument());
    expect(screen.getByText("EdTech")).toBeInTheDocument();
    expect(screen.queryByText("cf-1")).toBeNull();
  });
});
