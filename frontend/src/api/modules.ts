import api from "./client";
import type { PaginatedResponse } from "../types";
import type { ModuleColumn } from "../modules/registry";

export type ModuleRecord = Record<string, unknown> & { id: string };

export interface ModuleListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string[];
  ownerId?: string[];
  // JSON `{ field: string[] }` � module facet selections.
  facets?: string;
  datePreset?: string;
  from?: string;
  to?: string;
  // Rupees.
  valueMin?: number;
  valueMax?: number;
  slaRisk?: boolean;
  sort?: string;
}

// Live counts behind the Filters drawer (GET /modules/:key/facets). Counts are over the
// user's visible, search-filtered set, not the other active filters.
export interface ModuleFacets {
  readonly total: number;
  readonly status: Record<string, number>;
  readonly owners: readonly { id: string; name: string; count: number }[];
  readonly facets: Record<string, Record<string, number>>;
  readonly slaRiskCount: number;
  readonly capabilities: { owner: boolean; date: boolean; value: boolean; sla: boolean };
}

export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: Record<string, unknown>;
}

export async function getModuleFacets(moduleKey: string, params: Pick<ModuleListParams, "search">): Promise<ModuleFacets> {
  const { data } = await api.get<ModuleFacets>(`/modules/${moduleKey}/facets`, { params });
  return data;
}

export async function getModuleList(
  moduleKey: string,
  params: ModuleListParams,
): Promise<PaginatedResponse<ModuleRecord>> {
  const { data } = await api.get<PaginatedResponse<ModuleRecord>>(`/modules/${moduleKey}`, { params });
  return data;
}

// Module keys the caller's role can read; null = unrestricted.
export async function getReadableModules(): Promise<string[] | null> {
  const { data } = await api.get<{ readable: string[] | null }>("/modules/access");
  return data.readable;
}

export interface ModuleRights {
  readonly create: boolean;
  readonly read: boolean;
  readonly update: boolean;
  readonly delete: boolean;
}

// What the signed-in role may do per module; null = unrestricted.
export async function getModuleRights(): Promise<Record<string, ModuleRights> | null> {
  const { data } = await api.get<{ rights?: Record<string, ModuleRights> | null }>("/modules/access");
  return data.rights ?? null;
}

export async function getModuleRecord(moduleKey: string, id: string): Promise<ModuleRecord> {
  const { data } = await api.get<ModuleRecord>(`/modules/${moduleKey}/${id}`);
  return data;
}

export async function createModuleRecord(
  moduleKey: string,
  payload: Record<string, unknown>,
): Promise<ModuleRecord> {
  const { data } = await api.post<ModuleRecord>(`/modules/${moduleKey}`, payload);
  return data;
}

export async function updateModuleRecord(
  moduleKey: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<ModuleRecord> {
  const { data } = await api.patch<ModuleRecord>(`/modules/${moduleKey}/${id}`, payload);
  return data;
}

export async function performModuleAction(
  moduleKey: string,
  id: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<ModuleRecord> {
  const { data } = await api.post<ModuleRecord>(`/modules/${moduleKey}/${id}/actions`, { action, ...payload });
  return data;
}

export async function archiveModuleRecord(moduleKey: string, id: string): Promise<void> {
  await api.post(`/modules/${moduleKey}/${id}/archive`);
}

export async function getModuleRelated(
  moduleKey: string,
  id: string,
  tabKey: string,
  params: { page: number; limit: number },
): Promise<PaginatedResponse<ModuleRecord>> {
  const { data } = await api.get<PaginatedResponse<ModuleRecord>>(
    `/modules/${moduleKey}/${id}/related/${tabKey}`,
    { params },
  );
  return data;
}

export interface TableTabData {
  readonly columns: readonly ModuleColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly totals?: Record<string, unknown>;
}

export interface EventItem {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly description?: string;
  readonly actor?: string;
}

export interface DocumentItem {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly createdAt: string;
  readonly url: string;
}

export interface AuditEntry {
  readonly id: string;
  readonly at: string;
  readonly user: string;
  readonly field: string;
  readonly oldValue: string;
  readonly newValue: string;
}

export async function getModuleTable(moduleKey: string, id: string, tabKey: string): Promise<TableTabData> {
  const { data } = await api.get<TableTabData>(`/modules/${moduleKey}/${id}/table/${tabKey}`);
  return data;
}

export async function addModuleTableRow(moduleKey: string, id: string, tabKey: string, row: Record<string, unknown>): Promise<TableTabData> {
  const { data } = await api.post<TableTabData>(`/modules/${moduleKey}/${id}/table/${tabKey}`, row);
  return data;
}

export async function removeModuleTableRow(moduleKey: string, id: string, tabKey: string, rowId: string): Promise<TableTabData> {
  const { data } = await api.delete<TableTabData>(`/modules/${moduleKey}/${id}/table/${tabKey}/${rowId}`);
  return data;
}

export async function getModuleEvents(moduleKey: string, id: string, tabKey: string): Promise<EventItem[]> {
  const { data } = await api.get<EventItem[]>(`/modules/${moduleKey}/${id}/events/${tabKey}`);
  return data;
}

export async function getModuleDocuments(moduleKey: string, id: string): Promise<DocumentItem[]> {
  const { data } = await api.get<DocumentItem[]>(`/modules/${moduleKey}/${id}/documents`);
  return data;
}

export async function initModuleDocument(
  moduleKey: string,
  id: string,
  body: { fileName: string; mimeType: string; fileSize: number },
): Promise<{ documentId: string; uploadUrl: string }> {
  const { data } = await api.post<{ documentId: string; uploadUrl: string }>(`/modules/${moduleKey}/${id}/documents`, body);
  return data;
}

export async function completeModuleDocument(moduleKey: string, id: string, documentId: string): Promise<void> {
  await api.post(`/modules/${moduleKey}/${id}/documents/${documentId}/complete`);
}

export async function deleteModuleDocument(moduleKey: string, id: string, documentId: string): Promise<void> {
  await api.delete(`/modules/${moduleKey}/${id}/documents/${documentId}`);
}

export async function getModuleAudit(moduleKey: string, id: string): Promise<AuditEntry[]> {
  const { data } = await api.get<AuditEntry[]>(`/modules/${moduleKey}/${id}/audit`);
  return data;
}

export async function getColumnPrefs(moduleKey: string): Promise<string[] | null> {
  const { data } = await api.get<string[] | null | "">(`/modules/${moduleKey}/column-prefs`);
  // "No preference saved yet" comes back as an empty body (axios gives ""), not a JSON null —
  // normalise anything that isn't a saved list to null so every column stays visible.
  return Array.isArray(data) ? data : null;
}

export async function saveColumnPrefs(moduleKey: string, keys: readonly string[]): Promise<void> {
  await api.put(`/modules/${moduleKey}/column-prefs`, { keys });
}

export async function listModuleViews(moduleKey: string): Promise<SavedView[]> {
  const { data } = await api.get<SavedView[]>(`/modules/${moduleKey}/views`);
  return data;
}

export async function saveModuleView(moduleKey: string, view: { name: string; filters: Record<string, unknown> }): Promise<SavedView> {
  const { data } = await api.post<SavedView>(`/modules/${moduleKey}/views`, view);
  return data;
}

export async function deleteModuleView(moduleKey: string, id: string): Promise<void> {
  await api.delete(`/modules/${moduleKey}/views/${id}`);
}

export async function exportModuleList(moduleKey: string, params: ModuleListParams): Promise<Blob> {
  const { data } = await api.get<Blob>(`/modules/${moduleKey}/export`, { params, responseType: "blob" });
  return data;
}

interface DownloadableFile {
  blob: Blob;
  filename: string;
}

function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? fallback;
}

export async function getModulePdf(moduleKey: string, id: string): Promise<DownloadableFile> {
  const response = await api.get(`/modules/${moduleKey}/${id}/pdf`, { responseType: "blob" });
  return { blob: response.data, filename: filenameFromContentDisposition(response.headers["content-disposition"], `${moduleKey}-${id}.pdf`) };
}

export async function getModuleIcs(moduleKey: string, id: string): Promise<DownloadableFile> {
  const response = await api.get(`/modules/${moduleKey}/${id}/calendar.ics`, { responseType: "blob" });
  return { blob: response.data, filename: `${moduleKey}-${id}.ics` };
}

export async function getModuleCsv(moduleKey: string, id: string): Promise<DownloadableFile> {
  const response = await api.get(`/modules/${moduleKey}/${id}/csv`, { responseType: "blob" });
  return { blob: response.data, filename: filenameFromContentDisposition(response.headers["content-disposition"], `${moduleKey}-${id}.csv`) };
}

export interface ModuleImportResult {
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: readonly { row: number; reason: string }[];
}

export async function importModuleRows(moduleKey: string, rows: Record<string, unknown>[]): Promise<ModuleImportResult> {
  const { data } = await api.post<ModuleImportResult>(`/modules/${moduleKey}/import`, { rows });
  return data;
}
