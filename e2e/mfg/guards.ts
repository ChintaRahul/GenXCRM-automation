// e2e/mfg/guards.ts — server-guard errors are NOT shown in the UI (ModuleDetailPage.handleRunAction only
// console.errors), so a rejected action is asserted through the API message plus unchanged UI state.
import { expect, type TestInfo } from "@playwright/test";
import { ApiClient } from "./api";

export const expectActionRejected = async (
  api: ApiClient, moduleKey: string, id: string, action: string, payload: Record<string, unknown>, messagePart: string,
): Promise<void> => {
  const r = await api.action(moduleKey, id, action, payload);
  expect(r.status, `${action} should be rejected`).toBe(400);
  expect(ApiClient.message(r)).toContain(messagePart);
};

/**
 * Runs the SPEC-CORRECT assertion of a known product defect without masking the rest of the test: a failure is
 * recorded as a "known-defect" annotation and the test continues; if it unexpectedly passes the defect is fixed,
 * so fail loudly to get the wrapper removed.
 */
export const knownDefect = async (testInfo: TestInfo, defectId: string, assertion: () => Promise<void>): Promise<void> => {
  try {
    await assertion();
  } catch (e: unknown) {
    // Only an expect() failure (it carries matcherResult, also on locator-assertion timeouts) is the defect; navigation errors,
    // closed pages and any other exception are test errors and must surface.
    if (typeof e !== "object" || e === null || !("matcherResult" in e)) throw e;
    const message = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
    testInfo.annotations.push({ type: "known-defect", description: `${defectId}: ${message}` });
    return;
  }
  throw new Error(`${defectId} appears fixed - remove the knownDefect wrapper`);
};
