import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  SourcesGrid,
  PROVIDER_COUNT,
} from "../components/integrations/SourcesGrid";
import type { IntegrationProvider, OrgIntegrationInfo } from "../types";

function makeGetStatus(connected: IntegrationProvider[] = []) {
  return (p: IntegrationProvider): OrgIntegrationInfo | undefined =>
    connected.includes(p)
      ? {
          provider: p,
          status: "CONNECTED",
          accountName: "Acct",
          maskedAccountId: "id",
        }
      : undefined;
}

describe("SourcesGrid", () => {
  it("renders all providers with 2 'Coming soon' placeholders (WhatsApp, Email and Google Forms are now live)", () => {
    render(
      <SourcesGrid onOpen={vi.fn()} getStatus={makeGetStatus()} webhookInfo={null} />,
    );
    expect(screen.getByText("Meta Ads")).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    // WhatsApp should now render "Not connected" (live provider without connection) instead of "Coming soon"
    expect(screen.getByText("WhatsApp Business")).toBeInTheDocument();
    // Verify WhatsApp is a button (clickable, real provider) not a div (placeholder)
    const whatsappButton = screen.getByText("WhatsApp Business").closest("button");
    expect(whatsappButton).toBeInTheDocument();
    // Email is also a live provider now, not a "Coming soon" placeholder
    const emailButton = screen.getByText("Email (SMTP / your domain)").closest("button");
    expect(emailButton).toBeInTheDocument();
    expect(PROVIDER_COUNT).toBe(9);
  });

  it("derives the connected count from getStatus", () => {
    render(
      <SourcesGrid
        onOpen={vi.fn()}
        getStatus={makeGetStatus(["FACEBOOK"])}
        webhookInfo={null}
      />,
    );
    expect(screen.getByText(/1 connected · 8 available/)).toBeInTheDocument();
  });

  it("opens a real provider's tab on click", () => {
    const onOpen = vi.fn();
    render(
      <SourcesGrid onOpen={onOpen} getStatus={makeGetStatus()} webhookInfo={null} />,
    );
    fireEvent.click(screen.getByText("Meta Ads"));
    expect(onOpen).toHaveBeenCalledWith("facebook");
  });
});
