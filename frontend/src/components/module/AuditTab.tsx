import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";
import { useModuleAudit } from "../../hooks/useModuleAudit";
import { formatDate } from "../../lib/moduleCells";
import { REGISTRY } from "../../modules/registry";

export function AuditTab({ moduleKey, id }: { readonly moduleKey: string; readonly id: string }) {
  const { entries, loading, error } = useModuleAudit(moduleKey, id);

  if (error) return <p className="text-sm text-destructive py-4">Couldn&apos;t load the audit trail.</p>;
  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  if (!loading && entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No changes recorded yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Field</TableHead>
          <TableHead>Old</TableHead>
          <TableHead>New</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.id}>
            <TableCell>{formatDate(e.at)}</TableCell>
            <TableCell>{e.user}</TableCell>
            <TableCell>{REGISTRY[moduleKey]?.fields.find((f) => f.key === e.field)?.label ?? e.field}</TableCell>
            <TableCell className="max-w-[240px] truncate text-destructive" title={e.oldValue}>{e.oldValue}</TableCell>
            <TableCell className="max-w-[240px] truncate text-success-text" title={e.newValue}>{e.newValue}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
