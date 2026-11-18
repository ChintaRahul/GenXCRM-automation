import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  LineItemsTable,
  type RegistrationLineItem,
} from "../components/invoices/LineItemsTable";
import type { Course } from "../types";

const mockCourses: Course[] = [
  {
    id: "c1",
    name: "Full Stack Web Dev",
    category: "PROFESSIONAL_SKILLS",
    defaultPrice: 45000,
    isActive: true,
    source: "MANUAL",
    batches: [
      {
        id: "b1",
        courseId: "c1",
        label: "Batch A – Morning",
        schedule: "Mon/Wed/Fri · 7–9 AM",
        tutor: { id: "t1", name: "Ms. Rao", isActive: true },
        capacity: 25,
        seats: 10,
      },
      {
        id: "b2",
        courseId: "c1",
        label: "Batch B – Evening",
        schedule: "Tue/Thu · 6–8 PM",
        tutor: { id: "t2", name: "Mr. Shah", isActive: true },
        capacity: 25,
        seats: 5,
      },
    ],
  },
  {
    id: "c2",
    name: "Data Science",
    category: "PROFESSIONAL_SKILLS",
    defaultPrice: 60000,
    isActive: true,
    source: "MANUAL",
    batches: [],
  },
];

const oneRow: RegistrationLineItem[] = [
  { courseName: "", quantity: 1, unitPrice: 0 },
];

describe("LineItemsTable", () => {
  it("renders one row per line item", () => {
    render(
      <LineItemsTable
        lineItems={oneRow}
        courses={mockCourses}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2); // qty + unit price
  });

  it("hides the remove button when only one row remains", () => {
    render(
      <LineItemsTable
        lineItems={oneRow}
        courses={mockCourses}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Remove line item")).toBeNull();
  });

  it("shows a remove button per row once there are 2+ rows", () => {
    const twoRows: RegistrationLineItem[] = [
      { courseName: "", quantity: 1, unitPrice: 0 },
      { courseName: "", quantity: 1, unitPrice: 0 },
    ];
    render(
      <LineItemsTable
        lineItems={twoRows}
        courses={mockCourses}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("Remove line item")).toHaveLength(2);
  });

  it("calls onChange with an appended blank row on '+ Add line item'", () => {
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={oneRow}
        courses={mockCourses}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("+ Add line item"));
    expect(onChange).toHaveBeenCalledWith([
      ...oneRow,
      { courseName: "", quantity: 1, unitPrice: 0 },
    ]);
  });

  it("calls onChange with the remaining rows when removing a row", () => {
    const twoRows: RegistrationLineItem[] = [
      {
        courseId: "c1",
        courseName: "Full Stack Web Dev",
        quantity: 1,
        unitPrice: 45000,
      },
      {
        courseId: "c2",
        courseName: "Data Science",
        quantity: 1,
        unitPrice: 60000,
      },
    ];
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={twoRows}
        courses={mockCourses}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByLabelText("Remove line item")[0]);
    expect(onChange).toHaveBeenCalledWith([twoRows[1]]);
  });

  it("selecting a course prefills the unit price and courseName", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={oneRow}
        courses={mockCourses}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("Data Science")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Data Science"));

    expect(onChange).toHaveBeenCalledWith([
      {
        courseId: "c2",
        courseName: "Data Science",
        quantity: 1,
        unitPrice: 60000,
      },
    ]);
  });

  it("editing quantity recomputes the displayed line total", () => {
    const row: RegistrationLineItem[] = [
      {
        courseId: "c1",
        courseName: "Full Stack Web Dev",
        quantity: 1,
        unitPrice: 100,
      },
    ];
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={row}
        courses={mockCourses}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("₹100")).toBeInTheDocument();

    const qtyInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(qtyInput, { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith([{ ...row[0], quantity: 3 }]);
  });

  it("editing unit price recomputes the displayed line total", () => {
    const row: RegistrationLineItem[] = [
      {
        courseId: "c1",
        courseName: "Full Stack Web Dev",
        quantity: 2,
        unitPrice: 100,
      },
    ];
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={row}
        courses={mockCourses}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("₹200")).toBeInTheDocument();

    const priceInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(priceInput, { target: { value: "150" } });
    expect(onChange).toHaveBeenCalledWith([{ ...row[0], unitPrice: 150 }]);
  });

  it("selecting a course with batches defaults the batch to its first option", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={oneRow}
        courses={mockCourses}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("Full Stack Web Dev")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Full Stack Web Dev"));

    expect(onChange).toHaveBeenCalledWith([
      {
        courseId: "c1",
        courseName: "Full Stack Web Dev",
        unitPrice: 45000,
        batchId: "b1",
        batchLabel: "Batch A – Morning",
        quantity: 1,
      },
    ]);
  });

  it("renders the tutor/schedule caption for the selected batch", () => {
    const row: RegistrationLineItem[] = [
      {
        courseId: "c1",
        courseName: "Full Stack Web Dev",
        batchId: "b1",
        batchLabel: "Batch A – Morning",
        quantity: 1,
        unitPrice: 45000,
      },
    ];
    render(
      <LineItemsTable
        lineItems={row}
        courses={mockCourses}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Tutor: Ms. Rao · Mon/Wed/Fri · 7–9 AM"),
    ).toBeInTheDocument();
  });

  it("changing only the batch leaves price and quantity untouched", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const row: RegistrationLineItem[] = [
      {
        courseId: "c1",
        courseName: "Full Stack Web Dev",
        batchId: "b1",
        batchLabel: "Batch A – Morning",
        quantity: 2,
        unitPrice: 45000,
      },
    ];
    const onChange = vi.fn();
    render(
      <LineItemsTable
        lineItems={row}
        courses={mockCourses}
        onChange={onChange}
      />,
    );

    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[1]); // batch select is the second combobox in the row
    await waitFor(() =>
      expect(screen.getByText("Batch B – Evening")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Batch B – Evening"));

    expect(onChange).toHaveBeenCalledWith([
      { ...row[0], batchId: "b2", batchLabel: "Batch B – Evening" },
    ]);
  });

  // SCRUM-47: a controlled number input whose value stays the literal number 0 renders
  // "0" in the DOM; typing then appends after it (React only re-syncs node.value when the
  // *parsed* number differs, so "0" + "2" => "02" survives even though Number("02") === 2
  // hasn't changed the underlying unitPrice yet on that same keystroke) — producing
  // "025000" instead of "25000". Rendering "" instead of a literal 0 (same fix already
  // applied to RegistrationFeeCard's fee input) avoids the leading zero entirely.
  it("renders an empty unit price input (not a literal '0') for a new blank line item", () => {
    render(
      <LineItemsTable lineItems={oneRow} courses={mockCourses} onChange={vi.fn()} />,
    );
    const priceInput = screen.getAllByRole("spinbutton")[1] as HTMLInputElement;
    expect(priceInput.value).toBe("");
    expect(priceInput.placeholder).toBe("0");
  });

  it("typing into a blank unit price field replaces the zero rather than prepending to it", () => {
    const onChange = vi.fn();
    render(
      <LineItemsTable lineItems={oneRow} courses={mockCourses} onChange={onChange} />,
    );
    const priceInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(priceInput, { target: { value: "25000" } });
    expect(onChange).toHaveBeenCalledWith([{ ...oneRow[0], unitPrice: 25000 }]);
  });

  it("clearing the unit price field back to empty stores 0, not NaN", () => {
    const row: RegistrationLineItem[] = [
      { courseId: "c1", courseName: "Full Stack Web Dev", quantity: 1, unitPrice: 45000 },
    ];
    const onChange = vi.fn();
    render(<LineItemsTable lineItems={row} courses={mockCourses} onChange={onChange} />);
    const priceInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(priceInput, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith([{ ...row[0], unitPrice: 0 }]);
  });

  it("does not render a batch select when the selected course has no batches", () => {
    const row: RegistrationLineItem[] = [
      {
        courseId: "c2",
        courseName: "Data Science",
        quantity: 1,
        unitPrice: 60000,
      },
    ];
    render(
      <LineItemsTable
        lineItems={row}
        courses={mockCourses}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("combobox")).toHaveLength(1); // course select only
  });
});
