import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  Stamp,
  Target,
  Zap,
} from "lucide-react";
import { NAV, filterNavByReadable } from "../../config/nav";
import type { WorkspaceType } from "../../types";

export interface TourChapter {
  readonly name: string;
  readonly icon: LucideIcon;
  readonly blurb: string;
}

interface StepBase {
  readonly k: string;
  // Index into the tour's chapters (drives the progress bar); -1 = welcome, chapters.length = done.
  readonly ch: number;
}

export type TourStep =
  | (StepBase & { readonly type: "modal" })
  // Points at the real sidebar link and waits for the route to change.
  | (StepBase & {
      readonly type: "click";
      readonly route: string;
      readonly label: string;
      // Sidebar group the link lives in; undefined for pinned items (Dashboard, Leads, Reports).
      readonly group?: string;
      readonly title: string;
      readonly body: string;
    })
  // Explains a part of the page the previous click landed on; advances with Next.
  | (StepBase & {
      readonly type: "info";
      readonly route: string;
      readonly sel: string;
      readonly title: string;
      readonly body: string;
    });

export interface TourDefinition {
  readonly chapters: readonly TourChapter[];
  readonly steps: readonly TourStep[];
  readonly welcomeBody: string;
  readonly doneBody: string;
}

const REC = '[data-tour="records"]';

const MANUFACTURING: TourDefinition = {
  chapters: [
    { name: "Dashboard", icon: LayoutDashboard, blurb: "Your day at a glance" },
    { name: "Leads", icon: Target, blurb: "Capture and qualify every enquiry" },
    { name: "Accounts", icon: Building2, blurb: "The customer organisations you sell to" },
    { name: "Opportunities", icon: Briefcase, blurb: "Live deals, stage by stage" },
    { name: "Quotations", icon: FileText, blurb: "Versioned customer proposals" },
    { name: "Approvals", icon: Stamp, blurb: "Discount, margin and credit sign-off" },
  ],
  welcomeBody:
    "Here's how a deal moves through your Manufacturing workspace. Each step points to the place to click, so you learn by doing. It takes about 2 minutes.",
  doneBody:
    "You've seen the path from enquiry to approved quotation. A good first move is to open a lead and qualify it into an opportunity.",
  steps: [
    { k: "welcome", type: "modal", ch: -1 },
    { k: "dash", type: "info", ch: 0, route: "/", sel: "main", title: "This is your dashboard", body: "Pipeline value, targets and today's follow-ups. It's the first screen you see after you sign in." },
    { k: "leads-nav", type: "click", ch: 1, route: "/leads", label: "Leads", title: "Open Leads", body: "Every enquiry from your website, IndiaMART, trade shows and calls lands here first." },
    { k: "leads-list", type: "info", ch: 1, route: "/leads", sel: REC, title: "Your lead list", body: "Click any row to call, log a visit or qualify it. The SLA pill shows how long a lead has been waiting for a response." },
    { k: "leads-chips", type: "info", ch: 1, route: "/leads", sel: '[data-tour="chips"]', title: "Filter by status", body: "One tap narrows the list to New, Follow-up, Qualified and so on. Use Filters for owner, source and date range." },
    { k: "acc-nav", type: "click", ch: 2, route: "/accounts", label: "Accounts", group: "Customers", title: "Open Accounts", body: "Accounts are the customer organisations you sell to, with their plants and buying committee." },
    { k: "acc-list", type: "info", ch: 2, route: "/accounts", sel: REC, title: "Customer accounts", body: "Open an account to see its contacts, opportunities, quotations and installed machines in one place." },
    { k: "opp-nav", type: "click", ch: 3, route: "/opportunities", label: "Opportunities", group: "Deals", title: "Open Opportunities", body: "Qualified leads become opportunities. These are your live deals." },
    { k: "opp-list", type: "info", ch: 3, route: "/opportunities", sel: REC, title: "Your pipeline", body: "Every open deal with its stage, value, owner and SLA. Click one to see its stage tracker, RFQs and quotes." },
    { k: "opp-views", type: "info", ch: 3, route: "/opportunities", sel: '[data-tour="views"]', title: "List or Board", body: "Switch to Board to drag deals between stages. Dropping a deal on Lost asks you for a reason." },
    { k: "opp-new", type: "info", ch: 3, route: "/opportunities", sel: '[data-tour="new"]', title: "Add a deal", body: "Create an opportunity here, or convert a qualified lead so its account and contact come across automatically." },
    { k: "quote-nav", type: "click", ch: 4, route: "/quotations", label: "Quotations", group: "Quoting", title: "Open Quotations", body: "Build proposals from your product catalogue with costing, discounts and taxes." },
    { k: "quote-list", type: "info", ch: 4, route: "/quotations", sel: REC, title: "Versioned quotations", body: "Issued versions are locked. Revising creates a new version, and a discount above your limit goes to Approvals." },
    { k: "appr-nav", type: "click", ch: 5, route: "/approvals", label: "Approvals", group: "Quoting", title: "Open Approvals", body: "The amber badge counts the requests waiting on you." },
    { k: "appr-list", type: "info", ch: 5, route: "/approvals", sel: REC, title: "Approve, reject or return", body: "Discount, margin and credit requests are routed by the rules in Administration. Open one to decide." },
    { k: "done", type: "modal", ch: 6 },
  ],
};

const EDTECH: TourDefinition = {
  chapters: [
    { name: "Dashboard", icon: LayoutDashboard, blurb: "Your day at a glance" },
    { name: "Leads", icon: Target, blurb: "Capture and qualify every enquiry" },
    { name: "Courses", icon: BookOpen, blurb: "The programmes students enrol in" },
    { name: "Payments", icon: CreditCard, blurb: "Fees, instalments and payment links" },
    { name: "Nurturing", icon: Zap, blurb: "Automatic follow-up sequences" },
    { name: "Reports", icon: BarChart3, blurb: "Team performance and conversion" },
  ],
  welcomeBody:
    "Here's how a student moves from enquiry to enrolment in your workspace. Each step points to the place to click, so you learn by doing. It takes about 2 minutes.",
  doneBody:
    "You've seen the path from enquiry to enrolment. A good first move is to open a lead and follow up with a call or message.",
  steps: [
    { k: "welcome", type: "modal", ch: -1 },
    { k: "dash", type: "info", ch: 0, route: "/", sel: "main", title: "This is your dashboard", body: "Your pipeline, targets and today's numbers. It's the first screen you see after you sign in." },
    { k: "leads-nav", type: "click", ch: 1, route: "/leads", label: "Leads", title: "Open Leads", body: "Every enquiry from your ads, forms, website and imports lands here first." },
    { k: "leads-list", type: "info", ch: 1, route: "/leads", sel: "main", title: "Your lead list", body: "Open a lead to call, message or follow up. Its status shows where it is in your funnel." },
    { k: "courses-nav", type: "click", ch: 2, route: "/courses", label: "Courses", group: "Enrolment", title: "Open Courses", body: "The programmes you sell, with their fees and batches." },
    { k: "courses-list", type: "info", ch: 2, route: "/courses", sel: "main", title: "Your courses", body: "Add a course once and pick it whenever you register a student." },
    { k: "pay-nav", type: "click", ch: 3, route: "/payments", label: "Payments", group: "Finance", title: "Open Payments", body: "Every fee payment and payment link, in one place." },
    { k: "pay-list", type: "info", ch: 3, route: "/payments", sel: "main", title: "Fees and payment links", body: "See what's paid, pending or overdue, and send a payment link straight from here." },
    { k: "nurt-nav", type: "click", ch: 4, route: "/nurturing", label: "Nurturing", group: "Engage", title: "Open Nurturing", body: "Sequences follow up with leads automatically while you work on others." },
    { k: "nurt-list", type: "info", ch: 4, route: "/nurturing", sel: "main", title: "Follow-up sequences", body: "Build a sequence of messages, then enrol leads into it." },
    { k: "rep-nav", type: "click", ch: 5, route: "/reports", label: "Reports", title: "Open Reports", body: "See how your team and your funnel are performing." },
    { k: "rep-list", type: "info", ch: 5, route: "/reports", sel: "main", title: "Team performance", body: "Track conversions, response times and revenue by rep and by source." },
    { k: "done", type: "modal", ch: 6 },
  ],
};

export const TOURS: Record<WorkspaceType, TourDefinition> = { MANUFACTURING, EDTECH };

// Steps for modules the role can't read are skipped (same rule as the sidebar).
export function allowedRoutes(workspaceType: WorkspaceType, readable: string[] | null): Set<string> {
  const { pinned, groups } = filterNavByReadable(NAV[workspaceType].pinned, NAV[workspaceType].groups, readable);
  return new Set([...pinned, ...groups.flatMap((g) => g.items)].map((item) => item.to));
}

export const isStepAllowed = (step: TourStep, allowed: ReadonlySet<string>): boolean =>
  step.type === "modal" || allowed.has(step.route);

// Index of the next/previous step worth showing from `from`, or -1.
export function neighbourStep(
  steps: readonly TourStep[],
  from: number,
  dir: 1 | -1,
  allowed: ReadonlySet<string>,
  infoOnly = false,
): number {
  for (let i = from + dir; i >= 0 && i < steps.length; i += dir) {
    const step = steps[i];
    if (!isStepAllowed(step, allowed)) continue;
    if (infoOnly && step.type === "click") continue;
    return i;
  }
  return -1;
}
