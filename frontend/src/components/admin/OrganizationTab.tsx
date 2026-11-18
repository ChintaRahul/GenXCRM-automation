import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsRow, SwitchRow } from "../settings/SettingsRow";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import { getOrgLogoUploadUrl, getOrgLogoDownloadUrl } from "../../api/client";
import type { Organization, Industry, OrgSize } from "../../types";

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB — plenty for a header logo, keeps invoice PDFs small
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg"];

// Indian GSTIN: 2-digit state code + 10-char PAN + entity digit + 'Z' + checksum (15 chars).
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const INDUSTRIES: { value: Industry; label: string }[] = [
  { value: "EDTECH", label: "EdTech" },
  { value: "REAL_ESTATE", label: "Real Estate" },
  { value: "HEALTHCARE", label: "Healthcare" },
  { value: "FINANCIAL_SERVICES", label: "Financial Services" },
  { value: "ECOMMERCE", label: "E-commerce" },
  { value: "SAAS_TECHNOLOGY", label: "SaaS / Technology" },
  { value: "CONSULTING", label: "Consulting" },
  { value: "MANUFACTURING", label: "Manufacturing" },
  { value: "HOSPITALITY", label: "Hospitality" },
  { value: "OTHER", label: "Other" },
];

const SIZES: { value: OrgSize; label: string }[] = [
  { value: "MICRO", label: "1–10 employees" },
  { value: "SMALL", label: "11–50 employees" },
  { value: "MEDIUM", label: "51–200 employees" },
  { value: "LARGE", label: "201–1000 employees" },
  { value: "ENTERPRISE", label: "1000+ employees" },
];

const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Kolkata", label: "India (IST, UTC+5:30)" },
  { value: "Asia/Dubai", label: "UAE (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore (SGT, UTC+8)" },
  { value: "Europe/London", label: "UK (GMT/BST)" },
];

interface OrganizationTabProps {
  profile: Organization;
  canEdit: boolean;
  onSave: (payload: {
    name: string;
    website?: string;
    industry: Industry;
    size: OrgSize;
    city?: string;
    state?: string;
    timezone: string;
    gstNumber?: string | null;
    notifyRepOnAssignment?: boolean;
    email?: string;
    phone?: string;
  }) => Promise<void>;
}

export function OrganizationTab({ profile, canEdit, onSave }: OrganizationTabProps) {
  const [form, setForm] = useState({
    name: profile.name,
    website: profile.website ?? "",
    industry: profile.industry,
    size: profile.size,
    city: profile.city ?? "",
    state: profile.state ?? "",
    timezone: profile.timezone,
    email: profile.email ?? "",
    phone: profile.phone ?? "",
  });
  const [gstNumber, setGstNumber] = useState(profile.gstNumber ?? "");
  const [gstError, setGstError] = useState<string | null>(null);
  const [notifyRepOnAssignment, setNotifyRepOnAssignment] = useState(profile.notifyRepOnAssignment ?? true);
  const [saving, setSaving] = useState(false);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getOrgLogoDownloadUrl()
      .then((r) => setLogoUrl(r.url))
      .catch(() => setLogoUrl(null));
  }, []);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      toast.error(Messages.admin.logoInvalidType);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(Messages.admin.logoTooLarge);
      return;
    }
    setUploadingLogo(true);
    try {
      const { uploadUrl } = await getOrgLogoUploadUrl({ contentType: file.type });
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      const { url } = await getOrgLogoDownloadUrl();
      setLogoUrl(url);
      toast.success(Messages.admin.logoUploaded);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.logoUploadFailed));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSave() {
    setGstError(null);
    const trimmedGst = gstNumber.trim().toUpperCase();
    if (trimmedGst && !GSTIN_REGEX.test(trimmedGst)) {
      setGstError("Enter a valid 15-character GSTIN.");
      return;
    }

    setSaving(true);
    try {
      await onSave({ ...form, gstNumber: trimmedGst || null, notifyRepOnAssignment });
      setGstNumber(trimmedGst);
      toast.success(Messages.admin.orgProfileSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  const text = (id: string, key: "name" | "website" | "email" | "phone" | "city" | "state", extra: object = {}) => (
    <Input
      id={id}
      value={form[key]}
      disabled={!canEdit}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      {...extra}
    />
  );

  return (
    <SettingsCard
      title="Organization profile"
      description="Shown on invoices and used as your workspace defaults."
      footer={
        <Button onClick={handleSave} disabled={!canEdit || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      }
    >
      <SettingsRow label="Company logo" helper="PNG or JPEG, up to 2MB. Shown on invoice PDFs.">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
          {logoUrl ? (
            <img src={logoUrl} alt="Organization logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoChange} />
        <Button type="button" variant="outline" size="sm" disabled={!canEdit || uploadingLogo} onClick={() => fileInputRef.current?.click()}>
          {uploadingLogo ? "Uploading…" : "Upload logo"}
        </Button>
      </SettingsRow>
      <SettingsRow label="Organization name" htmlFor="org-name">{text("org-name", "name")}</SettingsRow>
      <SettingsRow label="Website" htmlFor="org-website">{text("org-website", "website")}</SettingsRow>
      <SettingsRow label="Contact email" htmlFor="org-email" helper="Shown on invoice PDFs, in place of a staff member's email.">
        {text("org-email", "email", { type: "email", placeholder: "hello@yourcompany.com" })}
      </SettingsRow>
      <SettingsRow label="Contact phone" htmlFor="org-phone" helper="Shown on invoice PDFs, in place of a staff member's phone.">
        {text("org-phone", "phone", { placeholder: "+91 98765 43210" })}
      </SettingsRow>
      <SettingsRow label="Industry">
        <Select value={form.industry} disabled={!canEdit} onValueChange={(v) => setForm((f) => ({ ...f, industry: v as Industry }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((i) => (
              <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Company size">
        <Select value={form.size} disabled={!canEdit} onValueChange={(v) => setForm((f) => ({ ...f, size: v as OrgSize }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="City" htmlFor="org-city">{text("org-city", "city")}</SettingsRow>
      <SettingsRow label="State" htmlFor="org-state">{text("org-state", "state")}</SettingsRow>
      <SettingsRow label="Timezone">
        <Select value={form.timezone} disabled={!canEdit} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="GST number" htmlFor="org-gst" helper="Added to invoices sent to your students. Leave blank to skip.">
        <div className="w-full space-y-1">
          <Input
            id="org-gst"
            autoComplete="off"
            value={gstNumber}
            disabled={!canEdit}
            onChange={(e) => {
              setGstNumber(e.target.value.toUpperCase());
              setGstError(null);
            }}
            placeholder="e.g. 27ABCDE1234F1Z5"
            maxLength={15}
            className="font-mono uppercase tracking-wide"
            aria-invalid={!!gstError}
            aria-describedby={gstError ? "org-gst-error" : undefined}
          />
          {gstError && (
            <p id="org-gst-error" className="text-xs text-destructive">
              {gstError}
            </p>
          )}
        </div>
      </SettingsRow>
      <SwitchRow
        label="Email reps when a lead is assigned to them"
        helper="Turn off to stop assignment emails org-wide (leads still get assigned as normal)."
        checked={notifyRepOnAssignment}
        disabled={!canEdit}
        onCheckedChange={setNotifyRepOnAssignment}
      />
    </SettingsCard>
  );
}
