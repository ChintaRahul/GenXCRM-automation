import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import React from "react";
import { StatCard } from "../components/shared/StatCard";
import { Target } from "lucide-react";

const icon = <Target className="w-5 h-5" />;

describe("StatCard", () => {
  it("renders title and value", () => {
    render(<StatCard title="Total Leads" value="2,847" icon={icon} />);
    expect(screen.getByText("Total Leads")).toBeInTheDocument();
    expect(screen.getByText("2,847")).toBeInTheDocument();
  });

  it("renders trend-up pill with green classes", () => {
    render(
      <StatCard
        title="New Today"
        value={42}
        icon={icon}
        trend={{ value: "+12.4%", up: true }}
      />,
    );
    const pill = screen.getByText("+12.4%");
    expect(pill).toHaveClass("bg-green-500/10");
    expect(pill).toHaveClass("text-green-600");
  });

  it("renders trend-down pill with red classes", () => {
    render(
      <StatCard
        title="Churn"
        value={5}
        icon={icon}
        trend={{ value: "-3%", up: false }}
      />,
    );
    const pill = screen.getByText("-3%");
    expect(pill).toHaveClass("bg-red-500/10");
    expect(pill).toHaveClass("text-red-600");
  });

  it("renders subtitle below value", () => {
    render(
      <StatCard
        title="Revenue"
        value="₹18.4L"
        icon={icon}
        subtitle="vs. last 30d"
      />,
    );
    expect(screen.getByText("vs. last 30d")).toBeInTheDocument();
  });

  it("does not render value or title when loading", () => {
    render(<StatCard title="Revenue" value="₹18.4L" icon={icon} loading />);
    expect(screen.queryByText("₹18.4L")).not.toBeInTheDocument();
    expect(screen.queryByText("Revenue")).not.toBeInTheDocument();
  });

  it("renders as a link with a pointer cursor when `to` is provided", () => {
    render(
      <MemoryRouter>
        <StatCard title="Total Leads" value="2,847" icon={icon} to="/leads" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/leads");
    expect(link).toHaveClass("cursor-pointer");
  });

  it("renders as a plain div with no pointer cursor when `to` is omitted", () => {
    render(<StatCard title="Total Leads" value="2,847" icon={icon} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Total Leads").closest("div")).not.toHaveClass(
      "cursor-pointer",
    );
  });
});
