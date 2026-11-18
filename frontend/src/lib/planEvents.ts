// Lightweight cross-component signal for "the org's plan just became ACTIVE".
// Used so the trial banner / expired modal (rendered in Layout) can refetch their
// status the moment a subscription activates on the Billing page — without a shared
// global store.
export const PLAN_ACTIVATED_EVENT = "genx:plan-activated";

export const notifyPlanActivated = () =>
  window.dispatchEvent(new Event(PLAN_ACTIVATED_EVENT));
