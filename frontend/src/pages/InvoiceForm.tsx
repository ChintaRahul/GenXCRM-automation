import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";
import { Header } from "../components/layout/Header";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Skeleton } from "../components/ui/skeleton";
import { LineItemsTable, type RegistrationLineItem } from "../components/invoices/LineItemsTable";
import { TaxSettingsCard } from "../components/invoices/TaxSettingsCard";
import { TotalsCard, computeInvoiceTotalsClient } from "../components/invoices/TotalsCard";
import { EmiScheduleCard } from "../components/invoices/EmiScheduleCard";
import { useCourses } from "../hooks/useCourses";
import { useInvoice, useNextInvoiceNumber } from "../hooks/useInvoices";
import { usePaymentGateways } from "../hooks/usePaymentGateways";
import { getLead, getLeads, createInvoice, updateInvoice, sendInvoice } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { cn, initials } from "../lib/utils";
import type { DiscountType, GstType, InvoiceStatus, PaymentGatewayName } from "../types";

// The minimal lead shape this form needs to render the picker — a full `Lead` when
// coming from search results, or just `{ id, name }` when coming from an existing
// invoice's `lead` relation or a fetched-by-id lookup (Duplicate handoff).
interface LeadOption {
  id: string;
  name: string;
  email?: string | null;
  phone?: string;
}

// Shape InvoiceRowActions.tsx (Task 9) hands off via navigate("/invoices/new", { state }) —
// see frontend/src/components/invoices/InvoiceRowActions.tsx's handleDuplicate.
interface DuplicateFromState {
  leadId: string;
  lineItems: { courseId?: string | null; courseName: string; quantity: number; unitPrice: number }[];
  gstEnabled: boolean;
  gstType: GstType;
  gstRate: number;
  discountType: DiscountType;
  discountValue: number;
  notes?: string | null;
}

const EMPTY_LINE_ITEM: RegistrationLineItem = { courseName: "", quantity: 1, unitPrice: 0 };

function toLineItems(
  items: { courseId?: string | null; courseName: string; quantity: number; unitPrice: number }[],
): RegistrationLineItem[] {
  return items.length > 0
    ? items.map((li) => ({
        courseId: li.courseId ?? undefined,
        courseName: li.courseName,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
      }))
    : [EMPTY_LINE_ITEM];
}

// Inline lead search + pick field, adapted from the pattern established in
// pages/RegisterNew.tsx's LeadPickerCard — trimmed to fit inside the "Invoice
// details" card as a single field rather than its own card, and rendered as an
// absolutely-positioned dropdown (max-h + overflow-y-auto per CLAUDE.md rule 9)
// since it lives inside a 3-up grid layout, not a standalone column.
function LeadField({
  selectedLead,
  onSelect,
}: {
  selectedLead: LeadOption | null;
  onSelect: (lead: LeadOption) => void;
}) {
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    let cancelled = false;
    // Debounced + guarded against out-of-order responses — see RegisterNew.tsx's
    // LeadPickerCard for the same pattern and why it's needed.
    const timeout = setTimeout(() => {
      void getLeads({ limit: 50, search: search || undefined })
        .then((res) => {
          if (!cancelled) setLeads(res.data);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [open, search]);

  return (
    <div className="relative">
      <Label className="block text-[11.5px] font-semibold text-muted-foreground mb-1.5">Lead</Label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm text-left"
      >
        {selectedLead ? (
          <>
            <Avatar className="w-5 h-5 flex-shrink-0">
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                {initials(selectedLead.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{selectedLead.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Select a lead…</span>
        )}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-lg">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search leads…"
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : leads.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No leads found</p>
            ) : (
              leads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => {
                    onSelect(lead);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 text-sm",
                    selectedLead?.id === lead.id && "bg-primary/10 text-primary",
                  )}
                >
                  <Avatar className="w-6 h-6 flex-shrink-0">
                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                      {initials(lead.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{lead.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lead.email ?? lead.phone}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Create/edit invoice form. Thin page (CLAUDE.md rule 7): all data fetching lives in
// hooks (useInvoice/useNextInvoiceNumber/useCourses); this page only orchestrates
// local form state and composes the presentational cards.
//
// Two integration points this page must honor (both finalized after this task's
// brief was written — see Task 10 dispatch context):
//  1. Register's "Generate Invoice →" (pages/RegisterNew.tsx) navigates
//     straight to `/invoices/:id/edit` for an invoice the backend already created via
//     generateFromRegistration + recordRegistrationPayment — normal edit-mode load-by-id
//     handles this with no special-casing.
//  2. Task 9's "Duplicate" row action (components/invoices/InvoiceRowActions.tsx)
//     navigates to `/invoices/new` with `location.state.duplicateFrom` — read below.
export default function InvoiceFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const isEdit = Boolean(id);

  const { courses } = useCourses();
  const { data: invoice, refetch: refetchInvoice } = useInvoice(id);
  const { data: nextNumber } = useNextInvoiceNumber();
  const { gateways } = usePaymentGateways();

  // Frozen at mount — this is a one-shot handoff from InvoiceRowActions' navigate(path,
  // { state }) call, not something that should re-trigger on re-render.
  const [duplicateFrom] = useState<DuplicateFromState | undefined>(
    () => (location.state as { duplicateFrom?: DuplicateFromState } | null)?.duplicateFrom,
  );

  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [lineItems, setLineItems] = useState<RegistrationLineItem[]>(() =>
    duplicateFrom ? toLineItems(duplicateFrom.lineItems) : [EMPTY_LINE_ITEM],
  );
  const [notes, setNotes] = useState(() => duplicateFrom?.notes ?? "");
  const [gstEnabled, setGstEnabled] = useState(() => duplicateFrom?.gstEnabled ?? true);
  const [gstType, setGstType] = useState<GstType>(() => duplicateFrom?.gstType ?? "CGST_SGST");
  const [gstRate, setGstRate] = useState(() => duplicateFrom?.gstRate ?? 18);
  const [discountType, setDiscountType] = useState<DiscountType>(
    () => duplicateFrom?.discountType ?? "PERCENT",
  );
  const [discountValue, setDiscountValue] = useState(() => duplicateFrom?.discountValue ?? 0);
  const [attachPaymentLink, setAttachPaymentLink] = useState(false);
  const [gatewayChoice, setGateway] = useState<PaymentGatewayName | null>(null);
  // No silent default: with several gateways connected the rep must pick one; with exactly
  // one connected it is pre-selected.
  const connectedGateways = gateways.filter((g) => g.connected);
  const gateway: PaymentGatewayName | null =
    gatewayChoice ?? (connectedGateways.length === 1 ? connectedGateways[0].gateway : null);
  const [status, setStatus] = useState<InvoiceStatus>("DRAFT");
  const [generatedFromRegistration, setGeneratedFromRegistration] = useState(false);

  const [editPopulated, setEditPopulated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Backend rejects any update() once an invoice is PAID or CANCELLED (voided) — mirror
  // that here so the buttons don't invite a doomed request.
  const isLocked = isEdit && (status === "PAID" || status === "CANCELLED");

  // Resolve the duplicated lead's name/email for display — InvoiceRowActions only
  // hands off `leadId`, not the lead's details.
  useEffect(() => {
    if (isEdit || !duplicateFrom?.leadId) return;
    void getLead(duplicateFrom.leadId)
      .then(setSelectedLead)
      .catch(() => {
        // Leave the lead picker empty — the user can pick manually.
      });
  }, [isEdit, duplicateFrom]);

  // Auto-generated invoice number for create mode — informational only (the server
  // always regenerates it authoritatively on submit; not included in the create/update
  // payload). Only applies once, and only if the field is still empty.
  useEffect(() => {
    if (isEdit) return;
    if (nextNumber?.invoiceNumber && !invoiceNumber) setInvoiceNumber(nextNumber.invoiceNumber);
  }, [isEdit, nextNumber, invoiceNumber]);

  // Populate all fields from the loaded invoice (edit mode). Gates the whole form's
  // render below on `editPopulated` so TaxSettingsCard/TotalsCard mount only once with
  // correct initial props — avoids needing an async resync effect inside those cards.
  useEffect(() => {
    if (!isEdit || !invoice || editPopulated) return;
    setSelectedLead(invoice.lead ? { id: invoice.lead.id, name: invoice.lead.name } : null);
    setInvoiceNumber(invoice.invoiceNumber);
    setInvoiceDate(invoice.invoiceDate.slice(0, 10));
    setDueDate(invoice.dueDate ? invoice.dueDate.slice(0, 10) : "");
    setLineItems(toLineItems(invoice.lineItems));
    setNotes(invoice.notes ?? "");
    setGstEnabled(invoice.gstEnabled);
    setGstType(invoice.gstType);
    setGstRate(invoice.gstRate);
    setDiscountType(invoice.discountType);
    setDiscountValue(invoice.discountValue);
    const mandateActive = invoice.emiPaymentMode === "SUBSCRIPTION" && !!invoice.emiMandateStatus;
    setAttachPaymentLink(mandateActive ? false : invoice.paymentLinkAttached);
    setGateway(invoice.paymentGateway ?? null);
    setStatus(invoice.status);
    setGeneratedFromRegistration(invoice.generatedFromRegistration);
    setEditPopulated(true);
  }, [isEdit, invoice, editPopulated]);

  const totals = useMemo(
    () =>
      computeInvoiceTotalsClient({
        lineItems: lineItems.map((li) => ({ quantity: li.quantity, unitPrice: li.unitPrice })),
        discountType,
        discountValue,
        gstEnabled,
        gstType,
        gstRate,
      }),
    [lineItems, discountType, discountValue, gstEnabled, gstType, gstRate],
  );

  function buildPayload(): Record<string, unknown> {
    return {
      leadId: selectedLead?.id,
      invoiceDate,
      dueDate: dueDate || undefined,
      notes: notes || undefined,
      lineItems: lineItems.map((li) => ({
        courseId: li.courseId,
        courseName: li.courseName,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
      })),
      gstEnabled,
      gstType,
      gstRate,
      discountType,
      discountValue,
    };
  }

  async function saveInvoice(): Promise<string> {
    const payload = buildPayload();
    const result = isEdit && id ? await updateInvoice(id, payload) : await createInvoice(payload);
    return result.id;
  }

  async function handleSaveDraft() {
    if (!selectedLead) {
      toast.error("Select a lead first");
      return;
    }
    if (isLocked) return;
    setSaving(true);
    try {
      await saveInvoice();
      toast.success(isEdit ? Messages.invoices.updated : Messages.invoices.created);
      navigate("/invoices");
    } catch (err) {
      toast.error(
        apiErrorMessage(err, isEdit ? Messages.invoices.updateFailed : Messages.invoices.createFailed),
      );
    } finally {
      setSaving(false);
    }
  }

  // Send is "never gated" client-side even for a registration-sourced invoice per the
  // README — the backend enforces the registeredAt requirement and this just surfaces
  // whatever 403 it returns via apiErrorMessage, same as any other failure.
  async function handleSendInvoice() {
    if (!selectedLead) {
      toast.error("Select a lead first");
      return;
    }
    if (isLocked) return;
    if (attachPaymentLink && !gateway) {
      toast.error("Select a payment gateway");
      return;
    }
    if (attachPaymentLink && gateway && !gateways.find((g) => g.gateway === gateway)?.connected) {
      toast.error(Messages.invoices.razorpayNotConfigured);
      return;
    }
    setSending(true);
    try {
      const savedId = await saveInvoice();
      await sendInvoice(savedId, {
        attachPaymentLink,
        gateway: attachPaymentLink ? (gateway ?? undefined) : undefined,
      });
      toast.success(Messages.invoices.sent);
      navigate("/invoices");
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.sendFailed));
    } finally {
      setSending(false);
    }
  }

  const formLoading = isEdit && !editPopulated;

  return (
    <>
      <Header
        title={isEdit ? "Edit Invoice" : "New Invoice"}
        subtitle={isEdit ? `Editing ${status}` : "Create a new invoice for a lead"}
        backTo="/invoices"
      />
      <div className="p-4 sm:p-6">
        {formLoading ? (
          <div className="bg-card border border-card-border rounded-xl p-8 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
            {/* Main column */}
            <div className="flex flex-col gap-4 min-w-0">
              <div className="bg-card border border-card-border rounded-xl p-5">
                <h3 className="font-display text-sm font-bold text-foreground mb-3.5">
                  Invoice details
                </h3>
                <LeadField selectedLead={selectedLead} onSelect={setSelectedLead} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <div>
                    <Label className="block text-[11.5px] font-semibold text-muted-foreground mb-1.5">
                      Invoice number
                    </Label>
                    <Input
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div>
                    <Label className="block text-[11.5px] font-semibold text-muted-foreground mb-1.5">
                      Invoice date
                    </Label>
                    <Input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="block text-[11.5px] font-semibold text-muted-foreground mb-1.5">
                      Due date
                    </Label>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-card-border">
                  <h3 className="font-display text-sm font-bold text-foreground">Line items</h3>
                </div>
                <LineItemsTable lineItems={lineItems} courses={courses} onChange={setLineItems} />
              </div>

              <div className="bg-card border border-card-border rounded-xl p-5">
                <h3 className="font-display text-sm font-bold text-foreground mb-2.5">
                  Notes &amp; terms
                </h3>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                />
              </div>

              {/* Edit mode only — a schedule exists only after createEmiPlan has run against
                  a saved invoice (Register Student's "Convert balance into EMI"). Reads
                  straight off the loaded invoice and refetches after each mutation. */}
              {isEdit && id && invoice && invoice.emiInstallments.length > 0 && (
                <EmiScheduleCard
                  invoiceId={id}
                  emiInstallments={invoice.emiInstallments}
                  onChanged={refetchInvoice}
                />
              )}
            </div>

            {/* Side column */}
            <div className="flex flex-col gap-4 lg:sticky lg:top-4">
              <TaxSettingsCard
                gstEnabled={gstEnabled}
                gstType={gstType}
                gstRate={gstRate}
                onGstEnabledChange={setGstEnabled}
                onGstTypeChange={setGstType}
                onGstRateChange={setGstRate}
              />
              <TotalsCard
                totals={totals}
                gstEnabled={gstEnabled}
                gstType={gstType}
                gstRate={gstRate}
                discountType={discountType}
                discountValue={discountValue}
                onDiscountTypeChange={setDiscountType}
                onDiscountValueChange={setDiscountValue}
                attachPaymentLink={attachPaymentLink}
                onAttachPaymentLinkChange={setAttachPaymentLink}
                gateway={gateway}
                onGatewayChange={setGateway}
                mandateActive={invoice?.emiPaymentMode === "SUBSCRIPTION" && !!invoice?.emiMandateStatus}
              />

              {generatedFromRegistration && (
                <p className="text-[11px] text-success text-right">
                  ✓ Generated from a completed student registration.
                </p>
              )}

              {isLocked && (
                <p className="text-[11px] text-muted-foreground text-right">
                  {status === "CANCELLED"
                    ? "This invoice has been voided and can no longer be edited."
                    : "This invoice is paid and can no longer be edited."}
                </p>
              )}

              <div className="flex gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={saving || sending || isLocked}
                  onClick={() => void handleSaveDraft()}
                >
                  {saving ? "Saving…" : "Save Draft"}
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={saving || sending || isLocked}
                  onClick={() => void handleSendInvoice()}
                >
                  {sending
                    ? "Sending…"
                    : attachPaymentLink
                      ? "Send Invoice + Payment Link"
                      : "Send Invoice"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
