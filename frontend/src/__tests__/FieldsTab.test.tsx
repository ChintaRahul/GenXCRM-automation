import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FieldsTab } from "../components/module/FieldsTab";
import { REGISTRY } from "../modules/registry";

describe("FieldsTab", () => {
  it("shows date fields as a readable date, not a raw ISO string", () => {
    render(
      <MemoryRouter>
        <FieldsTab moduleDef={REGISTRY.visits} record={{ id: "SV-1", visitDate: "2027-04-20T00:00:00.000Z", objective: "Survey" }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("20 Apr 2027")).toBeInTheDocument();
    expect(screen.queryByText(/T00:00:00/)).not.toBeInTheDocument();
  });

  it("shows money fields formatted like the list, not as a bare number", () => {
    render(
      <MemoryRouter>
        <FieldsTab moduleDef={REGISTRY.leads} record={{ id: "LD-1", company: "Acme", value: 1500000 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("₹15.0 L")).toBeInTheDocument();
  });

  it("shows a percentage field with its % sign", () => {
    render(
      <MemoryRouter>
        <FieldsTab moduleDef={REGISTRY.opps} record={{ id: "OP-1", title: "Deal", prob: 60 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("60%")).toBeInTheDocument();
  });
});
