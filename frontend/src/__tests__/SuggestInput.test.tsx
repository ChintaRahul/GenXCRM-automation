import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SuggestInput } from "../components/module/SuggestInput";

const OPTIONS = ["Pune", "Chennai"];
const setup = (value = "", onChange = vi.fn()) => {
  render(<SuggestInput id="city" label="City" value={value} options={OPTIONS} onChange={onChange} />);
  return onChange;
};

describe("SuggestInput", () => {
  it("lists the options plus 'Other — type your own…' as the last one", () => {
    setup();
    const labels = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["Select city…", "Pune", "Chennai", "Other — type your own…"]);
  });

  it("reports a chosen option", () => {
    const onChange = setup();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Pune" } });
    expect(onChange).toHaveBeenCalledWith("Pune");
  });

  it("switches to a text box on 'Other' and back with '← Choose from list'", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SuggestInput id="city" label="City" value="" options={OPTIONS} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__other" } });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    rerender(<SuggestInput id="city" label="City" value="Nagpur" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /choose from list/i }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("opens straight in the text box for a saved value that isn't in the list", () => {
    setup("Nagpur");
    expect(screen.getByRole("textbox")).toHaveValue("Nagpur");
  });
});
