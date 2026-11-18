import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { Share2 } from "lucide-react";
import {
  SourceCard,
  type ProviderMeta,
} from "../components/integrations/SourceCard";
import type { OrgIntegrationInfo } from "../types";

const realProvider: ProviderMeta = {
  key: "facebook",
  name: "Meta Ads",
  desc: "Facebook lead forms.",
  brand: "#1877F2",
  icon: Share2,
  real: true,
  tab: "facebook",
};

const placeholderProvider: ProviderMeta = {
  key: "whatsapp",
  name: "WhatsApp Business",
  desc: "Chat leads.",
  brand: "#25D366",
  icon: Share2,
  real: false,
};

const connectedStatus: OrgIntegrationInfo = {
  provider: "FACEBOOK",
  status: "CONNECTED",
  accountName: "Acme EdTech",
  maskedAccountId: "act_447",
};

describe("SourceCard", () => {
  it("renders a connected real provider with account footer and opens its tab", () => {
    const onOpen = vi.fn();
    render(
      <SourceCard provider={realProvider} status={connectedStatus} onOpen={onOpen} />,
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/Acme EdTech/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("facebook");
  });

  it("shows 'Action needed' for ERROR status", () => {
    render(
      <SourceCard
        provider={realProvider}
        status={{ ...connectedStatus, status: "ERROR" }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Action needed")).toBeInTheDocument();
  });

  it("shows 'Not connected' and no footer when a real provider has no status", () => {
    render(<SourceCard provider={realProvider} onOpen={vi.fn()} />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText(/Acme EdTech/)).not.toBeInTheDocument();
  });

  it("renders a placeholder as a non-interactive 'Coming soon' card", () => {
    render(<SourceCard provider={placeholderProvider} onOpen={vi.fn()} />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("derives the webhook footer from webhookInfo", () => {
    const webhookProvider: ProviderMeta = {
      key: "webhook",
      name: "Generic webhook",
      desc: "Signed endpoint.",
      brand: "hsl(var(--primary))",
      icon: Share2,
      real: true,
      tab: "webhook",
    };
    const { rerender } = render(
      <SourceCard
        provider={webhookProvider}
        webhookInfo={{ webhookUrl: "https://x/y", webhookSecret: null }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Endpoint ready")).toBeInTheDocument();
    rerender(
      <SourceCard provider={webhookProvider} webhookInfo={null} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("Not set up")).toBeInTheDocument();
  });
});
