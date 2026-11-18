import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { completeProfile } from "../api/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { WorkspaceStep } from "../components/register/WorkspaceStep";
import type { OrgSize, WorkspaceType } from "../types";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

const ORG_SIZES: { value: OrgSize; label: string }[] = [
  { value: "MICRO", label: "1–10 employees" },
  { value: "SMALL", label: "11–50 employees" },
  { value: "MEDIUM", label: "51–200 employees" },
  { value: "LARGE", label: "201–500 employees" },
  { value: "ENTERPRISE", label: "500+ employees" },
];

const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Singapore",
  "Australia",
  "Canada",
  "Germany",
  "France",
  "Japan",
  "South Africa",
  "Malaysia",
  "Philippines",
  "Bangladesh",
  "Sri Lanka",
  "Other",
];

const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Kolkata", label: "India (IST, UTC+5:30)" },
  { value: "Asia/Dubai", label: "UAE (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore (SGT, UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia (MYT, UTC+8)" },
  { value: "Asia/Tokyo", label: "Japan (JST, UTC+9)" },
  { value: "Asia/Dhaka", label: "Bangladesh (BST, UTC+6)" },
  { value: "Asia/Colombo", label: "Sri Lanka (IST, UTC+5:30)" },
  { value: "Europe/London", label: "UK (GMT/BST)" },
  { value: "Europe/Berlin", label: "Germany (CET, UTC+1)" },
  { value: "Europe/Paris", label: "France (CET, UTC+1)" },
  { value: "America/New_York", label: "US Eastern (EST, UTC-5)" },
  { value: "America/Chicago", label: "US Central (CST, UTC-6)" },
  { value: "America/Los_Angeles", label: "US Pacific (PST, UTC-8)" },
  { value: "America/Toronto", label: "Canada Eastern (EST, UTC-5)" },
  { value: "Australia/Sydney", label: "Australia Eastern (AEST, UTC+10)" },
  { value: "Africa/Johannesburg", label: "South Africa (SAST, UTC+2)" },
];

const selectCls =
  "w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

interface Form {
  orgName: string;
  orgSize: OrgSize | "";
  website: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
}

type RequiredFields = "orgName" | "orgSize";

export default function RegisterCompletePage() {
  const { user, updateUser, signOut } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<Form>({
    orgName: "",
    orgSize: "",
    website: "",
    city: "",
    state: "",
    country: "India",
    timezone: "Asia/Kolkata",
  });
  const [errors, setErrors] = useState<Partial<Record<RequiredFields, string>>>(
    {},
  );
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [phase, setPhase] = useState<"workspace" | "org">("workspace");
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType | "">("");

  if (user?.orgId) {
    navigate("/", { replace: true });
    return null;
  }

  function change(field: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [field]: e.target.value }));
  }

  function validate(): boolean {
    const next: Partial<Record<RequiredFields, string>> = {};
    if (!form.orgName.trim()) next.orgName = "Organization name is required";
    if (!form.orgSize) next.orgSize = "Please select your team size";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError("");
    setLoading(true);
    try {
      const { token } = await completeProfile({
        orgName: form.orgName,
        workspaceType: workspaceType as WorkspaceType,
        orgSize: form.orgSize as OrgSize,
        website: form.website || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        country: form.country,
        timezone: form.timezone,
        acceptedTerms,
      });
      // Store the fresh token — it now includes orgId so all subsequent API calls are tenant-scoped
      localStorage.setItem("token", token);
      if (user) updateUser({ ...user, orgId: "pending" });
      navigate("/", { replace: true });
    } catch (err) {
      setSubmitError(apiErrorMessage(err, Messages.register.orgSaveFailed));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-10">
      <div className="w-full max-w-md">
        <div className="bg-card border border-card-border rounded-xl p-8 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <img src="/logo-mark.png" alt="GenX CRM" className="w-9 h-9 object-contain" />
            <div>
              <p className="font-display font-bold text-foreground">GenX CRM</p>
              <p className="text-xs text-muted-foreground">One more step</p>
            </div>
          </div>

          {phase === "workspace" ? (
            <WorkspaceStep
              value={workspaceType}
              onConfirm={(type) => {
                setWorkspaceType(type);
                setPhase("org");
              }}
              onBack={() => {
                signOut();
                navigate("/login");
              }}
            />
          ) : (
            <>
              <h1 className="text-lg font-semibold text-foreground mb-1">
                Set up your workspace
              </h1>
              <p className="text-sm text-muted-foreground mb-5">
                Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}! Tell us
                about your organization to complete setup.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <Label htmlFor="orgName">
                    Organization name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="orgName"
                    type="text"
                    value={form.orgName}
                    onChange={change("orgName")}
                    placeholder="Acme Edu Pvt. Ltd."
                    className={errors.orgName ? "border-destructive" : ""}
                  />
                  {errors.orgName && (
                    <p className="text-xs text-destructive">{errors.orgName}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="orgSize">
                    Team size <span className="text-destructive">*</span>
                  </Label>
                  <select
                    id="orgSize"
                    value={form.orgSize}
                    onChange={change("orgSize")}
                    className={`${selectCls} ${errors.orgSize ? "border-destructive" : ""}`}
                  >
                    <option value="">Select…</option>
                    {ORG_SIZES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {errors.orgSize && <p className="text-xs text-destructive">{errors.orgSize}</p>}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="website">
                    Website{" "}
                    <span className="text-muted-foreground text-xs font-normal">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="website"
                    type="url"
                    value={form.website}
                    onChange={change("website")}
                    placeholder="https://yourcompany.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="city">
                      City{" "}
                      <span className="text-muted-foreground text-xs font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Input id="city" type="text" value={form.city} onChange={change("city")} placeholder="Bangalore" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="state">
                      State{" "}
                      <span className="text-muted-foreground text-xs font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Input id="state" type="text" value={form.state} onChange={change("state")} placeholder="Karnataka" />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="country">
                    Country <span className="text-destructive">*</span>
                  </Label>
                  <select id="country" value={form.country} onChange={change("country")} className={selectCls}>
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="timezone">
                    Timezone <span className="text-destructive">*</span>
                  </Label>
                  <select id="timezone" value={form.timezone} onChange={change("timezone")} className={selectCls}>
                    {TIMEZONES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                  />
                  <span>
                    I agree to the{" "}
                    <a
                      href="/terms#plan-limits"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      Terms of Service
                    </a>
                    , including the plan limits for the free trial.
                  </span>
                </label>

                {submitError && <p className="text-sm text-destructive">{submitError}</p>}

                <Button type="submit" className="w-full" disabled={loading || !acceptedTerms}>
                  {loading ? "Setting up…" : "Complete setup"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
