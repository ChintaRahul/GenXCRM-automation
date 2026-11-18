import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePlatformPlan } from "../hooks/usePlatformPlan";
import * as client from "../api/client";

vi.mock("../api/client");

const plan = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Pro",
  pricePerUser: 499,
  minUsers: 2,
  isActive: true,
  ...over,
});

describe("usePlatformPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when disabled", () => {
    const { result } = renderHook(() => usePlatformPlan(false));
    expect(client.getBillingPlans).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("returns the plan when exactly one active plan exists", async () => {
    vi.mocked(client.getBillingPlans).mockResolvedValue([plan(), plan({ id: "p2", isActive: false })] as never);
    const { result } = renderHook(() => usePlatformPlan(true));
    await waitFor(() => expect(result.current).toEqual({ name: "Pro", pricePerUser: 499, minUsers: 2 }));
  });

  it("returns null when there are several active plans (no obvious default)", async () => {
    vi.mocked(client.getBillingPlans).mockResolvedValue([plan(), plan({ id: "p2", name: "Growth" })] as never);
    const { result } = renderHook(() => usePlatformPlan(true));
    await waitFor(() => expect(client.getBillingPlans).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("treats a minimum below 1 as 1 seat", async () => {
    vi.mocked(client.getBillingPlans).mockResolvedValue([plan({ minUsers: 0 })] as never);
    const { result } = renderHook(() => usePlatformPlan(true));
    await waitFor(() => expect(result.current?.minUsers).toBe(1));
  });

  it("returns null when the plan fetch fails", async () => {
    vi.mocked(client.getBillingPlans).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePlatformPlan(true));
    await waitFor(() => expect(client.getBillingPlans).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
