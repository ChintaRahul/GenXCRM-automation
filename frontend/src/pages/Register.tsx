import { useMemo } from "react";
import { UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/layout/Header";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/shared/EmptyState";
import { RegistrationTable } from "../components/invoices/RegistrationTable";
import { useRegistrationsList } from "../hooks/useInvoices";
import { useFormSubmissions } from "../hooks/useFormSubmissions";
import type { FormSubmissionDto } from "../types";

// Thin page (CLAUDE.md rule 7) — all data fetching lives in useRegistrationsList; this
// page only orchestrates layout and picks between the table and the empty state.
// Mirrors pages/Invoices.tsx's list/create pattern: this page lists already-registered
// students, and "+ New Registration" hands off to pages/RegisterNew.tsx's step flow.
export default function RegisterPage() {
  const navigate = useNavigate();
  const { data, loading, refetch } = useRegistrationsList();
  const registrations = data?.data ?? [];
  const { submissions } = useFormSubmissions({});
  const submissionsByLead = useMemo(() => {
    const map = new Map<string, FormSubmissionDto[]>();
    for (const s of [...submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))) {
      if (!s.leadId) continue;
      map.set(s.leadId, [...(map.get(s.leadId) ?? []), s]);
    }
    return map;
  }, [submissions]);

  return (
    <>
      <Header
        title="Register"
        subtitle="Students registered so far, with a quick way to start a new one"
        actions={<Button onClick={() => navigate("/register/new")}>+ New Registration</Button>}
      />
      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : registrations.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl">
            <EmptyState
              icon={<UserPlus className="w-10 h-10" />}
              title="No registrations yet"
              description="Register your first lead to enroll them in a course and record their registration fee."
              action={
                <Button onClick={() => navigate("/register/new")}>+ New Registration</Button>
              }
            />
          </div>
        ) : (
          <RegistrationTable invoices={registrations} onChanged={refetch} submissionsByLead={submissionsByLead} />
        )}
      </div>
    </>
  );
}
