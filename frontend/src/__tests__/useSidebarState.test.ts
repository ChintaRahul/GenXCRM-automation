import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useSidebarState } from "../hooks/useSidebarState";

describe("useSidebarState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to expanded with no groups open", () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.isGroupOpen("engage")).toBe(false);
  });

  it("toggling collapsed persists across a remount", () => {
    const { result, unmount } = renderHook(() => useSidebarState());
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    unmount();

    const { result: result2 } = renderHook(() => useSidebarState());
    expect(result2.current.collapsed).toBe(true);
  });

  it("toggling a group open persists across a remount", () => {
    const { result, unmount } = renderHook(() => useSidebarState());
    act(() => result.current.toggleGroup("engage"));
    expect(result.current.isGroupOpen("engage")).toBe(true);
    unmount();

    const { result: result2 } = renderHook(() => useSidebarState());
    expect(result2.current.isGroupOpen("engage")).toBe(true);
  });

  it("toggling an open group closes it", () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.toggleGroup("engage"));
    expect(result.current.isGroupOpen("engage")).toBe(true);
    act(() => result.current.toggleGroup("engage"));
    expect(result.current.isGroupOpen("engage")).toBe(false);
  });

  it("ensureGroupOpen opens a closed group and persists it, and is a no-op if already open", () => {
    const { result, unmount } = renderHook(() => useSidebarState());
    act(() => result.current.ensureGroupOpen("workspace"));
    expect(result.current.isGroupOpen("workspace")).toBe(true);
    unmount();

    const { result: result2 } = renderHook(() => useSidebarState());
    expect(result2.current.isGroupOpen("workspace")).toBe(true);
    act(() => result2.current.ensureGroupOpen("workspace"));
    expect(result2.current.isGroupOpen("workspace")).toBe(true);
  });

  it("ignores a corrupted localStorage value instead of throwing", () => {
    localStorage.setItem("sidebarNavState", "{not json");
    expect(() => renderHook(() => useSidebarState())).not.toThrow();
  });

  it("seeds openGroups from defaultOpenGroups when no localStorage value exists yet", () => {
    const { result } = renderHook(() => useSidebarState(["enrolment", "finance"]));
    expect(result.current.isGroupOpen("enrolment")).toBe(true);
    expect(result.current.isGroupOpen("finance")).toBe(true);
    expect(result.current.isGroupOpen("engage")).toBe(false);
  });

  it("does not override an explicit prior 'all closed' choice with defaultOpenGroups", () => {
    localStorage.setItem("sidebarNavState", JSON.stringify({ collapsed: false, openGroups: [] }));
    const { result } = renderHook(() => useSidebarState(["enrolment", "finance"]));
    expect(result.current.isGroupOpen("enrolment")).toBe(false);
    expect(result.current.isGroupOpen("finance")).toBe(false);
  });
});
