import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import App from "../App";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const baseUser: User = {
  id: "u1",
  name: "Invited Rep",
  email: "rep@co.com",
  role: "SALES_REP",
  teamId: null,
  orgId: "org-1",
};

describe("App — forced first-login password gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, "", "/");
  });

  it("redirects an authenticated user with mustChangePassword to the change-password screen", async () => {
    vi.mocked(client.getMe).mockResolvedValue({ ...baseUser, mustChangePassword: true });
    localStorage.setItem("token", "valid-token");

    render(<App />);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /set your password/i }),
      ).toBeInTheDocument(),
    );
  });
});
