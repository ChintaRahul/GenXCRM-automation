import { describe, it, expect } from "vitest";
import { splitActions } from "../lib/moduleActions";
import type { ModuleAction } from "../modules/registry";

const act = (label: string, extra: Partial<ModuleAction> = {}): ModuleAction => ({ label, ...extra });

describe("splitActions", () => {
  const actions = [act("Qualify", { primary: true }), act("Log activity"), act("Export"), act("Disqualify", { danger: true })];

  it("desktop: one primary, one secondary, the rest in the menu", () => {
    const { primary, secondary, menu } = splitActions(actions, true);
    expect(primary?.label).toBe("Qualify");
    expect(secondary?.label).toBe("Log activity");
    expect(menu.map((a) => a.label)).toEqual(["Export", "Disqualify"]);
  });

  it("mobile: no secondary, everything else goes in the menu", () => {
    const { primary, secondary, menu } = splitActions(actions, false);
    expect(primary?.label).toBe("Qualify");
    expect(secondary).toBeNull();
    expect(menu.map((a) => a.label)).toEqual(["Log activity", "Export", "Disqualify"]);
  });

  it("never promotes a danger action to primary or secondary", () => {
    const { primary, secondary, menu } = splitActions([act("Cancel order", { primary: true, danger: true })], true);
    expect(primary).toBeNull();
    expect(secondary).toBeNull();
    expect(menu).toHaveLength(1);
  });
});
