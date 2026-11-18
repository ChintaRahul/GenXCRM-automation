import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsRow } from "../settings/SettingsRow";
import { apiErrorMessage } from "../../lib/apiError";
import { Messages } from "../../lib/messages";
import type { MessageTemplate, PaymentSettings } from "../../types";

const NONE = "__none__";

interface PaymentsTabProps {
  payments: PaymentSettings;
  templates: MessageTemplate[];
  canEdit: boolean;
  onSave: (value: PaymentSettings) => Promise<void>;
}

interface TemplateRowProps {
  label: string;
  emptyText: string;
  noneLabel: string;
  options: MessageTemplate[];
  value: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}

function TemplateRow({
  label,
  emptyText,
  noneLabel,
  options,
  value,
  disabled,
  onChange,
}: TemplateRowProps) {
  return (
    <SettingsRow label={label}>
      {options.length === 0 ? (
        <span className="text-sm text-muted-foreground">{emptyText}</span>
      ) : (
        <Select value={value ?? NONE} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? null : v)}>
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{noneLabel}</SelectItem>
            {options.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingsRow>
  );
}

export function PaymentsTab({
  payments,
  templates,
  canEdit,
  onSave,
}: PaymentsTabProps) {
  const [form, setForm] = useState(payments);
  const [saving, setSaving] = useState(false);

  const approvedWhatsapp = templates.filter(
    (t) => t.channel === "WHATSAPP" && t.status === "APPROVED",
  );
  const emailTemplates = templates.filter((t) => t.channel === "EMAIL");

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
      toast.success(Messages.admin.paymentsSaved);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.admin.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="EMI reminders"
      description={
        <>
          Which templates to use when a rep sends an installment reminder. Without a WhatsApp template, reminders fall
          back to plain text, which WhatsApp only delivers within 24 hours of the lead's last message. Without an email
          template, a standard reminder email is sent. Create templates on the{" "}
          <Link to="/templates" className="text-primary hover:underline">
            Templates
          </Link>{" "}
          page.
        </>
      }
      footer={
        <Button onClick={save} disabled={!canEdit || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      }
    >
      <TemplateRow
        label="WhatsApp installment reminder template"
        emptyText="No approved WhatsApp templates yet."
        noneLabel="None — use plain text"
        options={approvedWhatsapp}
        value={form.emiReminderTemplateId}
        disabled={!canEdit}
        onChange={(id) => setForm((f) => ({ ...f, emiReminderTemplateId: id }))}
      />
      <TemplateRow
        label="Email installment reminder template"
        emptyText="No email templates yet."
        noneLabel="None — use the standard email"
        options={emailTemplates}
        value={form.emiReminderEmailTemplateId}
        disabled={!canEdit}
        onChange={(id) => setForm((f) => ({ ...f, emiReminderEmailTemplateId: id }))}
      />
    </SettingsCard>
  );
}
