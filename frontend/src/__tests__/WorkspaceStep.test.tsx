import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkspaceStep } from "../components/register/WorkspaceStep";

describe("WorkspaceStep", () => {
  it("disables Continue until EdTech is selected and the acknowledgement is ticked", () => {
    render(<WorkspaceStep value="" onConfirm={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.click(screen.getByText(/edtech/i));
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("confirms the selected workspace type once acknowledged", () => {
    const onConfirm = vi.fn();
    render(<WorkspaceStep value="" onConfirm={onConfirm} onBack={vi.fn()} />);

    fireEvent.click(screen.getByText(/edtech/i));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onConfirm).toHaveBeenCalledWith("EDTECH");
  });

  it("marks Manufacturing as coming soon and cannot be selected", () => {
    render(<WorkspaceStep value="" onConfirm={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    const mfg = screen.getByRole("radio", { name: /manufacturing/i });
    expect(mfg).toBeDisabled();
    fireEvent.click(mfg);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("calls onBack when Back is clicked", () => {
    const onBack = vi.fn();
    render(<WorkspaceStep value="" onConfirm={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("renders the two workspace types as a radiogroup", () => {
    render(<WorkspaceStep value="" onConfirm={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
});
