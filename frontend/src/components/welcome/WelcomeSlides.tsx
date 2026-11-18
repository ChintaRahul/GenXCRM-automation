import type { ReactNode } from "react";
import {
  Briefcase,
  ClipboardCheck,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Target,
  Timer,
  Trophy,
  Truck,
  Zap,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";

// Mock visuals for the first-launch welcome carousel. Static sample data only — they are
// pictures of the product, built from the same tokens, never wired to the API.

type Tone = "primary" | "info" | "warning" | "success" | "violet" | "destructive";

const TONE: Record<Tone, { soft: string; text: string; solid: string }> = {
  primary: { soft: "bg-primary-soft", text: "text-primary-text", solid: "bg-primary" },
  info: { soft: "bg-info-soft", text: "text-info", solid: "bg-info" },
  warning: { soft: "bg-warning-soft", text: "text-warning-text", solid: "bg-warning" },
  success: { soft: "bg-success-soft", text: "text-success-text", solid: "bg-success" },
  violet: { soft: "bg-violet-soft", text: "text-violet", solid: "bg-violet" },
  destructive: { soft: "bg-destructive-soft", text: "text-destructive", solid: "bg-destructive" },
};

const WA_BOX = "border-[#22c55e33] bg-[#22c55e14] dark:border-[#22c55e40] dark:bg-[#22c55e1f]";
const WA = `${WA_BOX} text-[#15803d] dark:text-[#4ade80]`;

const MockCard = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("rounded-[14px] border border-card-border bg-card p-2.5", className)}>{children}</div>
);

const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={cn("shrink-0 whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[10.5px] font-semibold", TONE[tone].soft, TONE[tone].text)}>
    {children}
  </span>
);

const IconTile = ({ icon: Icon, tone, size = 26 }: { icon: LucideIcon; tone: Tone; size?: number }) => (
  <span
    className={cn("flex shrink-0 items-center justify-center rounded-lg", TONE[tone].soft, TONE[tone].text)}
    style={{ width: size, height: size }}
  >
    <Icon style={{ width: size / 2, height: size / 2 }} />
  </span>
);

// ── Slide 1 · dashboard ─────────────────────────────────────────────────────
const KPIS: { icon: LucideIcon; tone: Tone; delta: string; deltaTone: Tone; value: string; label: string }[] = [
  { icon: Briefcase, tone: "primary", delta: "+12%", deltaTone: "success", value: "₹4.8 Cr", label: "Open pipeline" },
  { icon: Target, tone: "info", delta: "+8", deltaTone: "success", value: "42", label: "New leads · MTD" },
  { icon: FileText, tone: "warning", delta: "3 due", deltaTone: "destructive", value: "7", label: "Quotes awaiting" },
  { icon: Trophy, tone: "success", delta: "+18%", deltaTone: "success", value: "₹1.2 Cr", label: "Won · MTD" },
];

const STATUSES: { label: string; count: number; tone: Tone }[] = [
  { label: "New", count: 18, tone: "info" },
  { label: "Contacted", count: 11, tone: "primary" },
  { label: "Follow-up", count: 7, tone: "warning" },
  { label: "Qualified", count: 6, tone: "success" },
  { label: "Nurture", count: 4, tone: "violet" },
  { label: "SLA overdue", count: 3, tone: "destructive" },
];

export function DashboardVisual() {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {KPIS.map(({ icon, tone, delta, deltaTone, value, label }) => (
          <MockCard key={label}>
            <div className="flex items-center gap-1.5">
              <IconTile icon={icon} tone={tone} size={24} />
              <span className={cn("ml-auto font-mono text-[10.5px] font-semibold", TONE[deltaTone].text)}>{delta}</span>
            </div>
            <p className="mt-2 font-mono text-[17px] font-semibold leading-none">{value}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
          </MockCard>
        ))}
      </div>
      <MockCard className="px-[11px]">
        <div className="mb-2 flex items-baseline">
          <span className="mr-auto whitespace-nowrap text-[12.5px] font-semibold">Leads by status</span>
          <span className="text-[11px] text-muted-foreground">this month</span>
        </div>
        <div className="mb-2.5 flex h-[7px] gap-0.5 overflow-hidden rounded-[4px]">
          {STATUSES.map(({ label, count, tone }) => (
            <span key={label} className={TONE[tone].solid} style={{ flex: count }} />
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
          {STATUSES.map(({ label, count, tone }) => (
            <li key={label} className="flex items-center gap-1.5 text-[11px]">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[tone].solid)} />
              <span className="truncate text-muted-foreground">{label}</span>
              <span className="ml-auto font-mono font-semibold">{count}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2.5 flex items-center gap-2 text-[11px]">
          <span className="truncate text-muted-foreground">Team target · ₹3 Cr this quarter</span>
          <span className="ml-auto font-mono font-semibold">40%</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
          <span className="block h-full w-[40%] bg-primary" />
        </div>
      </MockCard>
    </>
  );
}

// ── Slide 2 · leads ─────────────────────────────────────────────────────────
const SOURCES = ["IndiaMART", "Meta", "Google Ads", "Website"];
const CHIPS = [
  { label: "All", count: 91, active: true },
  { label: "New", count: 18 },
  { label: "Follow-up", count: 7 },
  { label: "Qualified", count: 6 },
];
const LEADS: { initials: string; name: string; hot?: boolean; sub: string; stage: string; stageTone: Tone; source: string; score: number; sla: string; slaTone: Tone }[] = [
  { initials: "SP", name: "Shivalik Paper Mills", hot: true, sub: "Belt weigher · Saharanpur", stage: "New", stageTone: "info", source: "IndiaMART", score: 88, sla: "Respond in 22m", slaTone: "destructive" },
  { initials: "NP", name: "Narmada Polymers", sub: "Checkweigher · Bharuch", stage: "Follow-up", stageTone: "warning", source: "Website", score: 74, sla: "Due today", slaTone: "warning" },
  { initials: "KS", name: "Kaveri Steel", sub: "60 t weighbridge · Hosur", stage: "Qualified", stageTone: "success", source: "Meta", score: 81, sla: "On track", slaTone: "success" },
];

export function LeadsVisual() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Auto-captured from</span>
        {SOURCES.map((s) => (
          <span key={s} className="flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border border-card-border bg-card px-[7px] text-[10.5px] font-semibold text-foreground/80">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {s}
          </span>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-hidden">
        {CHIPS.map(({ label, count, active }) => (
          <span
            key={label}
            className={cn(
              "flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-semibold",
              active ? "bg-primary text-primary-foreground" : "border border-card-border bg-card text-foreground/80",
            )}
          >
            {label}
            <span className="font-mono text-[10.5px] opacity-70">{count}</span>
          </span>
        ))}
      </div>
      {LEADS.map((lead) => (
        <MockCard key={lead.name} className="px-[11px]">
          <div className="flex items-center gap-[9px]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11.5px] font-bold text-primary-text">{lead.initials}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold">{lead.name}</span>
                {lead.hot && <Pill tone="destructive">HOT</Pill>}
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{lead.sub}</p>
            </div>
            <Pill tone={lead.stageTone}>{lead.stage}</Pill>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-md border border-card-border px-1.5 py-px text-[10.5px] text-muted-foreground">{lead.source}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-primary" style={{ width: `${lead.score}%` }} />
            </span>
            <span className="font-mono text-[10.5px] font-semibold">{lead.score}</span>
            <span className={cn("flex items-center gap-1 whitespace-nowrap text-[10.5px] font-semibold", TONE[lead.slaTone].text)}>
              <Timer className="h-3 w-3" />
              {lead.sla}
            </span>
          </div>
        </MockCard>
      ))}
    </>
  );
}

// ── Slide 3 · contact ───────────────────────────────────────────────────────
const ACTIONS: { icon: LucideIcon; label: string; className: string }[] = [
  { icon: Phone, label: "Call", className: "bg-primary text-primary-foreground" },
  { icon: MessageCircle, label: "WhatsApp", className: WA },
  { icon: Mail, label: "Email", className: "border-info/25 bg-info-soft text-info" },
  { icon: MapPin, label: "Visit", className: "border-violet/25 bg-violet-soft text-violet" },
];

export function ContactVisual() {
  return (
    <>
      <MockCard className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11.5px] font-bold text-primary-text">RK</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">Rohan Kulkarni</p>
            <p className="truncate text-[11.5px] text-muted-foreground">Purchase Head · Narmada Polymers</p>
          </div>
          <Pill tone="success">Interested</Pill>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {ACTIONS.map(({ icon: Icon, label, className }) => (
            <span key={label} className={cn("flex h-12 flex-col items-center justify-center gap-0.5 rounded-[10px] border border-transparent text-[11px] font-bold", className)}>
              <Icon className="h-[15px] w-[15px]" />
              {label}
            </span>
          ))}
        </div>
      </MockCard>
      <div className={cn("max-w-[86%] self-end rounded-[12px_12px_4px_12px] border px-[11px] py-[9px] text-xs leading-[1.45] text-foreground", WA_BOX)}>
        Hi Rohan, sharing the revised quotation for the checkweigher. Can we speak at 4?
        <p className="mt-[3px] text-right text-[10px] text-muted-foreground">Template · Delivered ✓✓ 11:42</p>
      </div>
      <MockCard className="px-[11px]">
        <div className="flex items-center gap-[9px]">
          <IconTile icon={Zap} tone="primary" size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold">Sequence: Quote follow-up</p>
            <p className="truncate text-[11px] text-muted-foreground">Next: WhatsApp reminder in 2 days</p>
          </div>
          <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">Step 2 of 4</span>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((n) => (
            <span key={n} className={cn("h-1 flex-1 rounded-full", n < 2 ? "bg-primary" : "bg-border")} />
          ))}
        </div>
      </MockCard>
    </>
  );
}

// ── Slide 4 · quote → PO → service ─────────────────────────────────────────
const STAGES: { icon: LucideIcon; tone: Tone; title: string; sub: string; pill: string }[] = [
  { icon: ClipboardCheck, tone: "success", title: "PO received · ₹22.1 L", sub: "Kaveri Steel · 30% advance paid", pill: "Won" },
  { icon: Truck, tone: "info", title: "Dispatch DS-118", sub: "In transit · reaches Hosur Thu", pill: "In transit" },
  { icon: ShieldCheck, tone: "violet", title: "AMC renewal due", sub: "Tapti Cotton · 3 weighbridges", pill: "14 days" },
];

export function QuoteVisual() {
  return (
    <>
      <MockCard className="p-[11px]">
        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] text-muted-foreground">QT-3115 · v2</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold">60 t pit-less weighbridge</p>
          </div>
          <Pill tone="warning">Approval pending</Pill>
        </div>
        <div className="space-y-1 border-y border-border py-2 text-[11.5px]">
          <div className="flex justify-between gap-2">
            <span className="truncate text-muted-foreground">Weighbridge + install</span>
            <span className="font-mono">₹20,50,000</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="truncate text-muted-foreground">Discount 9% (limit 7%)</span>
            <span className="font-mono text-destructive">−₹1,84,500</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <span className="flex h-8 items-center justify-center rounded-lg border border-input text-xs font-semibold">Return</span>
          <span className="flex h-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">Approve</span>
        </div>
      </MockCard>
      {STAGES.map(({ icon, tone, title, sub, pill }) => (
        <MockCard key={title} className="px-[11px] py-[9px]">
          <div className="flex items-center gap-[9px]">
            <IconTile icon={icon} tone={tone} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold">{title}</p>
              <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
            </div>
            <Pill tone={tone}>{pill}</Pill>
          </div>
        </MockCard>
      ))}
    </>
  );
}

export interface WelcomeSlide {
  readonly title: string;
  readonly body: string;
  readonly Visual: () => ReactNode;
}

export const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    title: "Your business at a glance",
    body: "Pipeline, wins, pending quotes, every lead status and progress against your team’s targets.",
    Visual: DashboardVisual,
  },
  {
    title: "Every lead, sorted and scored",
    body: "Enquiries arrive on their own from IndiaMART, Meta, Google Ads, forms and your website, each with status, score and a response timer.",
    Visual: LeadsVisual,
  },
  {
    title: "Call, WhatsApp, email or visit",
    body: "Reach a lead from their card. Calls are logged on their own and nurture sequences follow up when you can’t.",
    Visual: ContactVisual,
  },
  {
    title: "Quote to PO to service",
    body: "Approve discounts from your phone, then track orders, payments, renewals and service, all in one place.",
    Visual: QuoteVisual,
  },
];
