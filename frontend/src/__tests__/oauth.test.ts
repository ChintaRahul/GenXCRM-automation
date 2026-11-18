import { describe, it, expect, vi } from "vitest";
import * as client from "../api/client";
import { parseOAuthCallbackUrl, completeOAuthSignIn } from "../lib/oauth";
import type { User } from "../types";

vi.mock("../api/client");

const user: User = { id: "u1", name: "Rep", email: "rep@co.com", role: "SALES_REP", teamId: null };

describe("parseOAuthCallbackUrl", () => {
  it("reads token and setup from a web callback URL", () => {
    expect(parseOAuthCallbackUrl("https://app.genxcrm.co.in/auth/callback?token=abc&setup=1")).toEqual({
      token: "abc",
      needsSetup: true,
      error: null,
      mfaChallengeToken: null,
      mfaSetupToken: null,
    });
  });

  it("reads token from a native deep-link callback URL", () => {
    expect(parseOAuthCallbackUrl("com.genxcrm.app://auth/callback?token=abc")).toEqual({
      token: "abc",
      needsSetup: false,
      error: null,
      mfaChallengeToken: null,
      mfaSetupToken: null,
    });
  });

  it("reads an error param when SSO failed", () => {
    expect(parseOAuthCallbackUrl("com.genxcrm.app://auth/callback?error=sso")).toEqual({
      token: null,
      needsSetup: false,
      error: "sso",
      mfaChallengeToken: null,
      mfaSetupToken: null,
    });
  });

  it("reads an MFA challenge token when the SSO user already has MFA enrolled", () => {
    expect(parseOAuthCallbackUrl("https://app.genxcrm.co.in/auth/callback?mfa=challenge&challengeToken=chal-1")).toEqual({
      token: null,
      needsSetup: false,
      error: null,
      mfaChallengeToken: "chal-1",
      mfaSetupToken: null,
    });
  });

  it("reads an MFA setup token when the org enforces MFA and the SSO user has not enrolled", () => {
    expect(parseOAuthCallbackUrl("https://app.genxcrm.co.in/auth/callback?mfa=setup&setupToken=setup-1")).toEqual({
      token: null,
      needsSetup: false,
      error: null,
      mfaChallengeToken: null,
      mfaSetupToken: "setup-1",
    });
  });
});

describe("completeOAuthSignIn", () => {
  it("stores the token and returns the signed-in user", async () => {
    vi.mocked(client.getMe).mockResolvedValue(user);
    const result = await completeOAuthSignIn("tok-1");
    expect(localStorage.getItem("token")).toBe("tok-1");
    expect(result).toEqual(user);
  });

  it("clears the token and throws when getMe fails", async () => {
    vi.mocked(client.getMe).mockRejectedValue(new Error("unauthorized"));
    localStorage.setItem("token", "tok-2");
    await expect(completeOAuthSignIn("tok-2")).rejects.toThrow();
    expect(localStorage.getItem("token")).toBeNull();
  });
});
