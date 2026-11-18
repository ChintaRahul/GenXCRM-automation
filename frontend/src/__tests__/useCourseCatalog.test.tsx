import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { useCourseCatalog } from "../hooks/useCourseCatalog";
import * as client from "../api/client";
import { Messages } from "../lib/messages";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const mockCourse = {
  id: "c1",
  name: "IELTS Prep",
  category: "TEST_PREP" as const,
  defaultPrice: 45000,
  isActive: true,
  source: "MANUAL" as const,
  batches: [],
};

describe("useCourseCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns courses on successful fetch", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([mockCourse]);
    const { result } = renderHook(() => useCourseCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.courses).toEqual([mockCourse]);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getCourses).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useCourseCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.courses);
  });

  it("updateCourse calls the API with the id and patch, then refetches", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([mockCourse]);
    vi.mocked(client.updateCourse).mockResolvedValue({
      ...mockCourse,
      name: "IELTS Prep – Intensive",
    });
    const { result } = renderHook(() => useCourseCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCourse("c1", {
        name: "IELTS Prep – Intensive",
      });
    });

    expect(client.updateCourse).toHaveBeenCalledWith("c1", {
      name: "IELTS Prep – Intensive",
    });
    expect(client.getCourses).toHaveBeenCalledTimes(2);
  });

  it("addCourse creates a course with the given payload, refetches, and toasts success", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([]);
    vi.mocked(client.createCourse).mockResolvedValue(mockCourse);
    const { result } = renderHook(() => useCourseCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created;
    await act(async () => {
      created = await result.current.addCourse({
        name: "IELTS Prep",
        category: "TEST_PREP",
        defaultPrice: 45000,
      });
    });

    expect(client.createCourse).toHaveBeenCalledWith({
      name: "IELTS Prep",
      category: "TEST_PREP",
      defaultPrice: 45000,
    });
    expect(client.getCourses).toHaveBeenCalledTimes(2);
    expect(created).toEqual(mockCourse);
    expect(toast.success).toHaveBeenCalledWith(Messages.courses.created);
  });

  it("addCourse toasts an error and returns undefined on failure", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([]);
    vi.mocked(client.createCourse).mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useCourseCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created;
    await act(async () => {
      created = await result.current.addCourse({
        name: "IELTS Prep",
        defaultPrice: 45000,
      });
    });

    expect(created).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(Messages.courses.createFailed);
  });

  it("addBatch calls the API scoped to the course, then refetches", async () => {
    vi.mocked(client.getCourses).mockResolvedValue([mockCourse]);
    vi.mocked(client.addBatch).mockResolvedValue({
      id: "b1",
      courseId: "c1",
      label: "Batch A",
      schedule: "Mon",
      capacity: 20,
      seats: 0,
    });
    const { result } = renderHook(() => useCourseCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addBatch("c1", {
        label: "Batch A",
        schedule: "Mon",
        tutorId: "t1",
        capacity: 20,
      });
    });

    expect(client.addBatch).toHaveBeenCalledWith("c1", {
      label: "Batch A",
      schedule: "Mon",
      tutorId: "t1",
      capacity: 20,
    });
    expect(client.getCourses).toHaveBeenCalledTimes(2);
  });
});
