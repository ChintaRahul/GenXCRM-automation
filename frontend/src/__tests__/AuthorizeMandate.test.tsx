import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import AuthorizeMandatePage from "../pages/AuthorizeMandate";

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/authorize-mandate${search}`]}>
      <AuthorizeMandatePage />
    </MemoryRouter>,
  );

describe("AuthorizeMandatePage", () => {
  it("offers to authorize when a session id is present", () => {
    renderAt("?s=subs_tok&m=sandbox");
    expect(screen.getByRole("button", { name: "Authorize now" })).toBeEnabled();
  });

  it("shows a thank-you after the redirect back from Cashfree", () => {
    renderAt("?done=1");
    expect(screen.getByText("Thank you")).toBeInTheDocument();
  });

  it("explains an incomplete link when there is no session id", () => {
    renderAt("");
    expect(screen.getByText("Link not valid")).toBeInTheDocument();
  });
});
