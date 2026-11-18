import { useState } from "react";
import { toast } from "sonner";
import { apiErrorMessage } from "../../lib/apiError";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { performModuleAction, getModuleList, type ModuleRecord } from "../../api/modules";
import { BUYING, ACCOUNT_TYPES, INDUSTRIES, TERR } from "../../modules/registry";

interface ConvertLeadDialogProps {
  readonly lead: ModuleRecord;
  readonly onClose: () => void;
  readonly onConverted: (opportunityId: string) => void;
}

interface ConvertResult {
  duplicate?: boolean;
  existingAccountId?: string;
  existingContactId?: string;
  opportunityId?: string;
  linkedExistingAccount?: boolean;
}

// mfg-leads.service.ts's convert() can bounce back up to twice before actually converting:
// once if the "new account" fields match an existing account (by name/GSTIN), and again if
// that account already has a contact matching the lead's phone/email. Both are "this already
// exists, use it" cases, not user errors, so this resolves them automatically rather than
// making the user re-submit by hand.
async function convertWithDuplicateResolution(
  leadId: string,
  payload: Record<string, unknown>,
): Promise<ConvertResult> {
  const result = (await performModuleAction("leads", leadId, "Convert to opportunity", payload)) as ConvertResult;
  if (!result.duplicate) return result;
  if (result.existingAccountId) {
    const converted = await convertWithDuplicateResolution(leadId, { ...payload, account: undefined, accountId: result.existingAccountId });
    return { ...converted, linkedExistingAccount: true };
  }
  if (result.existingContactId) {
    return convertWithDuplicateResolution(leadId, { ...payload, contactId: result.existingContactId });
  }
  return result;
}

export function ConvertLeadDialog({ lead, onClose, onConverted }: ConvertLeadDialogProps) {
  const [contactRole, setContactRole] = useState("");
  const [accountMode, setAccountMode] = useState<"new" | "existing">("new");
  const [accountType, setAccountType] = useState("");
  const [industry, setIndustry] = useState("");
  const [territory, setTerritory] = useState("");
  const [gstin, setGstin] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountResults, setAccountResults] = useState<ModuleRecord[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<ModuleRecord | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    contactRole.trim().length > 0 &&
    (accountMode === "existing" ? Boolean(selectedAccount) : Boolean(accountType && industry && territory));

  async function handleAccountSearch(term: string) {
    setAccountSearch(term);
    setSelectedAccount(null);
    if (term.trim().length < 2) {
      setAccountResults([]);
      return;
    }
    setSearching(true);
    try {
      const result = await getModuleList("accounts", { page: 1, limit: 10, search: term });
      setAccountResults(result.data);
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> =
        accountMode === "existing"
          ? { contactRole, accountId: selectedAccount!.id }
          : { contactRole, account: { type: accountType, industry, territory, gstin: gstin || undefined } };
      const result = await convertWithDuplicateResolution(lead.id, payload);
      if (!result.opportunityId) {
        toast.error("Couldn't convert this lead — please try again.");
        return;
      }
      toast.success(
        result.linkedExistingAccount
          ? "Converted to opportunity. An account with this name or GSTIN already exists, so the lead was linked to it — no new account was created."
          : "Converted to opportunity.",
      );
      onConverted(result.opportunityId);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't convert this lead."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to opportunity</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1">
            <Label htmlFor="convert-contact-role">
              Contact's buying role <span className="text-destructive">*</span>
            </Label>
            <select
              id="convert-contact-role"
              value={contactRole}
              onChange={(e) => setContactRole(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select…</option>
              {BUYING.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Account</Label>
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setAccountMode("new")}
                className={`flex-1 rounded-md border px-3 py-1.5 ${accountMode === "new" ? "border-primary bg-primary/5 font-medium" : "border-input"}`}
              >
                New account
              </button>
              <button
                type="button"
                onClick={() => setAccountMode("existing")}
                className={`flex-1 rounded-md border px-3 py-1.5 ${accountMode === "existing" ? "border-primary bg-primary/5 font-medium" : "border-input"}`}
              >
                Existing account
              </button>
            </div>
          </div>

          {accountMode === "new" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="convert-account-type">
                  Customer type <span className="text-destructive">*</span>
                </Label>
                <select
                  id="convert-account-type"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="convert-industry">
                  Industry <span className="text-destructive">*</span>
                </Label>
                <select
                  id="convert-industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="convert-territory">
                  Territory <span className="text-destructive">*</span>
                </Label>
                <select
                  id="convert-territory"
                  value={territory}
                  onChange={(e) => setTerritory(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {TERR.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="convert-gstin">GSTIN (optional)</Label>
                <Input id="convert-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="convert-account-search">
                Search accounts <span className="text-destructive">*</span>
              </Label>
              <Input
                id="convert-account-search"
                value={accountSearch}
                onChange={(e) => void handleAccountSearch(e.target.value)}
                placeholder="Type at least 2 characters…"
              />
              {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
              {accountResults.length > 0 && (
                <ul className="border border-input rounded-md divide-y divide-border max-h-40 overflow-y-auto">
                  {accountResults.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedAccount(account)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${selectedAccount?.id === account.id ? "bg-primary/10 font-medium" : ""}`}
                      >
                        {String(account.short ?? account.name)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedAccount && (
                <p className="text-xs text-muted-foreground">Selected: {String(selectedAccount.short ?? selectedAccount.name)}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Converting…" : "Convert"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
