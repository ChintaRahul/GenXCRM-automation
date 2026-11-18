import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTutors } from "../hooks/useTutors";
import * as client from "../api/client";
import { Messages } from "../lib/messages";

vi.mock("../api/client");

const mockTutor = { id: "t1", name: "Ms. Anjali Rao", isActive: true };

describe("useTutors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tutors on successful fetch", async () => {
    vi.mocked(client.getTutors).mockResolvedValue([mockTutor]);
    const { result } = renderHook(() => useTutors());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tutors).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getTutors).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useTutors());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.tutors);
  });

  it("refetches with includeArchived when toggled", async () => {
    vi.mocked(client.getTutors).mockResolvedValue([mockTutor]);
    const { result } = renderHook(() => useTutors());
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.setIncludeArchived(true);
    await waitFor(() => expect(client.getTutors).toHaveBeenLastCalledWith(true));
  });

  it("addTutor creates a tutor and refetches", async () => {
    vi.mocked(client.getTutors).mockResolvedValue([]);
    vi.mocked(client.createTutor).mockResolvedValue(mockTutor);
    const { result } = renderHook(() => useTutors());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addTutor("Ms. Anjali Rao");
    expect(client.createTutor).toHaveBeenCalledWith({ name: "Ms. Anjali Rao" });
    expect(client.getTutors).toHaveBeenCalledTimes(2);
  });

  it("addTutor shows a toast and returns undefined on failure", async () => {
    vi.mocked(client.getTutors).mockResolvedValue([]);
    vi.mocked(client.createTutor).mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useTutors());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const created = await result.current.addTutor("Ms. Anjali Rao");
    expect(created).toBeUndefined();
  });

  it("updateTutor toggles isActive and refetches", async () => {
    vi.mocked(client.getTutors).mockResolvedValue([mockTutor]);
    vi.mocked(client.updateTutor).mockResolvedValue({ ...mockTutor, isActive: false });
    const { result } = renderHook(() => useTutors());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.updateTutor("t1", { isActive: false });
    expect(client.updateTutor).toHaveBeenCalledWith("t1", { isActive: false });
    expect(client.getTutors).toHaveBeenCalledTimes(2);
  });
});
