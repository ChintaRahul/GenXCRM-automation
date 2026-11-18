import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { ExportReportModal } from "../components/reports/ExportReportModal";
import { TooltipProvider } from "../components/ui/tooltip";
import * as client from "../api/client";
import * as authCtx from "../context/AuthContext";
import * as themeCtx from "../lib/theme";

vi.mock("../api/client");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/theme", () => ({ useTheme: vi.fn() }));

const filters = { from: "2026-08-01", to: "2026-08-05" };
const summary = { generated: 100, newLeads: 20, contacted: 60, pending: 10 };
const status = [
  { stage: "NEW", count: 20 },
  { stage: "INTERESTED", count: 10 },
];

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not implement URL.createObjectURL — the export flow's download step needs it.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  globalThis.URL.revokeObjectURL = vi.fn();
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: {
      id: "u1",
      name: "Test User",
      email: "test@t.com",
      role: "DIRECTOR",
      teamId: null,
      org: { id: "org-1", name: "Acme Academy", slug: "acme", industry: "EDTECH", size: "SMALL", country: "India", timezone: "Asia/Kolkata" },
    },
    token: "tok",
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
    isImpersonating: false,
    impersonate: vi.fn(),
    exitImpersonation: vi.fn(),
  } as unknown as ReturnType<typeof authCtx.useAuth>);
  vi.mocked(themeCtx.useTheme).mockReturnValue({ theme: "dark", toggleTheme: vi.fn(), setTheme: vi.fn() });
});

function renderModal(
  props: Partial<React.ComponentProps<typeof ExportReportModal>> = {},
) {
  const onOpenChange = vi.fn();
  const { container } = render(
    <TooltipProvider>
      <ExportReportModal
        open={true}
        onOpenChange={onOpenChange}
        filters={filters}
        summary={summary}
        status={status}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onOpenChange, container };
}

function clickFormatCard(name: "PDF" | "Excel" | "CSV") {
  fireEvent.click(screen.getByText(name).closest("button")!);
}

describe("ExportReportModal", () => {
  it("defaults to PDF with content, orientation groups and preview visible", () => {
    renderModal();
    expect(screen.getByText("Export report")).toBeInTheDocument();
    expect(screen.getByText("Include charts & visuals")).toBeInTheDocument();
    expect(screen.getByText("Page orientation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "With charts" }),
    ).toBeInTheDocument();
    // Page 1 is the cover page (includeCover defaults true) — shows the org name, both in
    // the main preview and in the (always-rendered) cover thumbnail's own mini preview.
    expect(screen.getAllByText("ACME ACADEMY").length).toBeGreaterThan(0);
  });

  it("shows different content in the preview when a different page thumbnail is clicked", () => {
    renderModal();
    // Default sections chunk two-per-page after the cover: page 2 = summary+status,
    // page 3 = enrollment+campaign. Every thumbnail always renders its own mini preview, so
    // "Lead Status Report" is already present once (in page 2's thumbnail) before it's
    // selected — clicking it adds one more copy in the enlarged main preview.
    const baselineCount = screen.getAllByText("Lead Status Report").length;

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getAllByText("Lead Status Report")).toHaveLength(baselineCount + 1);

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getAllByText("Lead Status Report")).toHaveLength(baselineCount);
    expect(screen.getAllByText("ACME ACADEMY").length).toBeGreaterThan(0);
  });

  it("switches the preview page background to match the app's light/dark theme", () => {
    // The dialog renders into a Radix portal appended to document.body, not under RTL's
    // returned `container` — search the whole document instead.
    // getAttribute, not .className — SVG elements expose className as an
    // SVGAnimatedString (no .includes), not a plain string.
    const hasClassContaining = (needle: string) =>
      Array.from(document.body.querySelectorAll<HTMLElement>("[class]")).some((el) =>
        (el.getAttribute("class") ?? "").includes(needle),
      );

    renderModal();
    expect(hasClassContaining("bg-[#0C0F17]")).toBe(true);

    vi.mocked(themeCtx.useTheme).mockReturnValue({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() });
    renderModal();
    // Only one preview page can be mounted with the dark background at a time — the first
    // (dark) render's page is still in the DOM (RTL doesn't unmount between renders in the
    // same test), so this just confirms a second, light-themed preview page was also added.
    const previewPages = Array.from(document.body.querySelectorAll<HTMLElement>("[class]")).filter(
      (el) => (el.getAttribute("class") ?? "").includes("aspect-[210/297]"),
    );
    expect(previewPages.some((el) => (el.getAttribute("class") ?? "").includes("bg-white"))).toBe(true);
  });

  it("lets the preview theme toggle be flipped independently of the app theme, and exports with the flipped value", async () => {
    vi.mocked(client.exportDailyReport).mockResolvedValue(new Blob(["data"]));
    vi.mocked(themeCtx.useTheme).mockReturnValue({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() });
    renderModal();

    // Starts synced to the app's light theme.
    const toggle = screen.getByRole("button", { name: /switch preview to dark theme/i });
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: /switch preview to light theme/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export PDF/i }));
    await waitFor(() =>
      expect(client.exportDailyReport).toHaveBeenCalledWith(
        filters,
        expect.objectContaining({ format: "pdf", theme: "dark" }),
      ),
    );
  });

  it("hides the preview theme toggle for Excel and CSV", () => {
    renderModal();
    clickFormatCard("Excel");
    expect(screen.queryByRole("button", { name: /switch preview to/i })).not.toBeInTheDocument();
  });

  it("sends the current app theme with the export request", async () => {
    vi.mocked(client.exportDailyReport).mockResolvedValue(new Blob(["data"]));
    vi.mocked(themeCtx.useTheme).mockReturnValue({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /Export PDF/i }));

    await waitFor(() =>
      expect(client.exportDailyReport).toHaveBeenCalledWith(
        filters,
        expect.objectContaining({ format: "pdf", theme: "light" }),
      ),
    );
  });

  it("omits theme from the export request for Excel and CSV, since only PDF renders theme-aware colors", async () => {
    vi.mocked(client.exportDailyReport).mockResolvedValue(new Blob(["data"]));
    renderModal();

    clickFormatCard("Excel");
    fireEvent.click(screen.getByRole("button", { name: /Export EXCEL/i }));
    await waitFor(() => expect(client.exportDailyReport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.exportDailyReport).mock.calls[0][1]).not.toHaveProperty("theme");

    clickFormatCard("CSV");
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    await waitFor(() => expect(client.exportDailyReport).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.exportDailyReport).mock.calls[1][1]).not.toHaveProperty("theme");
  });

  it("hides content/orientation groups and the page preview when Excel is selected", () => {
    renderModal();
    clickFormatCard("Excel");
    expect(
      screen.queryByText("Include charts & visuals"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Page orientation")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "With charts" }),
    ).not.toBeInTheDocument();
    // Only the checklist row remains — the preview page mockup is gone for non-PDF formats.
    expect(screen.getAllByText("Lead Status Report")).toHaveLength(1);
    expect(
      screen.getByText(/one worksheet per selected section/i),
    ).toBeInTheDocument();
  });

  it("disables the section checklist when CSV is selected", () => {
    renderModal();
    clickFormatCard("CSV");
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((box) => expect(box).toBeDisabled());
    // Summary stays checked (the only section CSV ever exports); others are forced unchecked.
    expect(
      screen.getByRole("checkbox", { name: /Lead Summary KPIs/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Lead Status Report/i }),
    ).not.toBeChecked();
  });

  it("flips the compare toggle to Table only when Include charts is turned off, and back when turned on", () => {
    renderModal();
    const chartsSwitch = screen.getByRole("switch", {
      name: "Include charts & visuals",
    });
    expect(chartsSwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "With charts" })).toHaveClass(
      "bg-primary",
    );

    fireEvent.click(chartsSwitch);
    expect(chartsSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Table only" })).toHaveClass(
      "bg-primary",
    );

    fireEvent.click(chartsSwitch);
    expect(chartsSwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "With charts" })).toHaveClass(
      "bg-primary",
    );
  });

  it("manually clicking the compare toggle does not change the real Include charts switch", () => {
    renderModal();
    const chartsSwitch = screen.getByRole("switch", {
      name: "Include charts & visuals",
    });
    fireEvent.click(screen.getByRole("button", { name: "Table only" }));
    expect(screen.getByRole("button", { name: "Table only" })).toHaveClass(
      "bg-primary",
    );
    expect(chartsSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("calls exportDailyReport with the current options and shows the success banner", async () => {
    vi.mocked(client.exportDailyReport).mockResolvedValue(new Blob(["data"]));
    renderModal();

    clickFormatCard("Excel");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Lead Source Tracking/i }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Export EXCEL/i }));

    await waitFor(() =>
      expect(client.exportDailyReport).toHaveBeenCalledWith(
        filters,
        expect.objectContaining({
          format: "excel",
          sections: expect.arrayContaining([
            "summary",
            "status",
            "enrollment",
            "campaign",
            "sources",
          ]),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Export ready/i)).toBeInTheDocument(),
    );
  });

  it("closes without throwing when Cancel is clicked mid-export", async () => {
    let resolveExport: (blob: Blob) => void;
    vi.mocked(client.exportDailyReport).mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    const { onOpenChange } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /Export PDF/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    resolveExport!(new Blob(["data"]));
    await Promise.resolve();
  });
});
