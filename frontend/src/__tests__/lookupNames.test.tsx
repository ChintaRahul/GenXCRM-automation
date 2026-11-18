import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "../api/client";
import * as modules from "../api/modules";

vi.mock("../api/client");
vi.mock("../api/modules");

// setup.ts stubs lib/lookupNames for every other test; this file needs the real thing.
const loadActual = () => vi.importActual<typeof import("../lib/lookupNames")>("../lib/lookupNames");

describe("lookupNames", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (await loadActual()).resetLookupNames();
  });

  it("shows the owner's name instead of their id", async () => {
    vi.mocked(client.getUserDirectory).mockResolvedValue([{ id: "u-1", name: "Asha Rep" }] as never);
    const { LookupName } = await loadActual();
    render(<LookupName source="owner" id="u-1" />);
    await waitFor(() => expect(screen.getByText("Asha Rep")).toBeInTheDocument());
  });

  it("resolves a reference through the referenced module's label field", async () => {
    vi.mocked(modules.getModuleList).mockResolvedValue({ data: [{ id: "acc-1", short: "Shree Steel" }] } as never);
    const { LookupName } = await loadActual();
    render(<LookupName source="accounts" id="acc-1" />);
    await waitFor(() => expect(screen.getByText("Shree Steel")).toBeInTheDocument());
  });

  it("fetches each source once even when many cells need it", async () => {
    vi.mocked(client.getUserDirectory).mockResolvedValue([{ id: "u-1", name: "Asha Rep" }] as never);
    const { LookupName } = await loadActual();
    render(
      <>
        <LookupName source="owner" id="u-1" />
        <LookupName source="owner" id="u-1" />
        <LookupName source="owner" id="u-1" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText("Asha Rep")).toHaveLength(3));
    expect(client.getUserDirectory).toHaveBeenCalledTimes(1);
  });

  it("falls back to a short id when the lookup fails, and an em dash when there is no id", async () => {
    vi.mocked(client.getUserDirectory).mockRejectedValue(new Error("403"));
    const { LookupName } = await loadActual();
    render(
      <>
        <LookupName source="owner" id="5a5626f7-9f53-45b7" />
        <span data-testid="empty">
          <LookupName source="owner" id={null} />
        </span>
      </>,
    );
    await waitFor(() => expect(screen.getByText("5a5626f7…")).toBeInTheDocument());
    expect(screen.getByTestId("empty")).toHaveTextContent("—");
  });

  it("marks inactive records so pickers can hide them while names still resolve", async () => {
    vi.mocked(modules.getModuleList).mockResolvedValue({
      data: [
        { id: "c-1", name: "Active Anil", status: "Active" },
        { id: "c-2", name: "Gone Gita", status: "Inactive" },
      ],
    } as never);
    const { useLookupOptions, LookupName } = await loadActual();
    const Probe = () => {
      const { options } = useLookupOptions("contacts");
      return <p data-testid="opts">{options.map((o) => `${o.label}:${o.inactive ? "inactive" : "active"}`).join(",")}</p>;
    };
    render(
      <>
        <Probe />
        <LookupName source="contacts" id="c-2" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("opts")).toHaveTextContent("Active Anil:active,Gone Gita:inactive"));
    expect(screen.getByText("Gone Gita", { selector: "span" })).toBeInTheDocument();
  });

  it("fetches a record that is beyond the first page of its module instead of showing a short id", async () => {
    vi.mocked(modules.getModuleList).mockResolvedValue({ data: [{ id: "acc-1", short: "Shree Steel" }] } as never);
    vi.mocked(modules.getModuleRecord).mockResolvedValue({ id: "acc-999", short: "Late Account" } as never);
    const { LookupName } = await loadActual();
    render(<LookupName source="accounts" id="acc-999" />);
    await waitFor(() => expect(screen.getByText("Late Account")).toBeInTheDocument());
    expect(modules.getModuleRecord).toHaveBeenCalledWith("accounts", "acc-999");
  });

  it("offers a record created after the list was first loaded once its cache is invalidated", async () => {
    vi.mocked(modules.getModuleList)
      .mockResolvedValueOnce({ data: [{ id: "acc-1", short: "Shree Steel" }], pages: 1 } as never)
      .mockResolvedValueOnce({ data: [{ id: "acc-1", short: "Shree Steel" }, { id: "acc-2", short: "Kiran Steel" }], pages: 1 } as never);
    const { useLookupOptions, invalidateLookup } = await loadActual();
    const Probe = () => {
      const { options } = useLookupOptions("accounts");
      return <p data-testid="opts">{options.map((o) => o.label).join(",")}</p>;
    };
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("opts")).toHaveTextContent("Shree Steel"));
    unmount();
    invalidateLookup("accounts");
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("opts")).toHaveTextContent("Kiran Steel,Shree Steel"));
  });

  it("loads every page of a module, not just the first hundred", async () => {
    vi.mocked(modules.getModuleList)
      .mockResolvedValueOnce({ data: [{ id: "acc-1", short: "Alpha" }], pages: 2 } as never)
      .mockResolvedValueOnce({ data: [{ id: "acc-2", short: "Beta" }], pages: 2 } as never);
    const { useLookupOptions } = await loadActual();
    const Probe = () => {
      const { options } = useLookupOptions("accounts");
      return <p data-testid="opts">{options.map((o) => o.label).join(",")}</p>;
    };
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("opts")).toHaveTextContent("Alpha,Beta"));
  });
});
