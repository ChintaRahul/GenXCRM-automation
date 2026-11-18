import { Pagination } from "../ui/pagination";
import { useAuditLog } from "../../hooks/useAuditLog";

// Organisation-wide audit trail (logins, exports, record views): who did what, when, from where.
export function AuditLogTab() {
  const { page, loading, error, currentPage, setPage } = useAuditLog();
  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <div className="space-y-3 rounded-xl border border-card-border bg-card p-4 sm:p-6">
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Action</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">User</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">IP</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr><td className="px-4 py-4 text-destructive" colSpan={4}>{error}</td></tr>
            ) : loading ? (
              <tr><td className="px-4 py-4 text-muted-foreground" colSpan={4}>Loading…</td></tr>
            ) : page?.items.length === 0 ? (
              <tr><td className="px-4 py-4 text-muted-foreground" colSpan={4}>No activity recorded yet.</td></tr>
            ) : (
              page?.items.map((row) => (
                <tr key={row.id} className="border-b border-card-border last:border-0">
                  <td className="max-w-[260px] truncate px-4 py-2.5" title={row.action}>{row.action}</td>
                  <td className="max-w-[180px] truncate px-4 py-2.5" title={row.userName}>{row.userName}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{new Date(row.time).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.ipAddress ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  );
}
