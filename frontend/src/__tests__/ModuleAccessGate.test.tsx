import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { ModuleAccessGate } from "../components/module/ModuleAccessGate";
import * as readable from "../hooks/useReadableModules";

vi.mock("../hooks/useWorkspace", () => ({ useWorkspace: () => "MANUFACTURING" }));
vi.mock("../hooks/useReadableModules");

const renderGate = () =>
  render(
    <MemoryRouter>
      <ModuleAccessGate moduleKey="costing">
        <p>costing page</p>
      </ModuleAccessGate>
    </MemoryRouter>,
  );

describe("ModuleAccessGate", () => {
  it("shows a 403 page when the module is not readable", () => {
    vi.mocked(readable.useReadableModules).mockReturnValue(["leads"]);
    renderGate();
    expect(screen.getByText("403")).toBeTruthy();
    expect(screen.queryByText("costing page")).toBeNull();
  });

  it("renders the page when readable", () => {
    vi.mocked(readable.useReadableModules).mockReturnValue(["costing"]);
    renderGate();
    expect(screen.getByText("costing page")).toBeTruthy();
  });

  it("fails open while loading", () => {
    vi.mocked(readable.useReadableModules).mockReturnValue(null);
    renderGate();
    expect(screen.getByText("costing page")).toBeTruthy();
  });
});
