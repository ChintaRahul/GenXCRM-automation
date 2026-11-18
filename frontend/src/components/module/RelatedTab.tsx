import type { ModuleRecord } from "../../api/modules";
import { useModuleRelated } from "../../hooks/useModuleRelated";
import { REGISTRY, type ModuleTab } from "../../modules/registry";
import { renderCell } from "../../lib/moduleCells";
import { NO_ACCESS_MESSAGE } from "../../lib/loadError";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";
import { Button } from "../ui/button";
import { Plus } from "lucide-react";

interface RelatedTabProps {
  parentModuleKey: string;
  parentId: string;
  tab: ModuleTab;
  onRowClick?: (record: ModuleRecord) => void;
  onNewRelated?: () => void;
}

export function RelatedTab({ parentModuleKey, parentId, tab, onRowClick, onNewRelated }: RelatedTabProps) {
  const { records, loading, error } = useModuleRelated(parentModuleKey, parentId, tab.key);

  const relatedDef = tab.relatedModule ? REGISTRY[tab.relatedModule] : undefined;
  if (!relatedDef) return null;

  return (
    <div className="space-y-3">
      {onNewRelated && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onNewRelated}>
            <Plus className="w-4 h-4 mr-1.5" /> New {relatedDef.singular}
          </Button>
        </div>
      )}
      {error ? (
        <p className="text-sm text-destructive py-4">{error === NO_ACCESS_MESSAGE ? error : `Couldn't load ${relatedDef.title.toLowerCase()}.`}</p>
      ) : !loading && records.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No {relatedDef.title.toLowerCase()} yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {relatedDef.cols.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id} className="cursor-pointer" onClick={() => onRowClick?.(record)}>
                {relatedDef.cols.map((col) => (
                  <TableCell key={col.key}>{renderCell(col, record, relatedDef)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
