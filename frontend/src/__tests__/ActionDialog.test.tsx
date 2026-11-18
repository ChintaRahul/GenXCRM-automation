import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ActionDialog } from "../components/module/ActionDialog";
import type { ModuleAction } from "../modules/registry";

vi.mock("../lib/lookupNames", () => ({
  useLookupOptions: () => ({ options: [{ id: "u-2", label: "Mfg Sales Exec 2" }], loading: false }),
  useLookupName: (_source: string | undefined, id: unknown) => (typeof id === "string" && id ? id : "—"),
}));

const disqualifyAction: ModuleAction = {
  label: "Disqualify",
  danger: true,
  ask: { key: "disq", label: "Disqualification reason", type: "select", options: ["Price", "Budget"], required: true },
};

describe("ActionDialog", () => {
  it("passes the optional extra answers along with the main one", () => {
    const lost: ModuleAction = {
      label: "Mark lost",
      ask: {
        key: "lost",
        label: "Lost reason",
        type: "select",
        options: ["Price", "Competitor"],
        required: true,
        more: [
          { key: "competitorPrice", label: "Competitor price", type: "money", required: false },
          { key: "lostFeedback", label: "Customer feedback", type: "textarea", required: false },
        ],
      },
    };
    const onConfirm = vi.fn();
    render(<ActionDialog action={lost} open onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/lost reason/i), { target: { value: "Competitor" } });
    fireEvent.change(screen.getByLabelText("Competitor price"), { target: { value: "450000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("Competitor", { competitorPrice: "450000" });
  });

  it("renders the ask field's label and options", () => {
    render(<ActionDialog action={disqualifyAction} open onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/disqualification reason/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Price" })).toBeInTheDocument();
  });

  it("disables Confirm until a required value is provided", () => {
    render(<ActionDialog action={disqualifyAction} open onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/disqualification reason/i), { target: { value: "Budget" } });
    expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
  });

  it("calls onConfirm with the entered value", async () => {
    const onConfirm = vi.fn();
    render(<ActionDialog action={disqualifyAction} open onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/disqualification reason/i), { target: { value: "Price" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Price"));
  });

  it("allows an optional ask field to be confirmed with an empty value", () => {
    const optionalAction: ModuleAction = {
      label: "Approve",
      ask: { key: "comments", label: "Comment (optional)", type: "textarea", required: false },
    };
    render(<ActionDialog action={optionalAction} open onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
  });

  it("renders a date picker that blocks past dates for a date ask", () => {
    const reschedule: ModuleAction = { label: "Reschedule", ask: { key: "date", label: "New date", type: "date", required: true } };
    render(<ActionDialog action={reschedule} open onClose={vi.fn()} onConfirm={vi.fn()} />);
    const input = screen.getByLabelText(/new date/i);
    expect(input).toHaveAttribute("type", "date");
    fireEvent.change(input, { target: { value: "2020-01-01" } });
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: "2099-01-01" } });
    expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
  });

  it("offers a people dropdown for an owner ask, not a free-text box", () => {
    const reassign: ModuleAction = { label: "Reassign owner", ask: { key: "owner", label: "New owner", type: "owner", required: true } };
    const onConfirm = vi.fn();
    render(<ActionDialog action={reassign} open onClose={vi.fn()} onConfirm={onConfirm} />);
    const select = screen.getByLabelText(/new owner/i);
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    fireEvent.change(select, { target: { value: "u-2" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith("u-2");
  });

  it("rejects a numbers-only text answer, accepts a described action", () => {
    const complete: ModuleAction = { label: "Complete visit", ask: { key: "next", label: "Next action", type: "text", required: true } };
    render(<ActionDialog action={complete} open onClose={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/next action/i), { target: { value: "12345" } });
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    expect(screen.getByText(/describe the action in words/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/next action/i), { target: { value: "Send revised quotation by 20 Oct" } });
    expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled();
  });
});
