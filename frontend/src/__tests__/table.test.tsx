import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";

describe("Table primitive", () => {
  it("renders a table with header and body rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Acme Steel</TableCell>
            <TableCell>Active</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Acme Steel")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header row + 1 body row
  });

  it("forwards a className to the outer Table wrapper", () => {
    render(
      <Table className="custom-table-class">
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("table")).toHaveClass("custom-table-class");
  });
});
