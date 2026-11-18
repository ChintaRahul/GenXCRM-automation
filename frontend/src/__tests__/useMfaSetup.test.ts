import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMfaSetup } from "../hooks/useMfaSetup";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const user: User = {
  id: "u1",
  name: "Rep",
  email: "rep@co.com",
  role: "SALES_REP",
  teamId: null,
};

describe("useMfaSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("init", () => {
    it("returns the setup token, QR code, and secret on success", async () => {
      vi.mocked(client.initMfaSetup).mockResolvedValue({
        setupToken: "setup-token",
        qrCodeDataUrl: "data:image/png;base64,xyz",
        secret: "SECRET",
      });
      const { result } = renderHook(() => useMfaSetup());
      let out: { setupToken: string; qrCodeDataUrl: string; secret: string } | null = null;
      await act(async () => {
        out = await result.current.init();
      });
      expect(out).toEqual({ setupToken: "setup-token", qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" });
      expect(result.current.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      vi.mocked(client.initMfaSetup).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useMfaSetup());
      let out: unknown = "not-null";
      await act(async () => {
        out = await result.current.init();
      });
      expect(out).toBeNull();
      await waitFor(() => expect(result.current.error).toBeTruthy());
    });
  });

  describe("getSetupInfo", () => {
    it("returns the QR code and secret for an existing setupToken", async () => {
      vi.mocked(client.getMfaSetupInfo).mockResolvedValue({
        qrCodeDataUrl: "data:image/png;base64,xyz",
        secret: "SECRET",
      });
      const { result } = renderHook(() => useMfaSetup());
      let out: { qrCodeDataUrl: string; secret: string } | null = null;
      await act(async () => {
        out = await result.current.getSetupInfo("setup-token");
      });
      expect(client.getMfaSetupInfo).toHaveBeenCalledWith("setup-token");
      expect(out).toEqual({ qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" });
      expect(result.current.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      vi.mocked(client.getMfaSetupInfo).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useMfaSetup());
      let out: unknown = "not-null";
      await act(async () => {
        out = await result.current.getSetupInfo("setup-token");
      });
      expect(out).toBeNull();
      await waitFor(() => expect(result.current.error).toBeTruthy());
    });
  });

  describe("verify", () => {
    it("returns the token + user + recovery codes on a correct code", async () => {
      vi.mocked(client.verifyMfaSetup).mockResolvedValue({
        enabled: true,
        token: "session-token",
        user,
        recoveryCodes: ["ABCD-1234", "EFGH-5678"],
      });
      const { result } = renderHook(() => useMfaSetup());
      let out: { token: string; user: User; recoveryCodes: string[] } | null = null;
      await act(async () => {
        out = await result.current.verify("setup-token", "123456");
      });
      expect(out).toEqual({
        enabled: true,
        token: "session-token",
        user,
        recoveryCodes: ["ABCD-1234", "EFGH-5678"],
      });
    });

    it("returns null and sets error on a wrong code", async () => {
      vi.mocked(client.verifyMfaSetup).mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useMfaSetup());
      let out: unknown = "not-null";
      await act(async () => {
        out = await result.current.verify("setup-token", "000000");
      });
      expect(out).toBeNull();
      await waitFor(() => expect(result.current.error).toBeTruthy());
    });
  });
});
