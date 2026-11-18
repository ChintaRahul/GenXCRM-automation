import { DollarSign, Clock, TrendingUp } from "lucide-react";
import { usePaymentDashboard } from "../hooks/usePayments";
import { Header } from "../components/layout/Header";
import { StatCard } from "../components/shared/StatCard";
import { RevenueChartCard } from "../components/payments/RevenueChartCard";
import { TransactionsTable } from "../components/payments/TransactionsTable";
import { AwaitingPaymentCard } from "../components/payments/AwaitingPaymentCard";
import { UpcomingEmisCard } from "../components/payments/UpcomingEmisCard";
import { GatewaySplitCard } from "../components/payments/GatewaySplitCard";
import { rupeeShort } from "../lib/format";

interface PaymentStatusCount {
  status: string;
  _count: { status: number };
}
interface PaymentDashboard {
  totalCollected: number;
  totalPending: number;
  overdueCount: number;
  byStatus: PaymentStatusCount[];
}

export default function PaymentsPage() {
  const { data, loading, error } = usePaymentDashboard();
  const dashboard = data as PaymentDashboard | null;

  const paidCount =
    dashboard?.byStatus.find((s) => s.status === "PAID")?._count.status ?? 0;
  const sentCount = (dashboard?.byStatus ?? [])
    .filter((s) => s.status === "PAID" || s.status === "LINK_SENT")
    .reduce((sum, s) => sum + s._count.status, 0);
  const conversionRate =
    sentCount > 0 ? ((paidCount / sentCount) * 100).toFixed(1) : null;

  return (
    <>
      <Header
        title="Payments"
        subtitle="Payment dashboard and status overview"
      />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <RevenueChartCard />
          </div>
          <div className="flex flex-col gap-3">
            <StatCard
              title="Total collected"
              value={loading || error ? "—" : rupeeShort(dashboard?.totalCollected ?? 0)}
              subtitle={error ? "Couldn't load" : `${paidCount} successful payments`}
              icon={<DollarSign className="w-5 h-5 text-chart-2" />}
              loading={loading}
              accentColor="bg-chart-2/10"
            />
            <StatCard
              title="Outstanding"
              value={loading || error ? "—" : rupeeShort(dashboard?.totalPending ?? 0)}
              subtitle={
                dashboard
                  ? `${dashboard.overdueCount} overdue`
                  : undefined
              }
              icon={<Clock className="w-5 h-5 text-chart-3" />}
              loading={loading}
              accentColor="bg-chart-3/10"
            />
            <StatCard
              title="Conv. on links"
              value={loading || error || !conversionRate ? "—" : `${conversionRate}%`}
              subtitle={
                sentCount > 0
                  ? `${paidCount} paid · ${sentCount} sent`
                  : undefined
              }
              icon={<TrendingUp className="w-5 h-5 text-primary" />}
              loading={loading}
              accentColor="bg-primary/10"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <TransactionsTable />
          </div>
          <div className="flex flex-col gap-3">
            <AwaitingPaymentCard />
            <UpcomingEmisCard />
            <GatewaySplitCard />
          </div>
        </div>
      </div>
    </>
  );
}
