import { useCallback, useState } from "react";
import { toast } from "sonner";
import { exportModuleList, type ModuleListParams } from "../api/modules";

export function useModuleExport(moduleKey: string) {
  const [exporting, setExporting] = useState(false);

  const exportNow = useCallback(
    async (params: ModuleListParams) => {
      setExporting(true);
      try {
        const blob = await exportModuleList(moduleKey, params);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${moduleKey}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      } catch {
        toast.error(`Couldn't export ${moduleKey}.`);
      } finally {
        setExporting(false);
      }
    },
    [moduleKey],
  );

  return { exporting, exportNow };
}
