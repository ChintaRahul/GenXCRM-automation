import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleImport } from "../hooks/useModuleImport";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const fields = [
  { key: "company", label: "Company" },
  { key: "contactName", label: "Contact name" },
  { key: "phone", label: "Phone" },
];
const aliases = { Mobile: "phone" };
// jsdom's File has no text(); give the test file one.
const csv = (text: string) => Object.assign(new File([text], "leads.csv", { type: "text/csv" }), { text: async () => text });

describe("useModuleImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps headings to fields (by label, key or alias) and sends the rows", async () => {
    vi.mocked(modulesApi.importModuleRows).mockResolvedValue({ imported: 1, duplicates: 0, errors: [] });
    const onDone = vi.fn();
    const { result } = renderHook(() => useModuleImport("leads", fields, aliases, onDone));
    await act(() => result.current.importFile(csv("﻿Company,Contact name,Mobile\nAcme,Meera,98220\n")));
    expect(modulesApi.importModuleRows).toHaveBeenCalledWith("leads", [{ company: "Acme", contactName: "Meera", phone: "98220" }]);
    await waitFor(() => expect(result.current.result).toEqual({ imported: 1, duplicates: 0, errors: [] }));
    expect(onDone).toHaveBeenCalled();
  });

  it("does not refresh the list when nothing was added", async () => {
    vi.mocked(modulesApi.importModuleRows).mockResolvedValue({ imported: 0, duplicates: 1, errors: [] });
    const onDone = vi.fn();
    const { result } = renderHook(() => useModuleImport("leads", fields, aliases, onDone));
    await act(() => result.current.importFile(csv("Company,Phone\nAcme,98220\n")));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows an error and sends nothing for a file without rows", async () => {
    const { result } = renderHook(() => useModuleImport("leads", fields, aliases, vi.fn()));
    await act(() => result.current.importFile(csv("Company,Phone\n")));
    expect(modulesApi.importModuleRows).not.toHaveBeenCalled();
  });

  it("reports a failed request without crashing", async () => {
    vi.mocked(modulesApi.importModuleRows).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useModuleImport("leads", fields, aliases, vi.fn()));
    await act(() => result.current.importFile(csv("Company,Phone\nAcme,98220\n")));
    expect(result.current.result).toBeNull();
    expect(result.current.importing).toBe(false);
  });
});
