import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LookupSelect } from "../components/module/LookupSelect";

vi.mock("../lib/lookupNames", () => ({
  useLookupName: (_source: string | undefined, id: unknown) => String(id ?? ""),
  useLookupOptions: () => ({
    loading: false,
    options: [
      { id: "c-1", label: "Active Anil" },
      { id: "c-2", label: "Gone Gita", inactive: true },
    ],
  }),
}));

describe("LookupSelect", () => {
  it("does not offer inactive records for a new choice", () => {
    render(<LookupSelect id="x" source="contacts" value="" onChange={vi.fn()} placeholder="Select…" />);
    expect(screen.getByRole("option", { name: "Active Anil" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Gone Gita" })).not.toBeInTheDocument();
  });

  it("keeps an already-chosen inactive record visible so the form still shows it", () => {
    render(<LookupSelect id="x" source="contacts" value="c-2" onChange={vi.fn()} placeholder="Select…" />);
    expect(screen.getByRole("option", { name: "Gone Gita" })).toBeInTheDocument();
  });
});
