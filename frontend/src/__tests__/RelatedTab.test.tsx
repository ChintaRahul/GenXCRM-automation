import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RelatedTab } from "../components/module/RelatedTab";
import * as modulesApi from "../api/modules";
import type { ModuleTab } from "../modules/registry";

vi.mock("../api/modules");

const actsTab: ModuleTab = { key: "acts", label: "Activities", kind: "related", relatedModule: "activities" };

describe("RelatedTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fetched related records", async () => {
    vi.mocked(modulesApi.getModuleRelated).mockResolvedValue({
      data: [{ id: "T-1", subject: "Follow-up call", type: "Call" }],
      total: 1, page: 1, limit: 20, pages: 1,
    });
    render(<RelatedTab parentModuleKey="leads" parentId="LD-1" tab={actsTab} />);
    expect(await screen.findByText("Follow-up call")).toBeInTheDocument();
  });

  it("shows an inline error instead of throwing an unhandled rejection when the fetch fails", async () => {
    vi.mocked(modulesApi.getModuleRelated).mockRejectedValue(new Error("Network error"));
    render(<RelatedTab parentModuleKey="leads" parentId="LD-1" tab={actsTab} />);
    expect(await screen.findByText(/couldn.t load activities/i)).toBeInTheDocument();
  });

  it("shows the no-access message when the fetch is forbidden", async () => {
    const err = Object.assign(new Error("Forbidden"), { isAxiosError: true, response: { status: 403 } });
    vi.mocked(modulesApi.getModuleRelated).mockRejectedValue(err);
    render(<RelatedTab parentModuleKey="opportunities" parentId="OP-1" tab={actsTab} />);
    expect(await screen.findByText(/don.t have access/i)).toBeInTheDocument();
  });
});
