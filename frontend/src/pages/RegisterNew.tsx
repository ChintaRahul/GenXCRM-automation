import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Search, Loader2, Check } from "lucide-react";
import { Header } from "../components/layout/Header";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { StatusBadge } from "../components/shared/StatusBadge";
import { StepIndicator } from "../components/shared/StepIndicator";
import { LineItemsTable, type RegistrationLineItem } from "../components/invoices/LineItemsTable";
import { RegistrationFeeCard } from "../components/invoices/RegistrationFeeCard";
import { EmiPlanAccordion } from "../components/invoices/EmiPlanAccordion";
import { PaymentLinkAccordion } from "../components/invoices/PaymentLinkAccordion";
import { StudentFormCard } from "../components/register/StudentFormCard";
import { TaxSettingsCard } from "../components/invoices/TaxSettingsCard";
import { useCourses } from "../hooks/useCourses";
import { usePaymentGateways } from "../hooks/usePaymentGateways";
import {
  getLead,
  getLeads,
  generateInvoiceFromRegistration,
  recordRegistrationPayment,
  getRegistrationScreenshotUploadUrl,
  createEmiPlan,
  createEmiMandate,
  updateInvoice,
} from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { cn, initials } from "../lib/utils";
import type { EmiInstallment, GstType, Invoice, Lead, PaymentGatewayName, RegistrationPaymentMode } from "../types";

const STEP_LABELS = ["Lead", "Courses", "Payment", "Done"];

// Inline lead search + pick list, mirroring the existing pattern in
// pages/Nurturing.tsx's EnrollLeadPanel (search input + getLeads({ search }) + a
// selectable list) — this screen embeds it directly rather than as a dialog since
// Register is a full page, not a modal flow.
function LeadPickerCard({
  selectedLead,
  onSelect,
}: {
  selectedLead: Lead | null;
  onSelect: (lead: Lead) => void;
}) {
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    // Debounced + guarded against out-of-order responses: without this, fast typing can
    // fire several requests and a slower earlier one can resolve after a later one,
    // clobbering the results with stale data.
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
  }, [search]);

  return (
    <div>
      <div className="relative mb-3.5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads by name, email or phone…"
          className="pl-8"
        />
      </div>
      <div className="max-h-80 overflow-y-auto border border-border rounded-lg">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No leads found</p>
        ) : (
          leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => onSelect(lead)}
              className={cn(
                "w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors border-b border-border last:border-b-0",
                selectedLead?.id === lead.id ? "bg-primary/10" : "hover:bg-muted/50",
              )}
            >
              <Avatar className="w-8 h-8 flex-shrink-0">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                  {initials(lead.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {lead.email ?? lead.phone}
                </p>
              </div>
              <StatusBadge status={lead.stage} />
              {selectedLead?.id === lead.id && (
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default function NewRegistrationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { courses } = useCourses();

  const preselectLeadId = searchParams.get("leadId");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(preselectLeadId ? 2 : 1);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Arriving from a lead's detail page (e.g. "Register Student") passes ?leadId= so the
  // rep doesn't have to re-search for the lead they were just looking at.
  useEffect(() => {
    if (!preselectLeadId) return;
    void getLead(preselectLeadId)
      .then(setSelectedLead)
      .catch((err) => {
        toast.error(apiErrorMessage(err, "Couldn't load that lead — pick one below"));
        setStep(1);
      });
    // Only ever runs for the leadId present on initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lineItems, setLineItems] = useState<RegistrationLineItem[]>([
    { courseName: "", quantity: 1, unitPrice: 0 },
  ]);

  const [fee, setFee] = useState(0);
  const [note, setNote] = useState("");
  const [screenshotFileName, setScreenshotFileName] = useState<string | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  // Off by default — the Register flow never showed tax settings before, so silently
  // taxing the invoice would charge more than what was agreed. A rep who needs GST on
  // this registration turns it on explicitly via TaxSettingsCard in step 2.
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstType, setGstType] = useState<GstType>("CGST_SGST");
  const [gstRate, setGstRate] = useState(18);

  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  // Full Invoice object, kept alongside invoiceId — EmiPlanAccordion needs
  // emiPaymentMode/emiMandateStatus/emiMandateShortUrl, which only come back on the
  // Invoice returned by generateInvoiceFromRegistration/updateInvoice, not on invoiceId alone.
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [registered, setRegistered] = useState(false);
  const [saving, setSaving] = useState(false);
  // Snapshot of the line items/GST settings last persisted to invoiceId — lets
  // ensureInvoice() tell whether the user edited courses/prices/tax settings after the
  // draft invoice was created (e.g. went back from step 3 to step 2) and needs to push an
  // update before continuing.
  const persistedLineItemsRef = useRef<RegistrationLineItem[] | null>(null);
  const persistedGstRef = useRef<{ gstEnabled: boolean; gstType: GstType; gstRate: number } | null>(null);

  // Changing the selected lead after a draft invoice already exists for the previous lead
  // must not let the flow continue against that stale invoice — otherwise the registration
  // payment/screenshot ends up recorded against the wrong lead entirely.
  function handleSelectLead(lead: Lead) {
    if (invoiceId && selectedLead && lead.id !== selectedLead.id) {
      setInvoiceId(null);
      setInvoice(null);
      setRegistered(false);
      setScreenshotFileName(null);
      persistedLineItemsRef.current = null;
      persistedGstRef.current = null;
    }
    setSelectedLead(lead);
  }

  const [emiOpen, setEmiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // Tracks whether a payment link was sent this session — Generate Invoice is gated on
  // either this or an EMI plan being saved, so a registration never silently skips both.
  const [linkSent, setLinkSent] = useState(false);
  // "Send payment link" is only worth showing once an org has a gateway connected —
  // otherwise it's a dead-end UI (see PaymentLinkAccordion, which already disables
  // unconnected gateways individually; this hides the whole block instead).
  const { gateways } = usePaymentGateways();
  const hasConnectedGateway = gateways.some((g) => g.connected);
  // Gateway for the auto-debit mandate: the rep's pick, else the first connected one.
  const [emiGatewayChoice, setEmiGatewayChoice] = useState<PaymentGatewayName | null>(null);
  const emiGateway: PaymentGatewayName =
    emiGatewayChoice ?? gateways.find((g) => g.connected)?.gateway ?? "RAZORPAY";
  const [tenureMonths, setTenureMonths] = useState(3);
  const [emiStartDate, setEmiStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [negotiatedAmount, setNegotiatedAmount] = useState<number | undefined>(undefined);
  const [creatingEmiPlan, setCreatingEmiPlan] = useState(false);
  const [creatingEmiMandate, setCreatingEmiMandate] = useState(false);
  // Persisted rows returned by createEmiPlan — the accordion shows these instead of its
  // client-side estimate once a plan exists (the backend bases EMIs on the GST-inclusive
  // grand total, so the estimate is only ever an approximation).
  const [savedInstallments, setSavedInstallments] = useState<EmiInstallment[]>([]);

  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);

  const stepValid =
    step === 1 ? !!selectedLead
    : step === 2 ? lineItems.length > 0 && lineItems.every((li) => li.courseName && li.quantity > 0 && li.unitPrice > 0)
    : true;

  // If the registration fee already covers the full course cost, there's no balance left
  // to collect and neither an EMI plan nor a payment link is needed. Otherwise the
  // remaining balance has to go somewhere before the rep can move on.
  const hasRemainingBalance = subtotal - fee > 0;
  const canGenerateInvoice =
    registered && !!invoiceId && (!hasRemainingBalance || savedInstallments.length > 0 || linkSent);

  // Creates the bare DRAFT invoice on first use (Save Registration or a screenshot
  // upload, whichever happens first) and reuses it afterward — the backend's
  // "register now, invoice later" design means only one invoice should ever be
  // created per registration (see invoices.service.ts's generateFromRegistration).
  // If the invoice already exists, syncs any line-item edits made after it was created
  // (e.g. going back from step 3 to step 2 and changing a course/price) before returning.
  async function ensureInvoice(): Promise<string> {
    if (!selectedLead) throw new Error("Select a lead first");
    const gstSnapshot = { gstEnabled, gstType, gstRate };
    if (invoiceId) {
      const isStale =
        JSON.stringify(persistedLineItemsRef.current) !== JSON.stringify(lineItems) ||
        JSON.stringify(persistedGstRef.current) !== JSON.stringify(gstSnapshot);
      if (isStale) {
        const updated = await updateInvoice(invoiceId, { lineItems, ...gstSnapshot });
        setInvoice(updated);
        persistedLineItemsRef.current = lineItems;
        persistedGstRef.current = gstSnapshot;
      }
      return invoiceId;
    }
    const created = await generateInvoiceFromRegistration({
      leadId: selectedLead.id,
      lineItems,
      ...gstSnapshot,
    });
    setInvoiceId(created.id);
    setInvoice(created);
    persistedLineItemsRef.current = lineItems;
    persistedGstRef.current = gstSnapshot;
    return created.id;
  }

  async function handleScreenshotFileSelected(file: File) {
    if (!selectedLead) {
      toast.error("Select a lead before uploading a screenshot");
      return;
    }
    setUploadingScreenshot(true);
    try {
      const id = await ensureInvoice();
      // The presign call also persists the storage key on the invoice server-side, so
      // there's nothing to track here beyond the file name shown in the UI.
      const { uploadUrl } = await getRegistrationScreenshotUploadUrl({
        invoiceId: id,
        contentType: file.type,
      });
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!response.ok) {
        throw new Error(`Screenshot upload failed with status ${response.status}`);
      }
      setScreenshotFileName(file.name);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.screenshotUploadFailed));
    } finally {
      setUploadingScreenshot(false);
    }
  }

  async function handleSaveRegistration() {
    if (!selectedLead) {
      toast.error("Select a lead first");
      return;
    }
    setSaving(true);
    try {
      const id = await ensureInvoice();
      const mode: RegistrationPaymentMode = screenshotFileName ? "SCREENSHOT" : "SAVE";
      await recordRegistrationPayment(id, { amount: fee, mode, note });
      setRegistered(true);
      setStep(4);
      toast.success(Messages.invoices.registrationPaymentRecorded);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.registrationPaymentFailed));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateEmiPlan() {
    if (!invoiceId) return;
    setCreatingEmiPlan(true);
    try {
      const installments = await createEmiPlan(invoiceId, {
        tenureMonths,
        startDate: emiStartDate,
        negotiatedAmount,
      });
      setSavedInstallments(installments);
      toast.success(Messages.invoices.emiPlanCreated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.emiPlanFailed));
    } finally {
      setCreatingEmiPlan(false);
    }
  }

  async function handleCreateEmiMandate() {
    if (!invoiceId) return;
    setCreatingEmiMandate(true);
    try {
      const installments = await createEmiMandate(invoiceId, {
        tenureMonths,
        startDate: emiStartDate,
        negotiatedAmount,
        gateway: emiGateway,
      });
      setSavedInstallments(installments);
      setInvoice((prev) => (prev ? { ...prev, emiPaymentMode: "SUBSCRIPTION", emiMandateStatus: "CREATED" } : prev));
      toast.success(Messages.invoices.emiMandateCreated);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.invoices.emiMandateFailed));
    } finally {
      setCreatingEmiMandate(false);
    }
  }

  function handlePrimaryAction() {
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3) void handleSaveRegistration();
  }

  const primaryLabel =
    step === 3 ? (saving ? "Saving…" : "Save registration") : "Continue →";

  return (
    <>
      <Header
        title="New registration"
        subtitle="Enroll a lead, record their registration fee, and generate the invoice"
        backTo="/register"
      />
      <div className="p-4 sm:p-6 flex justify-center">
        <div className="w-full max-w-2xl">
          <StepIndicator steps={STEP_LABELS} currentStep={step} />

          <div className="bg-card border border-card-border rounded-xl p-5 sm:p-6">
            {step === 1 && (
              <div>
                <h2 className="font-display text-lg font-bold text-foreground mb-1">
                  Who's enrolling?
                </h2>
                <p className="text-[13.5px] text-muted-foreground mb-4">
                  Search for the lead you're registering into a course.
                </p>
                <LeadPickerCard selectedLead={selectedLead} onSelect={handleSelectLead} />
                {selectedLead && (
                  <div className="mt-4">
                    <StudentFormCard key={selectedLead.id} leadId={selectedLead.id} />
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="font-display text-lg font-bold text-foreground mb-1">
                  Courses enrolled
                </h2>
                <p className="text-[13.5px] text-muted-foreground mb-4">
                  Enrolling <b className="text-foreground">{selectedLead?.name}</b>. Add every
                  course they're signing up for.
                </p>
                <div className="border border-card-border rounded-xl overflow-hidden">
                  <LineItemsTable lineItems={lineItems} courses={courses} onChange={setLineItems} />
                  <div className="px-5 py-3 border-t border-border flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold text-muted-foreground">
                      Total course fee
                    </span>
                    <span className="font-mono tabular-nums font-bold text-foreground">
                      ₹{subtotal.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>
                <div className="mt-4">
                  <TaxSettingsCard
                    gstEnabled={gstEnabled}
                    gstType={gstType}
                    gstRate={gstRate}
                    onGstEnabledChange={setGstEnabled}
                    onGstTypeChange={setGstType}
                    onGstRateChange={setGstRate}
                  />
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="font-display text-lg font-bold text-foreground mb-1">
                  Registration payment
                </h2>
                <p className="text-[13.5px] text-muted-foreground mb-4">
                  Record what {selectedLead?.name} paid to secure their seat. Balance and EMI
                  come after.
                </p>
                <RegistrationFeeCard
                  fee={fee}
                  onFeeChange={setFee}
                  screenshotFileName={screenshotFileName}
                  onScreenshotFileSelected={handleScreenshotFileSelected}
                  uploadingScreenshot={uploadingScreenshot}
                  note={note}
                  onNoteChange={setNote}
                  subtotal={subtotal}
                  ensurePaymentLinkInvoiceId={hasConnectedGateway ? ensureInvoice : undefined}
                />
              </div>
            )}

            {step === 4 && (
              <div>
                <div className="flex flex-col items-center text-center gap-2.5 pb-6">
                  <div className="w-[52px] h-[52px] rounded-full bg-success text-success-foreground flex items-center justify-center">
                    <Check className="w-6 h-6" />
                  </div>
                  <h2 className="font-display text-lg font-bold text-foreground mt-1.5">
                    Registration recorded
                  </h2>
                  <p className="text-[13.5px] text-muted-foreground max-w-sm">
                    {selectedLead?.name} is enrolled in{" "}
                    {lineItems.length === 1 ? "1 course" : `${lineItems.length} courses`} for ₹
                    {subtotal.toLocaleString("en-IN")}. A registration fee of ₹
                    {fee.toLocaleString("en-IN")} has been logged.
                  </p>
                </div>

                <div className="flex flex-col gap-2.5">
                  {selectedLead && <StudentFormCard key={selectedLead.id} leadId={selectedLead.id} />}
                  {invoiceId && (
                    <EmiPlanAccordion
                      open={emiOpen}
                      onToggle={() => setEmiOpen((v) => !v)}
                      subtotal={subtotal}
                      registrationFee={fee}
                      tenureMonths={tenureMonths}
                      onTenureMonthsChange={setTenureMonths}
                      emiStartDate={emiStartDate}
                      onEmiStartDateChange={setEmiStartDate}
                      negotiatedAmount={negotiatedAmount}
                      onNegotiatedAmountChange={setNegotiatedAmount}
                      gstEnabled={gstEnabled}
                      gstRate={gstRate}
                      onCreateEmiPlan={handleCreateEmiPlan}
                      creatingEmiPlan={creatingEmiPlan}
                      savedInstallments={savedInstallments}
                      emiPaymentMode={invoice?.emiPaymentMode ?? "MANUAL"}
                      emiMandateStatus={invoice?.emiMandateStatus}
                      emiMandateShortUrl={invoice?.emiMandateShortUrl}
                      onCreateEmiMandate={handleCreateEmiMandate}
                      creatingEmiMandate={creatingEmiMandate}
                      gateways={gateways}
                      emiGateway={emiGateway}
                      onEmiGatewayChange={setEmiGatewayChoice}
                      invoiceId={invoiceId ?? undefined}
                      onMandateStatusChange={(status, installments) => {
                        setSavedInstallments(installments);
                        setInvoice((prev) => (prev ? { ...prev, emiMandateStatus: status } : prev));
                      }}
                    />
                  )}
                  {invoiceId && hasConnectedGateway && (
                    <PaymentLinkAccordion
                      ensureInvoiceId={async () => invoiceId}
                      knownInvoiceId={invoiceId}
                      open={linkOpen}
                      onToggle={() => setLinkOpen((v) => !v)}
                      onLinkSent={() => setLinkSent(true)}
                    />
                  )}
                </div>

                {registered && invoiceId && !canGenerateInvoice && (
                  <p className="text-[11.5px] text-muted-foreground mt-4 text-center">
                    Save an EMI plan or send a payment link above before generating the invoice.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full", registered && invoiceId ? "mt-1.5" : "mt-4")}
                  disabled={!canGenerateInvoice}
                  onClick={() => invoiceId && navigate(`/invoices/${invoiceId}/edit`)}
                >
                  Generate Invoice →
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full mt-1.5"
                  onClick={() => navigate("/register")}
                >
                  Back to registrations
                </Button>
              </div>
            )}

            {step !== 4 && (
              <div className="flex gap-3 mt-7 pt-5 border-t border-border">
                {step > 1 && (
                  <Button type="button" variant="outline" className="flex-none w-24" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                    ← Back
                  </Button>
                )}
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!stepValid || saving}
                  onClick={handlePrimaryAction}
                >
                  {primaryLabel}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
