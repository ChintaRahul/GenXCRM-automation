import { AlertCircle, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/layout/Header";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/shared/EmptyState";
import { InvoiceTable } from "../components/invoices/InvoiceTable";
import { useInvoicesList } from "../hooks/useInvoices";

// Thin page (CLAUDE.md rule 7) — all data fetching lives in useInvoicesList; this page
// only orchestrates layout and picks between the table and the empty state.
export default function InvoicesPage() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useInvoicesList();
  const invoices = data?.data ?? [];

  return (
    <>
      <Header
        title="Invoices"
        subtitle="Create, send, and track invoices"
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/register/new")}>
              Register
            </Button>
            <Button onClick={() => navigate("/invoices/new")}>+ New Invoice</Button>
          </>
        }
      />
      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="bg-card border border-card-border rounded-xl">
            <EmptyState
              icon={<AlertCircle className="w-10 h-10" />}
              title="Couldn't load invoices"
              description={error}
              action={<Button onClick={refetch}>Try again</Button>}
            />
          </div>
        ) : invoices.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl">
            <EmptyState
              icon={<FileText className="w-10 h-10" />}
              title="No invoices yet"
              description="Create your first invoice to start billing leads for their courses."
              action={
                <Button onClick={() => navigate("/invoices/new")}>+ New Invoice</Button>
              }
            />
          </div>
        ) : (
          <InvoiceTable invoices={invoices} onChanged={refetch} />
        )}
      </div>
    </>
  );
}
