import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspaceRoute } from "../components/routing/WorkspaceRoute";
import * as useWorkspaceModule from "../hooks/useWorkspace";

vi.mock("../hooks/useWorkspace");

describe("WorkspaceRoute", () => {
  it("renders children when the workspace type matches", () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue("MANUFACTURING");
    render(
      <MemoryRouter initialEntries={["/accounts"]}>
        <Routes>
          <Route
            path="/accounts"
            element={
              <WorkspaceRoute allow="MANUFACTURING">
                <p>Accounts page</p>
              </WorkspaceRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Accounts page")).toBeInTheDocument();
  });

  it("redirects to / when the workspace type does not match", () => {
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue("EDTECH");
    render(
      <MemoryRouter initialEntries={["/accounts"]}>
        <Routes>
          <Route
            path="/accounts"
            element={
              <WorkspaceRoute allow="MANUFACTURING">
                <p>Accounts page</p>
              </WorkspaceRoute>
            }
          />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByText("Accounts page")).not.toBeInTheDocument();
  });
});
