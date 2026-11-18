import { useState } from "react";
import { Skeleton } from "../ui/skeleton";
import { REGISTRY } from "../../modules/registry";
import { SwitchRow } from "../settings/SettingsRow";
import { SettingsCard } from "../settings/SettingsCard";
import { cn } from "../../lib/utils";
import {
  ADMIN_MODULE_KEYS,
  FIELD_SECURITY_LABELS,
  MFG_ROLES,
  useRolesPermissions,
  type RolePermissionRow,
} from "../../hooks/useRolesPermissions";

const RECORD_ACCESS_OPTIONS = ["OWN", "TEAM", "ALL"] as const;
const CRUDE: { key: keyof RolePermissionRow; label: string }[] = [
  { key: "canCreate", label: "C" },
  { key: "canRead", label: "R" },
  { key: "canUpdate", label: "U" },
  { key: "canDelete", label: "D" },
  { key: "canExport", label: "E" },
];

interface RolesPermissionsTabProps {
  readonly canEdit: boolean;
}

// README §3.6 "Roles & permissions": role chips, a record-access select, a module x CRUDE
// checkbox matrix, and the six field-security toggles — all driven from the RolePermission /
// FieldPermission rows seeded per org (manufacturing-defaults.data.ts).
export function RolesPermissionsTab({ canEdit }: RolesPermissionsTabProps) {
  const { rolePermissions, fieldPermissions, loading, error, saveRolePermission, saveFieldPermission } =
    useRolesPermissions();
  const [selectedRole, setSelectedRole] = useState<string>(MFG_ROLES[0].value);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  const rowsForRole = new Map(
    rolePermissions.filter((r) => r.role === selectedRole).map((r) => [r.moduleKey, r]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {MFG_ROLES.map((role) => (
          <button
            key={role.value}
            type="button"
            onClick={() => setSelectedRole(role.value)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium border",
              selectedRole === role.value ? "bg-foreground text-card border-foreground" : "bg-card border-border text-muted-foreground",
            )}
          >
            {role.label}
          </button>
        ))}
      </div>

      <SettingsCard title="Module access" description="Record access and create / read / update / delete / export rights per module.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card-subtle">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Module</th>
              <th className="text-left px-3 py-2 font-medium">Record access</th>
              {CRUDE.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium text-center">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ADMIN_MODULE_KEYS.map((moduleKey) => {
              const row = rowsForRole.get(moduleKey);
              if (!row) {
                return (
                  <tr key={moduleKey} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{REGISTRY[moduleKey]?.title ?? moduleKey}</td>
                    <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">
                      Not configured
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={moduleKey} className="border-t border-border">
                  <td className="px-3 py-2">{REGISTRY[moduleKey]?.title ?? moduleKey}</td>
                  <td className="px-3 py-2">
                    <select
                      value={row.recordAccess}
                      disabled={!canEdit}
                      onChange={(e) => void saveRolePermission(row.id, { recordAccess: e.target.value })}
                      className="h-8 rounded-md border border-input-border bg-card px-2 text-xs text-foreground"
                    >
                      {RECORD_ACCESS_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  {CRUDE.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={Boolean(row[c.key])}
                        onChange={(e) => void saveRolePermission(row.id, { [c.key]: e.target.checked })}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </SettingsCard>

      <SettingsCard
        title="Field security"
        description={`When on, ${MFG_ROLES.find((r) => r.value === selectedRole)?.label} does NOT see this field — it is masked in the API response and exports.`}
      >
        {FIELD_SECURITY_LABELS.map((label) => {
          const row = fieldPermissions.find((f) => f.fieldLabel === label);
          const restricted = row?.restrictedToRoles.includes(selectedRole) ?? false;
          return (
            <SwitchRow
              key={label}
              label={label}
              ariaLabel={`Restrict ${label} for ${selectedRole}`}
              checked={restricted}
              disabled={!canEdit || !row}
              onCheckedChange={(next) => {
                if (!row) return;
                const nextRoles = next
                  ? [...row.restrictedToRoles, selectedRole]
                  : row.restrictedToRoles.filter((r) => r !== selectedRole);
                void saveFieldPermission(row.id, nextRoles);
              }}
            />
          );
        })}
      </SettingsCard>
    </div>
  );
}
