import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { renderCell, renderSub, formatMoney, formatDate, displayId } from "../lib/moduleCells";
import type { ModuleColumn, ModuleDef } from "../modules/registry";

const MODULE_DEF = {
  title: "Accounts", idPrefix: "A-",
  statuses: [{ value: "Active", tone: "green" }],
  fields: [], cols: [], tabs: [],
} as unknown as ModuleDef;

describe("formatMoney", () => {
  it("formats crores", () => {
    expect(formatMoney(12500000)).toBe("₹1.25 Cr");
  });
  it("formats lakhs", () => {
    expect(formatMoney(250000)).toBe("₹2.5 L");
  });
  it("formats small amounts with INR grouping", () => {
    expect(formatMoney(4500)).toBe("₹4,500");
  });
  it("returns an em dash for non-numeric input", () => {
    expect(formatMoney(undefined)).toBe("—");
  });
});

describe("formatDate", () => {
  it("formats an ISO date string", () => {
    expect(formatDate("2026-09-28")).toBe("28 Sept 2026");
  });
  it("returns an em dash for an invalid date", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("renderCell", () => {
  it("renders a money column right-aligned and mono", () => {
    const col: ModuleColumn = { key: "value", label: "Value", type: "money" };
    render(<table><tbody><tr>{renderCell(col, { id: "1", value: 250000 }, MODULE_DEF)}</tr></tbody></table>);
    expect(screen.getByText("₹2.5 L")).toBeInTheDocument();
  });

  it("renders a status column using the module's status tone", () => {
    const col: ModuleColumn = { key: "status", label: "Status", type: "status" };
    render(<table><tbody><tr>{renderCell(col, { id: "1", status: "Active" }, MODULE_DEF)}</tr></tbody></table>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders a text column's sub-line when present", () => {
    const col: ModuleColumn = { key: "company", label: "Company", type: "text", sub: "contact" };
    render(<table><tbody><tr>{renderCell(col, { id: "1", company: "Acme", contact: "Jane" }, MODULE_DEF)}</tr></tbody></table>);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
  });
});

describe("renderCell — overdue dates and SLA", () => {
  const dueCol = { key: "dueDate", label: "Due", type: "date" } as ModuleColumn;
  const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

  it("flags an open record with a past due date as overdue", () => {
    render(<>{renderCell(dueCol, { id: "1", dueDate: past, status: "Open" }, MODULE_DEF)}</>);
    expect(screen.getByText(/Overdue/)).toHaveClass("text-destructive");
  });

  it("does not flag completed records or future dates", () => {
    render(
      <>
        {renderCell(dueCol, { id: "1", dueDate: past, status: "Completed" }, MODULE_DEF)}
        {renderCell(dueCol, { id: "2", dueDate: future, status: "Open" }, MODULE_DEF)}
      </>,
    );
    expect(screen.queryByText(/Overdue/)).toBeNull();
  });

  it("renders the sla object as a badge instead of [object Object]", () => {
    const col = { key: "sla", label: "Follow-up SLA", type: "sla" } as ModuleColumn;
    render(<>{renderCell(col, { id: "1", sla: { l: "Breached 3d", t: "red" } }, MODULE_DEF)}</>);
    expect(screen.getByText("Breached 3d")).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).toBeNull();
  });

  it("renders an em dash when there is no sla", () => {
    const col = { key: "sla", label: "Follow-up SLA", type: "sla" } as ModuleColumn;
    render(<>{renderCell(col, { id: "1", sla: null }, MODULE_DEF)}</>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("displayId", () => {
  it("turns a UUID into prefix + first six characters", () => {
    expect(displayId({ id: "84a04f11-d4a7-40fc-9428-9357a51f950a" }, MODULE_DEF)).toBe("A-84A04F");
  });
  it("leaves an id that already carries the prefix alone", () => {
    expect(displayId({ id: "A-0042" }, MODULE_DEF)).toBe("A-0042");
  });
});

describe("renderSub", () => {
  const OPP_DEF = {
    title: "Opportunities", idPrefix: "OP-", statuses: [], cols: [], tabs: [],
    fields: [
      { key: "accountId", label: "Account", type: "ref", ref: "accounts" },
      { key: "nextActionDate", label: "Next action date", type: "date" },
      { key: "note", label: "Note", type: "text" },
    ],
  } as unknown as ModuleDef;

  it("formats a date and passes plain text through", () => {
    render(<>{renderSub({ id: "1", nextActionDate: "2027-04-20T00:00:00.000Z", note: "hello" }, "nextActionDate", OPP_DEF)}</>);
    expect(screen.getByText("20 Apr 2027")).toBeInTheDocument();
    render(<>{renderSub({ id: "1", note: "hello" }, "note", OPP_DEF)}</>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});

describe("renderCell id columns", () => {
  const idCol = { key: "id", label: "ID", type: "id" } as ModuleColumn;
  const serialCol = { key: "serial", label: "Serial", type: "id" } as ModuleColumn;

  it("shows the record's own id in the short form", () => {
    render(<>{renderCell(idCol, { id: "84a04f11-aaaa" }, MODULE_DEF)}</>);
    expect(screen.getByText("A-84A04F")).toBeInTheDocument();
  });

  it("shows the real value of an id-type column on another field (an asset's serial number)", () => {
    render(<>{renderCell(serialCol, { id: "84a04f11-aaaa", serial: "WB-60-SN-0001" }, MODULE_DEF)}</>);
    expect(screen.getByText("WB-60-SN-0001")).toBeInTheDocument();
    expect(screen.queryByText("A-84A04F")).not.toBeInTheDocument();
  });

  it("falls back to the short id when that field is empty", () => {
    render(<>{renderCell(serialCol, { id: "84a04f11-aaaa", serial: "" }, MODULE_DEF)}</>);
    expect(screen.getByText("A-84A04F")).toBeInTheDocument();
  });
});
