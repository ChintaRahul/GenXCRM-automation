import type { Lead, Payment } from "../types";
import type { DefaultPlan } from "../hooks/usePlatformPlan";

// {{placeholder}} values a saved template can pick up automatically from a lead (plus the org and
// the rep sending). Anything not resolvable is simply absent, so the rep fills it in by hand.
export type TemplateValues = Record<string, string>;

const isPending = (status: string) => status.toUpperCase() !== "PAID";

const latestPayment = (payments: Payment[] | undefined): Payment | undefined =>
  payments && [...payments].sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "")).at(0);

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString("en-IN");

export const buildTemplateValues = (
  lead: Lead,
  ctx: { orgName?: string; orgWebsite?: string; repName?: string; defaultPlan?: DefaultPlan | null } = {},
): TemplateValues => {
  const payment = latestPayment(lead.payments);
  const nextInstallment = [...(payment?.installments ?? [])]
    .filter((i) => isPending(i.status))
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))
    .at(0);
  const installmentIndex = nextInstallment ? payment?.installments.indexOf(nextInstallment) : undefined;
  const dueDate = nextInstallment?.dueDate ?? payment?.dueDate;

  const { defaultPlan } = ctx;
  // Billing on the lead wins; otherwise price the default plan for its minimum seat count.
  const defaultAmount = defaultPlan ? defaultPlan.pricePerUser * defaultPlan.minUsers : undefined;

  const candidates: Record<string, string | number | null | undefined> = {
    name: lead.name,
    course: lead.course,
    plan: defaultPlan?.name ?? lead.course,
    link: ctx.orgWebsite,
    email: lead.email,
    phone: lead.phone,
    location: lead.location,
    org: ctx.orgName,
    rep: lead.assignedTo?.name ?? ctx.repName,
    amount: nextInstallment?.amount ?? payment?.amount ?? defaultAmount,
    payment_link: payment?.paymentLink,
    installment_no: installmentIndex === undefined ? undefined : installmentIndex + 1,
    due_date: dueDate ? formatDate(dueDate) : undefined,
  };

  return Object.fromEntries(
    Object.entries(candidates)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
      .map(([k, v]) => [k, String(v)]),
  );
};

// Replaces {{key}} with its value where one exists; unknown placeholders are left as-is so the
// rep can see and complete them before sending.
export const fillKnownPlaceholders = (text: string, values: TemplateValues): string =>
  text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
