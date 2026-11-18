import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { LoadError } from "../components/shared/LoadError";

describe("LoadError", () => {
  it("shows the message as an alert and retries on click", async () => {
    const onRetry = vi.fn();
    render(<LoadError message="Could not load payments." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load payments.");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when there is no handler", () => {
    render(<LoadError message="Nope" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
