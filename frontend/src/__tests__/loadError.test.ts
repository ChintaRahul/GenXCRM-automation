import { AxiosError } from "axios";
import { describe, it, expect } from "vitest";
import { loadErrorMessage, NO_ACCESS_MESSAGE } from "../lib/loadError";

const axiosErr = (status: number) =>
  new AxiosError("x", undefined, undefined, undefined, { status } as never);

describe("loadErrorMessage", () => {
  it("returns the no-access message for 403", () => {
    expect(loadErrorMessage(axiosErr(403), "fallback")).toBe(NO_ACCESS_MESSAGE);
  });
  it("returns the fallback otherwise", () => {
    expect(loadErrorMessage(axiosErr(500), "fallback")).toBe("fallback");
    expect(loadErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
