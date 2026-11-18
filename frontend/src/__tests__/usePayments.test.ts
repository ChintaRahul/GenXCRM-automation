import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePayment } from "../hooks/usePayments";
import * as client from "../api/client";
import { Messages } from "../lib/messages";
import type { Payment } from "../types";

vi.mock("../api/client");

const mockPayment: Payment = {
  id: "pay-1",
  amount: 98000,
  currency: "INR",
  status: "PAID",
  gateway: "RAZORPAY",
  installments: [],
  lead: { id: "lead-1", name: "Sneha Patel", course: "Digital Marketing" },
  createdAt: "2026-08-28T00:00:00.000Z",
};

describe("usePayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the payment on successful fetch", async () => {
    vi.mocked(client.getPayment).mockResolvedValue(mockPayment);
    const { result } = renderHook(() => usePayment("pay-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.id).toBe("pay-1");
    expect(client.getPayment).toHaveBeenCalledWith("pay-1");
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getPayment).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => usePayment("pay-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.payments);
    expect(result.current.data).toBeNull();
  });

  it("refetches when the id changes", async () => {
    vi.mocked(client.getPayment).mockResolvedValue(mockPayment);
    const { rerender } = renderHook(({ id }) => usePayment(id), {
      initialProps: { id: "pay-1" },
    });
    await waitFor(() => expect(client.getPayment).toHaveBeenCalledWith("pay-1"));
    rerender({ id: "pay-2" });
    await waitFor(() => expect(client.getPayment).toHaveBeenCalledWith("pay-2"));
  });
});
