import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v25.0';

// Sample values Meta requires for each {{n}} placeholder when submitting a template. Keyed by our
// named variables so the example reads naturally during Meta's review.
const EXAMPLE_VALUES: Record<string, string> = {
  name: 'Asha',
  course: 'MBA',
  org: 'GenX Academy',
  email: 'asha@example.com',
  phone: '+91 90000 00000',
  rep: 'Rohan',
  plan: 'MBA',
  amount: '25000',
  payment_link: 'https://rzp.io/i/example',
  installment_no: '2',
  due_date: '15 Oct 2026',
  invoice_no: 'INV-2026-0001',
};

export interface PositionalBody {
  /** Body rewritten to Meta's positional form, e.g. "Hi {{1}}, ...". */
  text: string;
  /** Ordered named variables, e.g. ["name","course"] — index i maps to {{i+1}}. */
  variables: string[];
  /** One example value per variable, same order. */
  example: string[];
}

export interface SubmitTemplateInput {
  metaName: string;
  language: string;
  category: string;
  body: string; // named-variable body, e.g. "Hi {{name}}, welcome to {{org}}"
}

/** Per-org WABA credentials. When omitted, callers fall back to the global env vars. */
export interface WaCredentials {
  accessToken: string;
  businessAccountId: string;
}

export interface RemoteStatus {
  status: string; // raw Meta status (APPROVED | PENDING | REJECTED | …)
  category?: string;
  rejectionReason?: string;
  metaTemplateId: string;
  language: string;
  /** Positional body text as stored on Meta (e.g. "Hi {{1}}, ..."), '' if no BODY component. */
  body: string;
  /** Count of distinct {{n}} placeholders in `body`. */
  variableCount: number;
}

interface TemplateComponent {
  type: 'BODY';
  text: string;
  example?: { body_text: string[][] };
}

/** Human-readable text from a Meta Graph API error (its body), for storing as a rejection reason. */
export const metaErrorText = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string; error_user_msg?: string } } | undefined;
    return data?.error?.error_user_msg ?? data?.error?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
};

/**
 * Thin wrapper over Meta's WhatsApp message-template management endpoints (create / edit / list).
 * Every method takes optional per-org `WaCredentials` — pass the caller's org's own connected WABA
 * to manage that org's templates, or omit to fall back to the global WHATSAPP_BUSINESS_ACCOUNT_ID +
 * WHATSAPP_API_TOKEN env vars (dev/single-tenant deployments). No Prisma — pure Meta I/O so it can
 * be unit-tested in isolation; credential resolution (decrypting an org's stored token) is the
 * caller's job.
 */
@Injectable()
export class WhatsappTemplatesApi {
  private readonly logger = new Logger(WhatsappTemplatesApi.name);

  isConfigured(creds?: WaCredentials): boolean {
    if (creds) return Boolean(creds.businessAccountId && creds.accessToken);
    return Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID && process.env.WHATSAPP_API_TOKEN);
  }

  // Converts a named-variable body ({{name}}) to Meta's positional form ({{1}}) plus the ordered
  // variable list and matching example values. Pure — covered by unit tests.
  toPositional(body: string): PositionalBody {
    const variables: string[] = [];
    const text = body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      let idx = variables.indexOf(key);
      if (idx === -1) {
        variables.push(key);
        idx = variables.length - 1;
      }
      return `{{${idx + 1}}}`;
    });
    const example = variables.map((v) => EXAMPLE_VALUES[v] ?? 'Sample');
    return { text, variables, example };
  }

  private authHeader(creds?: WaCredentials) {
    return { Authorization: `Bearer ${creds?.accessToken ?? process.env.WHATSAPP_API_TOKEN}` };
  }

  private wabaId(creds?: WaCredentials) {
    return creds?.businessAccountId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  }

  private bodyComponent(body: string): { components: TemplateComponent[]; variables: string[] } {
    const { text, variables, example } = this.toPositional(body);
    const component: TemplateComponent = {
      type: 'BODY',
      text,
      ...(variables.length ? { example: { body_text: [example] } } : {}),
    };
    return { components: [component], variables };
  }

  // Submits a new template for approval. Returns Meta's id/status and the ordered variable list to
  // persist (so send-time can map lead fields to {{1}}..{{n}}). Throws on Meta error.
  async submit(
    input: SubmitTemplateInput,
    creds?: WaCredentials,
  ): Promise<{ id: string; status: string; variables: string[] }> {
    const { components, variables } = this.bodyComponent(input.body);
    const { data } = await axios.post<{ id: string; status?: string }>(
      `${GRAPH}/${this.wabaId(creds)}/message_templates`,
      { name: input.metaName, language: input.language, category: input.category, components },
      { headers: this.authHeader(creds) },
    );
    return { id: data.id, status: data.status ?? 'PENDING', variables };
  }

  // Edits an existing template's content (Meta resets it to PENDING). Returns the new variable list.
  async edit(
    metaTemplateId: string,
    input: { category: string; body: string },
    creds?: WaCredentials,
  ): Promise<{ variables: string[] }> {
    const { components, variables } = this.bodyComponent(input.body);
    await axios.post(
      `${GRAPH}/${metaTemplateId}`,
      { category: input.category, components },
      { headers: this.authHeader(creds) },
    );
    return { variables };
  }

  // Fetches every template on the WABA — its approval status plus enough content (body text,
  // variable count) to import templates authored directly in WhatsApp Manager, not just update
  // ones GenXCRM already knows about. Keyed by template name. Returns an empty map when not
  // configured (caller no-ops). Throws on a Meta API error — callers decide how to degrade
  // (see TemplatesService.refreshStatuses using metaErrorText()).
  async fetchStatuses(creds?: WaCredentials): Promise<Map<string, RemoteStatus>> {
    const map = new Map<string, RemoteStatus>();
    if (!this.isConfigured(creds)) return map;
    const { data } = await axios.get<{
      data?: {
        id: string;
        name: string;
        status: string;
        category?: string;
        language?: string;
        rejected_reason?: string;
        components?: TemplateComponent[];
      }[];
    }>(`${GRAPH}/${this.wabaId(creds)}/message_templates`, {
      params: { fields: 'name,status,category,id,language,rejected_reason,components', limit: 200 },
      headers: this.authHeader(creds),
    });
    for (const t of data.data ?? []) {
      const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
      const variableCount = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
      map.set(t.name, {
        status: t.status,
        category: t.category,
        rejectionReason: t.rejected_reason,
        metaTemplateId: t.id,
        language: t.language ?? 'en_US',
        body,
        variableCount,
      });
    }
    return map;
  }
}
