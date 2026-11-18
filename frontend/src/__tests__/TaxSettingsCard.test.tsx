import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TaxSettingsCard } from "../components/invoices/TaxSettingsCard";
import type { GstType } from "../types";

const baseProps = {
  gstEnabled: true,
  gstType: "CGST_SGST" as GstType,
  gstRate: 18,
  onGstEnabledChange: vi.fn(),
  onGstTypeChange: vi.fn(),
  onGstRateChange: vi.fn(),
};

describe("TaxSettingsCard", () => {
  it("hides GST type/rate controls when GST is off", () => {
    render(<TaxSettingsCard {...baseProps} gstEnabled={false} />);
    expect(screen.queryByText("CGST + SGST")).toBeNull();
    expect(screen.queryByText("GST rate")).toBeNull();
  });

  it("shows GST type/rate controls when GST is on", () => {
    render(<TaxSettingsCard {...baseProps} />);
    expect(screen.getByText("CGST + SGST")).toBeInTheDocument();
    expect(screen.getByText("IGST")).toBeInTheDocument();
    expect(screen.getByText("GST rate")).toBeInTheDocument();
  });

  it("toggling the Include GST switch calls onGstEnabledChange", () => {
    const onGstEnabledChange = vi.fn();
    render(<TaxSettingsCard {...baseProps} onGstEnabledChange={onGstEnabledChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Include GST" }));
    expect(onGstEnabledChange).toHaveBeenCalledWith(false);
  });

  it("shows the intra-state hint for CGST+SGST and inter-state hint for IGST", () => {
    const { rerender } = render(<TaxSettingsCard {...baseProps} gstType="CGST_SGST" />);
    expect(
      screen.getByText("Intra-state — buyer in the same state as your business."),
    ).toBeInTheDocument();

    rerender(<TaxSettingsCard {...baseProps} gstType="IGST" />);
    expect(screen.getByText("Inter-state — buyer in a different state.")).toBeInTheDocument();
  });

  it("selecting a preset rate chip calls onGstRateChange with that rate", () => {
    const onGstRateChange = vi.fn();
    render(<TaxSettingsCard {...baseProps} onGstRateChange={onGstRateChange} />);
    fireEvent.click(screen.getByText("12%"));
    expect(onGstRateChange).toHaveBeenCalledWith(12);
  });

  it("selecting Custom reveals a numeric input and clears preset selection", () => {
    render(<TaxSettingsCard {...baseProps} gstRate={18} />);
    expect(screen.queryByPlaceholderText("Custom rate %")).toBeNull();

    fireEvent.click(screen.getByText("Custom"));
    const input = screen.getByPlaceholderText("Custom rate %");
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "15.5" } });
    // onGstRateChange fires with the raw numeric value from the input.
  });

  it("custom input calls onGstRateChange as the user types", () => {
    const onGstRateChange = vi.fn();
    render(<TaxSettingsCard {...baseProps} onGstRateChange={onGstRateChange} />);
    fireEvent.click(screen.getByText("Custom"));
    fireEvent.change(screen.getByPlaceholderText("Custom rate %"), { target: { value: "15.5" } });
    expect(onGstRateChange).toHaveBeenCalledWith(15.5);
  });

  it("starts in custom mode when the initial rate is not a preset", () => {
    render(<TaxSettingsCard {...baseProps} gstRate={15} />);
    expect(screen.getByPlaceholderText("Custom rate %")).toBeInTheDocument();
  });
});
