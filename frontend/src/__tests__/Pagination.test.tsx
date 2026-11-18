import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Pagination } from "../components/ui/pagination";

describe("Pagination", () => {
  it("renders nothing when there is only one page", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Previous on the first page and Next on the last page", () => {
    render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByText("Previous")).toBeDisabled();
    expect(screen.getByText("Next")).not.toBeDisabled();
  });

  it("calls onPageChange with the clicked page number", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText("2"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("shows an ellipsis for large page ranges", () => {
    render(<Pagination page={5} totalPages={20} onPageChange={vi.fn()} />);
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
  });

  it("jumps to a typed page number", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={20} onPageChange={onPageChange} />);
    fireEvent.change(screen.getByLabelText("Go to page"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onPageChange).toHaveBeenCalledWith(12);
  });

  it("clamps a typed page that is out of range", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={20} onPageChange={onPageChange} />);
    fireEvent.change(screen.getByLabelText("Go to page"), { target: { value: "999" } });
    fireEvent.submit(screen.getByLabelText("Go to page"));
    expect(onPageChange).toHaveBeenCalledWith(20);
  });
});
