import { FileSpreadsheet, Table, FileText, Mail } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { Button } from "../../ui/button";

interface ExportSectionProps {
  scopeLabel: string;
  rowCount: number;
  onExport: (format: "excel" | "csv" | "pdf") => void;
}

export function ExportSection({ scopeLabel, rowCount, onExport }: ExportSectionProps) {
  return (
    <section>
      <SectionHeader number="11" title="Export this report" />
      <div className="bg-card border border-card-border rounded-xl flex flex-wrap items-center justify-between gap-5 p-5">
        <div>
          <p className="text-sm font-medium text-foreground">{scopeLabel}</p>
          <p className="text-xs text-muted-foreground mt-0.5">11 sections, {rowCount} lead rows</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onExport("excel")}>
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel (.xlsx)
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExport("csv")}>
            <Table className="w-3.5 h-3.5" />
            CSV
          </Button>
          <Button size="sm" onClick={() => onExport("pdf")}>
            <FileText className="w-3.5 h-3.5" />
            PDF report
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExport("pdf")}>
            <Mail className="w-3.5 h-3.5" />
            Schedule daily email
          </Button>
        </div>
      </div>
    </section>
  );
}
