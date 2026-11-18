import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleLines } from "../hooks/useModuleLines";
import * as modulesApi from "../api/modules";
import type { ModuleTab } from "../modules/registry";

vi.mock("../api/modules");

const TAB: ModuleTab = {
  key: "lines",
  label: "Lines",
  kind: "lines",
  lineColumns: [
    { key: "item", label: "Item", type: "text" },
    { key: "amount", label: "Amount", type: "money" },
  ],
} as const;

describe("useModuleLines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds rows from initialRows", () => {
    const { result } = renderHook(() => useModuleLines("quotes", "Q-1", TAB, [{ item: "Widget", amount: 100 }]));
    expect(result.current.rows).toEqual([{ item: "Widget", amount: 100 }]);
  });

  it("addRow appends a blank row with every lineColumns key present", () => {
    const { result } = renderHook(() => useModuleLines("quotes", "Q-1", TAB, []));
    act(() => result.current.addRow());
    expect(result.current.rows).toEqual([{ item: "", amount: "" }]);
  });

  it("removeRow removes the row at the given index", () => {
    const { result } = renderHook(() =>
      useModuleLines("quotes", "Q-1", TAB, [{ item: "A", amount: 1 }, { item: "B", amount: 2 }]),
    );
    act(() => result.current.removeRow(0));
    expect(result.current.rows).toEqual([{ item: "B", amount: 2 }]);
  });

  it("setCell updates one field of one row", () => {
    const { result } = renderHook(() => useModuleLines("quotes", "Q-1", TAB, [{ item: "A", amount: 1 }]));
    act(() => result.current.setCell(0, "amount", "50"));
    expect(result.current.rows[0].amount).toBe("50");
  });

  it("save posts the row array via updateModuleRecord under the tab's key", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "Q-1" });
    const { result } = renderHook(() => useModuleLines("quotes", "Q-1", TAB, [{ item: "A", amount: 1 }]));
    await act(async () => {
      await result.current.save();
    });
    expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("quotes", "Q-1", { lines: [{ item: "A", amount: 1 }] });
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("save sets an error message on failure", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useModuleLines("quotes", "Q-1", TAB, []));
    await act(async () => {
      await result.current.save();
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("save sends numbers, drops blank cells/rows and unknown properties, and shows the server's message", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "Q-1" });
    const { result } = renderHook(() =>
      useModuleLines("quotes", "Q-1", TAB, [{ id: "ql-1", quotationId: "Q-1", item: "A", amount: "150" }, { item: "", amount: "" }]),
    );
    await act(async () => {
      await result.current.save();
    });
    expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("quotes", "Q-1", { lines: [{ item: "A", amount: 150 }] });

    vi.mocked(modulesApi.updateModuleRecord).mockRejectedValue({ response: { data: { message: ["qty must not be less than 1"] } } });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBe("qty must not be less than 1");
  });
  describe("line amounts and product defaults", () => {
    const QTAB: ModuleTab = {
      key: "lines",
      label: "Line items",
      kind: "lines",
      lineColumns: [
        { key: "productId", label: "Product", type: "text" },
        { key: "description", label: "Description", type: "text" },
        { key: "qty", label: "Qty", type: "num" },
        { key: "unitPrice", label: "Unit price", type: "money" },
        { key: "discountPct", label: "Discount %", type: "num" },
        { key: "amount", label: "Amount", type: "money" },
      ],
    } as const;

    it("works out the amount as qty × price × (1 − discount %) when those change", () => {
      const { result } = renderHook(() => useModuleLines("quotes", "Q-1", QTAB, [{ qty: "", unitPrice: "", discountPct: "", amount: "" }]));
      act(() => result.current.setCell(0, "qty", "2"));
      act(() => result.current.setCell(0, "unitPrice", "1000000"));
      expect(result.current.rows[0].amount).toBe(2000000);
      act(() => result.current.setCell(0, "discountPct", "12"));
      expect(result.current.rows[0].amount).toBe(1760000);
    });

    it("picking a product fills description, price and quantity when blank, and the amount", async () => {
      vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "P-1", description: "60T weighbridge", price: 500000 });
      const { result } = renderHook(() => useModuleLines("quotes", "Q-1", QTAB, [{ productId: "", description: "", qty: "", unitPrice: "", discountPct: "", amount: "" }]));
      await act(async () => {
        await result.current.setProduct(0, "P-1");
      });
      expect(result.current.rows[0]).toMatchObject({ productId: "P-1", description: "60T weighbridge", unitPrice: 500000, qty: 1, amount: 500000 });
    });

    it("keeps what was already typed when a product is picked", async () => {
      vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "P-1", description: "60T weighbridge", price: 500000 });
      const { result } = renderHook(() => useModuleLines("quotes", "Q-1", QTAB, [{ productId: "", description: "Custom", qty: 3, unitPrice: 400000, discountPct: "", amount: "" }]));
      await act(async () => {
        await result.current.setProduct(0, "P-1");
      });
      expect(result.current.rows[0]).toMatchObject({ description: "Custom", unitPrice: 400000, qty: 3 });
    });

    it("a failed product lookup still lets the line be entered by hand", async () => {
      vi.mocked(modulesApi.getModuleRecord).mockRejectedValue(new Error("403"));
      const { result } = renderHook(() => useModuleLines("quotes", "Q-1", QTAB, [{ productId: "", qty: "", unitPrice: "" }]));
      await act(async () => {
        await result.current.setProduct(0, "P-1");
      });
      expect(result.current.rows[0].productId).toBe("P-1");
    });

    it("hands the saved rows to onSaved so the page does not show stale lines", async () => {
      vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "Q-1" });
      const onSaved = vi.fn();
      const { result } = renderHook(() => useModuleLines("quotes", "Q-1", QTAB, [{ qty: 2, unitPrice: 100, amount: 200 }], onSaved));
      await act(async () => {
        await result.current.save();
      });
      expect(onSaved).toHaveBeenCalledWith([{ qty: 2, unitPrice: 100, amount: 200 }]);
    });
  });
});
