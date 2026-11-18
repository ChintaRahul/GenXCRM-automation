import { describe, it, expect } from "vitest";
import { progressColor, repHealth } from "../lib/reports";

describe("progressColor", () => {
  it("returns green at or above 80%", () => {
    expect(progressColor(80)).toBe("bg-green-500");
    expect(progressColor(100)).toBe("bg-green-500");
  });

  it("returns primary between 60% and 80%", () => {
    expect(progressColor(60)).toBe("bg-primary");
    expect(progressColor(79)).toBe("bg-primary");
  });

  it("returns amber below 60%", () => {
    expect(progressColor(0)).toBe("bg-amber-500");
    expect(progressColor(59)).toBe("bg-amber-500");
  });
});

describe("repHealth", () => {
  it("returns 'track' when total is 0", () => {
    expect(repHealth({ total: 0, notEngaged: 0, untouched: 0, followupOverdue: 0 })).toBe("track");
  });

  it("flags 'coaching' when untouched ratio is high", () => {
    expect(repHealth({ total: 10, notEngaged: 0, untouched: 2, followupOverdue: 0 })).toBe("coaching");
  });

  it("flags 'coaching' when followupOverdue ratio is high", () => {
    expect(repHealth({ total: 10, notEngaged: 0, untouched: 0, followupOverdue: 5 })).toBe("coaching");
  });

  it("flags 'strong' when all ratios are low", () => {
    expect(repHealth({ total: 100, notEngaged: 2, untouched: 1, followupOverdue: 5 })).toBe("strong");
  });

  it("falls back to 'track' for moderate ratios", () => {
    expect(repHealth({ total: 100, notEngaged: 15, untouched: 8, followupOverdue: 20 })).toBe("track");
  });
});
