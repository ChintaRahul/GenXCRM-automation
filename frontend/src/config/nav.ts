import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Target,
  BarChart3,
  BookOpen,
  UserPlus,
  CreditCard,
  FileText,
  Zap,
  Mail,
  Users,
  Link2,
  Receipt,
  Settings,
  Building2,
  ContactRound,
  CalendarCheck,
  Briefcase,
  FileSpreadsheet,
  MapPin,
  FlaskConical,
  Package,
  Calculator,
  Stamp,
  ClipboardCheck,
  PackageCheck,
  Truck,
  Cpu,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { Role, WorkspaceType } from "../types";
import { MODULE_ROUTE_PATHS } from "../modules/modulePaths";

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  roles?: Role[];
  // Returns a positive count to show an amber badge, or null/undefined for
  // none. No item uses this yet in Phase 1 — Approvals/Service tickets get
  // one once their backend modules exist (Phase 3+).
  badge?: () => number | null;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

const MODULE_KEY_BY_PATH = new Map(
  Object.entries(MODULE_ROUTE_PATHS).map(([key, path]) => [`/${path}`, key]),
);

// Drops nav items whose module the role can't read (`readable` null = unrestricted). Items that
// aren't a manufacturing module route (Dashboard, Settings, ...) always stay.
export function filterNavByReadable(
  pinned: NavItem[],
  groups: NavGroup[],
  readable: string[] | null,
): { pinned: NavItem[]; groups: NavGroup[] } {
  if (!readable) return { pinned, groups };
  const canSee = (item: NavItem) => {
    const key = MODULE_KEY_BY_PATH.get(item.to);
    return !key || readable.includes(key);
  };
  return {
    pinned: pinned.filter(canSee),
    groups: groups.map((g) => ({ ...g, items: g.items.filter(canSee) })).filter((g) => g.items.length > 0),
  };
}

// Shared by Sidebar.tsx, SidebarGroup.tsx and SidebarCollapsedRail.tsx for
// active-route detection. A detail route like `/payments/abc123` must still
// count as "active" for the `/payments` nav item, matching NavLink's own
// (non-`end`) prefix-matching behavior — but the Dashboard's `/` must stay
// exact-only, or every route would match it.
export function isActiveRoute(itemTo: string, pathname: string): boolean {
  if (itemTo === "/") return pathname === "/";
  return pathname === itemTo || pathname.startsWith(`${itemTo}/`);
}

const WORKSPACE_GROUP_ITEMS: NavItem[] = [
  { to: "/users", icon: Users, label: "Team", roles: ["DIRECTOR", "MANAGER"] },
  { to: "/integrations", icon: Link2, label: "Integrations", roles: ["DIRECTOR", "MANAGER"] },
  { to: "/billing", icon: Receipt, label: "Billing", roles: ["DIRECTOR"] },
  { to: "/administration", icon: Settings, label: "Administration", roles: ["DIRECTOR", "MANAGER"] },
];

export const NAV: Record<WorkspaceType, { pinned: NavItem[]; groups: NavGroup[] }> = {
  EDTECH: {
    pinned: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/leads", icon: Target, label: "Leads" },
      { to: "/reports", icon: BarChart3, label: "Reports" },
    ],
    groups: [
      {
        key: "enrolment",
        label: "Enrolment",
        items: [
          { to: "/courses", icon: BookOpen, label: "Courses" },
          { to: "/register", icon: UserPlus, label: "Register" },
        ],
      },
      {
        key: "finance",
        label: "Finance",
        items: [
          { to: "/payments", icon: CreditCard, label: "Payments" },
          { to: "/invoices", icon: FileText, label: "Invoices" },
        ],
      },
      {
        key: "engage",
        label: "Engage",
        items: [
          { to: "/nurturing", icon: Zap, label: "Nurturing" },
          { to: "/templates", icon: Mail, label: "Templates", roles: ["DIRECTOR", "MANAGER"] },
        ],
      },
      { key: "workspace", label: "Workspace", items: WORKSPACE_GROUP_ITEMS },
    ],
  },
  MANUFACTURING: {
    pinned: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/leads", icon: Target, label: "Leads" },
      { to: "/reports", icon: BarChart3, label: "Reports" },
    ],
    groups: [
      {
        key: "customers",
        label: "Customers",
        items: [
          { to: "/accounts", icon: Building2, label: "Accounts" },
          { to: "/contacts", icon: ContactRound, label: "Contacts" },
          { to: "/activities", icon: CalendarCheck, label: "Activities" },
        ],
      },
      {
        key: "deals",
        label: "Deals",
        items: [
          { to: "/opportunities", icon: Briefcase, label: "Opportunities" },
          { to: "/rfqs", icon: FileSpreadsheet, label: "RFQs" },
          { to: "/site-visits", icon: MapPin, label: "Site visits" },
          { to: "/demos", icon: FlaskConical, label: "Demos & trials" },
        ],
      },
      {
        key: "quoting",
        label: "Quoting",
        items: [
          { to: "/products", icon: Package, label: "Products" },
          { to: "/costing", icon: Calculator, label: "Costing" },
          { to: "/quotations", icon: FileText, label: "Quotations" },
          { to: "/approvals", icon: Stamp, label: "Approvals" },
        ],
      },
      {
        key: "orders",
        label: "Orders",
        items: [
          { to: "/purchase-orders", icon: ClipboardCheck, label: "Purchase orders" },
          { to: "/sales-orders", icon: PackageCheck, label: "Sales orders" },
          { to: "/dispatch", icon: Truck, label: "Dispatch" },
          { to: "/payments", icon: CreditCard, label: "Payments" },
        ],
      },
      {
        key: "channel",
        label: "Channel & tenders",
        items: [
          { to: "/dealers", icon: Building2, label: "Dealers" },
          { to: "/tenders", icon: FileSpreadsheet, label: "Tenders" },
        ],
      },
      {
        key: "aftersales",
        label: "After-sales",
        items: [
          { to: "/installed-assets", icon: Cpu, label: "Installed assets" },
          { to: "/amc", icon: ShieldCheck, label: "AMC & warranty" },
          { to: "/service-tickets", icon: Wrench, label: "Service tickets" },
        ],
      },
      {
        key: "engage",
        label: "Engage",
        items: [
          { to: "/nurturing", icon: Zap, label: "Nurturing" },
          { to: "/templates", icon: Mail, label: "Templates", roles: ["DIRECTOR", "MANAGER"] },
        ],
      },
      { key: "workspace", label: "Workspace", items: WORKSPACE_GROUP_ITEMS },
    ],
  },
};
