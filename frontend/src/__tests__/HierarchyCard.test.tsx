import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HierarchyCard } from "../components/leadDetail/HierarchyCard";
import * as authCtx from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

function mockAuth(userId: string) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: userId, name: "Me", email: "me@t.com", role: "SALES_REP", teamId: "t1" },
    token: "tok",
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
    isImpersonating: false,
    impersonate: vi.fn(),
    exitImpersonation: vi.fn(),
  });
}

describe("HierarchyCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when the chain is undefined", () => {
    mockAuth("u1");
    render(<HierarchyCard chain={undefined} />);
    expect(screen.getByText("No hierarchy on record")).toBeInTheDocument();
  });

  it("omits rows whose chain member is null", () => {
    mockAuth("u1");
    render(
      <HierarchyCard
        chain={{
          director: null,
          manager: { id: "mgr-1", name: "Manager One" },
          owner: { id: "rep-1", name: "Rep One" },
        }}
      />,
    );
    expect(screen.queryByText("Director")).toBeNull();
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("marks the signed-in caller's own row with '(you)'", () => {
    mockAuth("rep-1");
    render(
      <HierarchyCard
        chain={{
          director: { id: "dir-1", name: "Director One" },
          manager: { id: "mgr-1", name: "Manager One" },
          owner: { id: "rep-1", name: "Rep One" },
        }}
      />,
    );
    expect(screen.getByText("Rep One (you)")).toBeInTheDocument();
    expect(screen.getByText("Director One")).toBeInTheDocument();
  });
});
