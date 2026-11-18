import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ComingSoonBadge } from "../shared/AdminStatusBadges";
import type { AuditLogPage } from "../../types";

interface PrivacyTabProps {
  canEdit: boolean;
  auditLog: AuditLogPage | null;
  auditLoading: boolean;
  auditPage: number;
  onAuditPageChange: (page: number) => void;
}

export function PrivacyTab({ auditLog, auditLoading, auditPage, onAuditPageChange }: PrivacyTabProps) {
  const [erasureEmail, setErasureEmail] = useState("");

  const totalPages = auditLog ? Math.max(1, Math.ceil(auditLog.total / auditLog.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">Data export</h2>
          <ComingSoonBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          Request a full export of your organization's data (leads, users, payments, and
          activity) for GDPR compliance purposes.
        </p>
        <div className="flex justify-end">
          <Button disabled>Request data export</Button>
        </div>
        <p className="text-xs text-muted-foreground">Data export isn't available yet — contact support to request one.</p>
      </div>

      <div className="bg-card border-2 border-destructive/30 rounded-xl p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">Right to erasure</h2>
          <ComingSoonBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          Permanently null out a lead's name, phone, and email by their email address. This
          cannot be undone.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="flex-1 min-w-[220px]"
            type="email"
            placeholder="lead@example.com"
            value={erasureEmail}
            disabled
            onChange={(e) => setErasureEmail(e.target.value)}
          />
          <Button variant="destructive" disabled>
            Process erasure request
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Right-to-erasure requests aren't available in-app yet — contact support.</p>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6 space-y-3">
        <h2 className="text-base font-semibold text-foreground">Audit log</h2>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Action</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">User</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Time</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLoading ? (
                <tr><td className="px-4 py-4 text-muted-foreground" colSpan={4}>Loading…</td></tr>
              ) : auditLog?.items.length === 0 ? (
                <tr><td className="px-4 py-4 text-muted-foreground" colSpan={4}>No activity recorded yet.</td></tr>
              ) : (
                auditLog?.items.map((row) => (
                  <tr key={row.id} className="border-b border-card-border last:border-0">
                    <td className="px-4 py-2.5">{row.action}</td>
                    <td className="px-4 py-2.5">{row.userName}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{new Date(row.time).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.ipAddress ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {auditLog && totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={auditPage <= 1} onClick={() => onAuditPageChange(auditPage - 1)}>
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {auditPage} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={auditPage >= totalPages} onClick={() => onAuditPageChange(auditPage + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
