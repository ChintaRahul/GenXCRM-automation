import type { ModuleAction } from "../modules/registry";

export interface SplitActions {
  readonly primary: ModuleAction | null;
  readonly secondary: ModuleAction | null;
  readonly menu: readonly ModuleAction[];
}

// Action-priority rule for a record page: one main button (the first non-danger `primary`
// action), one secondary on desktop, everything else goes in the "⋯" menu.
export const splitActions = (actions: readonly ModuleAction[], desktop: boolean): SplitActions => {
  const primary = actions.find((a) => a.primary && !a.danger) ?? null;
  const rest = actions.filter((a) => a !== primary);
  const secondary = desktop ? (rest.find((a) => !a.danger) ?? null) : null;
  return { primary, secondary, menu: rest.filter((a) => a !== secondary) };
};
