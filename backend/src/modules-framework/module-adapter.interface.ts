import type { AuthUser } from '../common/types/auth-user.type';
import type { ModuleFacets } from './utils/list-filters.util';

export interface ModuleListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: string[];
  ownerId?: string[];
  // JSON `{ field: string[] }`, parsed and whitelisted by buildListFilters.
  facets?: string;
  datePreset?: string;
  from?: string;
  to?: string;
  valueMin?: number;
  valueMax?: number;
  slaRisk?: boolean;
  sort?: string;
}

export interface ModulePaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ModuleTableColumn {
  key: string;
  label: string;
  type: string;
}

export interface ModuleTableResult {
  columns: ModuleTableColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

export interface ModuleEventItem {
  id: string;
  at: string;
  label: string;
  description?: string;
  actor?: string;
}

// Outcome of a bulk CSV import: rows created, rows skipped as duplicates, and per-row problems (1-based).
export interface ModuleImportResult {
  imported: number;
  duplicates: number;
  errors: { row: number; reason: string }[];
}

export interface ModuleAdapter<T = Record<string, unknown>> {
  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<T>>;
  // Live filter-option counts for the list's Filters drawer. Modules without filters omit it.
  getFacets?(query: ModuleListQuery, caller: AuthUser): Promise<ModuleFacets>;
  findOne(id: string, caller: AuthUser): Promise<T>;
  create(dto: Record<string, unknown>, caller: AuthUser): Promise<T>;
  update(id: string, dto: Record<string, unknown>, caller: AuthUser): Promise<T>;
  archive(id: string, caller: AuthUser): Promise<void>;
  performAction?(
    id: string,
    action: string,
    payload: Record<string, unknown> | undefined,
    caller: AuthUser,
  ): Promise<T>;
  // Bulk-creates records from parsed CSV rows. Modules without an import simply omit it.
  importRows?(rows: Record<string, unknown>[], caller: AuthUser): Promise<ModuleImportResult>;
  getTable?(id: string, tabKey: string, caller: AuthUser): Promise<ModuleTableResult>;
  addTableRow?(id: string, tabKey: string, dto: Record<string, unknown>, caller: AuthUser): Promise<void>;
  removeTableRow?(id: string, tabKey: string, rowId: string, caller: AuthUser): Promise<void>;
  getEvents?(id: string, tabKey: string, caller: AuthUser): Promise<ModuleEventItem[]>;
  getRelated?(
    id: string,
    tabKey: string,
    query: { page: number; limit: number },
    caller: AuthUser,
  ): Promise<ModulePaginatedResult<Record<string, unknown>>>;
  // Real PDF generation (PDFKit) for the "pdf"-type special actions — quotations, site visit
  // reports, and report exports. Modules without a PDF concept simply omit this.
  getPdf?(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }>;
  // CSV generation for the reports module's "Export Excel" action — CSV opens natively in
  // Excel, so no xlsx-writing dependency is needed for this to be a real file, not a placeholder.
  getCsv?(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }>;
}
