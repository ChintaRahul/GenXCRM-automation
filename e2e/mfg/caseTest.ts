// e2e/mfg/caseTest.ts
import { test, type PlaywrightTestArgs, type PlaywrightWorkerArgs, type TestInfo } from "@playwright/test";
import cases from "./cases.json";

export interface Case {
  id: string; module: string; title: string; type: string; priority: string; role: string; ref: string; pre: string;
  steps: string[]; expected: string; build: string; verification: string; verificationNote: string; note: string; automation: string;
}
const byId = new Map<string, Case>((cases as Case[]).map((c) => [c.id, c]));
export const caseOf = (id: string): Case => {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown case id ${id} — not in e2e/mfg/cases.json`);
  return c;
};

// Playwright only injects fixtures it can see destructured, so the wrapper forwards this fixed set.
type Body = (args: Pick<PlaywrightTestArgs, "page" | "context" | "request"> & Pick<PlaywrightWorkerArgs, "browser">, info: TestInfo) => Promise<void>;

/** Registers one test for a manual case: normal, expected-fail (known gap) or skipped (not browser-automatable). */
export const tc = (id: string, body: Body): void => {
  const c = caseOf(id);
  const title = `${id} ${c.title}`;
  if (c.automation.startsWith("skip:")) {
    test.skip(`${title} [${c.automation.slice(5)}]`, async () => {});
    return;
  }
  test(title, async ({ page, context, request, browser }, info) => {
    if (c.automation !== "gap") {
      await body({ page, context, request, browser }, info);
      return;
    }
    // Known gap: only an expect() / matcher failure (it carries matcherResult, also on locator-assertion timeouts) confirms the gap.
    // Any other error (setup exception, navigation error, plain timeout) is an infrastructure problem and fails the test.
    try {
      await body({ page, context, request, browser }, info);
    } catch (e: unknown) {
      if (typeof e !== "object" || e === null || !("matcherResult" in e)) throw e;
      const note = (c.verificationNote || c.note || "known gap").split("\n")[0] ?? "";
      info.annotations.push({ type: "known-gap", description: note });
      // Evidence of where the gap was confirmed: the matcher message plus the spec line of the failing expect().
      const message = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0] ?? "";
      const at = (e instanceof Error ? e.stack : undefined)?.split("\n").find((l) => /specs[\\/]mfg[\\/].*\.spec\.ts:\d+/.test(l))?.trim() ?? "unknown location";
      info.annotations.push({ type: "known-gap-evidence", description: `${message} @ ${at}` });
      return;
    }
    throw new Error(`${id}: gap appears fixed — flip automation to "auto" in cases.json`);
  });
};
