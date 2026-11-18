import { describe, it, expect } from "vitest";
import { rupeeShort } from "../lib/format";

describe("rupeeShort", () => {
  it("formats crore", () => {
    expect(rupeeShort(18_400_000)).toBe("₹1.8Cr");
    expect(rupeeShort(10_000_000)).toBe("₹1.0Cr");
  });

  it("formats lakh", () => {
    expect(rupeeShort(980_000)).toBe("₹9.8L");
    expect(rupeeShort(100_000)).toBe("₹1.0L");
  });

  it("formats thousand", () => {
    expect(rupeeShort(98_000)).toBe("₹98.0k");
    expect(rupeeShort(1_000)).toBe("₹1.0k");
  });

  it("formats small amounts without abbreviation", () => {
    expect(rupeeShort(500)).toBe("₹500");
    expect(rupeeShort(0)).toBe("₹0");
  });
});
