import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCourses } from "../hooks/useCourses";
import * as client from "../api/client";
import { Messages } from "../lib/messages";

vi.mock("../api/client");

const mockCourse = {
  id: "c1",
  name: "Full Stack Web Development",
  category: "PROFESSIONAL_SKILLS" as const,
  defaultPrice: 50000,
  isActive: true,
  source: "MANUAL" as const,
  batches: [],
};

describe("useCourses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns courses on successful fetch", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([mockCourse]);
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.courses).toHaveLength(1);
    expect(result.current.courses[0].name).toBe("Full Stack Web Development");
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getCourses).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.courses);
    expect(result.current.courses).toHaveLength(0);
  });

  it("starts loading true and resolves to false", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([]);
    const { result } = renderHook(() => useCourses());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("refetch re-triggers the API call", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([mockCourse]);
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.refetch();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getCourses).toHaveBeenCalledTimes(2);
  });
});
