import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTemplates } from "../hooks/useTemplates";
import * as client from "../api/client";
import type { MessageTemplate } from "../types";
import { Messages } from "../lib/messages";

vi.mock("../api/client");

const tpl: MessageTemplate = {
  id: "tpl-1",
  channel: "EMAIL",
  name: "Welcome",
  subject: "Hi",
  body: "Hello {{name}}",
  isSystem: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("useTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches templates on mount", async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([tpl]);
    const { result } = renderHook(() => useTemplates());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getTemplates).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.templates);
    expect(result.current.templates).toHaveLength(0);
  });

  it("creates and refetches", async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([]);
    vi.mocked(client.createTemplate).mockResolvedValue(tpl);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.create({ channel: "EMAIL", name: "Welcome", subject: "Hi", body: "Hello" });

    expect(client.createTemplate).toHaveBeenCalledWith({
      channel: "EMAIL",
      name: "Welcome",
      subject: "Hi",
      body: "Hello",
    });
    expect(client.getTemplates).toHaveBeenCalledTimes(2);
  });

  it("copies and refetches", async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([tpl]);
    vi.mocked(client.copyTemplate).mockResolvedValue({ ...tpl, id: "tpl-2", name: "Copy of Welcome" });
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const copied = await result.current.copy("tpl-1");

    expect(copied.id).toBe("tpl-2");
    expect(client.copyTemplate).toHaveBeenCalledWith("tpl-1");
    expect(client.getTemplates).toHaveBeenCalledTimes(2);
  });

  it("removes and refetches", async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([tpl]);
    vi.mocked(client.deleteTemplate).mockResolvedValue(undefined);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.remove("tpl-1");

    expect(client.deleteTemplate).toHaveBeenCalledWith("tpl-1");
    expect(client.getTemplates).toHaveBeenCalledTimes(2);
  });

  it("submits a template and refetches", async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([tpl]);
    vi.mocked(client.submitTemplate).mockResolvedValue({ ...tpl, status: "PENDING" });
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const submitted = await result.current.submit("tpl-1");

    expect(submitted.status).toBe("PENDING");
    expect(client.submitTemplate).toHaveBeenCalledWith("tpl-1");
    expect(client.getTemplates).toHaveBeenCalledTimes(2);
  });

  it("refreshes WhatsApp statuses and refetches", async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([tpl]);
    vi.mocked(client.refreshWhatsappTemplates).mockResolvedValue([tpl]);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.refreshWhatsapp();

    expect(client.refreshWhatsappTemplates).toHaveBeenCalled();
    expect(client.getTemplates).toHaveBeenCalledTimes(2);
  });
});
