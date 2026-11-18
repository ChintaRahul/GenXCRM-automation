import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlantSelect } from "../components/module/PlantSelect";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("PlantSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled until an account is chosen", () => {
    render(<PlantSelect id="plant" accountId="" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("option", { name: /choose an account first/i })).toBeInTheDocument();
    expect(modulesApi.getModuleTable).not.toHaveBeenCalled();
  });

  it("offers only the chosen account's plants", async () => {
    vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns: [], rows: [{ name: "Plant 1" }, { name: "Plant 2" }] });
    render(<PlantSelect id="plant" accountId="A-1" value="" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Plant 2" })).toBeInTheDocument());
    expect(modulesApi.getModuleTable).toHaveBeenCalledWith("accounts", "A-1", "plants");
  });

  it("says so when the account has no plants", async () => {
    vi.mocked(modulesApi.getModuleTable).mockResolvedValue({ columns: [], rows: [] });
    render(<PlantSelect id="plant" accountId="A-1" value="" onChange={vi.fn()} />);
    expect(await screen.findByRole("option", { name: /no plants on this account/i })).toBeInTheDocument();
  });
});
