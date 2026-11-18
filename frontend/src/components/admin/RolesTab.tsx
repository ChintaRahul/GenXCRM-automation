import { Check, Minus } from "lucide-react";
import { Link } from "react-router-dom";

const PERMISSIONS = [
  "View leads",
  "Edit leads",
  "Delete leads",
  "Manage team",
  "Manage billing",
  "View reports",
  "Integrations",
  "Nurturing",
] as const;

const ROLES: { name: string; description: string; granted: Set<(typeof PERMISSIONS)[number]> }[] = [
  {
    name: "Director",
    description: "Full access across the organization",
    granted: new Set(PERMISSIONS),
  },
  {
    name: "Manager",
    description: "Manages their own team's leads and pipeline",
    granted: new Set(["View leads", "Edit leads", "Manage team", "View reports", "Integrations", "Nurturing"]),
  },
  {
    name: "Sales Rep",
    description: "Works their own assigned leads",
    granted: new Set(["View leads", "Edit leads"]),
  },
];

export function RolesTab() {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Roles & permissions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          GenXCRM uses a fixed 3-tier hierarchy — Director, Manager, and Sales Rep. Custom roles
          aren't supported. Role assignment happens on the{" "}
          <Link to="/users" className="text-primary hover:underline">Team page</Link>.
        </p>
      </div>
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left px-4 py-2 text-muted-foreground font-medium">Role</th>
              {PERMISSIONS.map((p) => (
                <th key={p} className="text-center px-2 py-2 text-muted-foreground font-medium whitespace-nowrap">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role.name} className="border-b border-card-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{role.name}</p>
                  <p className="text-xs text-muted-foreground">{role.description}</p>
                </td>
                {PERMISSIONS.map((p) => (
                  <td key={p} className="text-center px-2 py-3">
                    {role.granted.has(p) ? (
                      <Check className="w-4 h-4 mx-auto text-success" />
                    ) : (
                      <Minus className="w-4 h-4 mx-auto text-muted-foreground" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
