import { PRODUCTS } from '../../modules/mfg-leads/dto/create-mfg-lead.dto';
import type { MfgLeadWebhookPayload } from '../../modules/mfg-leads/mfg-leads.service';

// B2B marketplaces that push enquiries to the org's hub URL. The URL slug picks the entry;
// `source` must be one of the Manufacturing lead SOURCES.
export const HUBS = {
  indiamart: { source: 'IndiaMART', label: 'IndiaMART' },
  tradeindia: { source: 'TradeIndia', label: 'TradeIndia' },
  exportersindia: { source: 'ExportersIndia', label: 'ExportersIndia' },
  justdial: { source: 'JustDial', label: 'JustDial' },
} as const;

export type HubSlug = keyof typeof HUBS;
export const isHubSlug = (value: string): value is HubSlug => Object.keys(HUBS).includes(value);

// Each hub names the same facts differently (IndiaMART: SENDER_MOBILE, TradeIndia: sender_mobile,
// others: mobile / phone). Keys are compared lowercased with punctuation stripped, first hit wins.
const ALIASES = {
  external_id: ['uniquequeryid', 'queryid', 'rfiid', 'enquiryid', 'leadid', 'id'],
  name: ['sendername', 'name', 'contactperson', 'buyername', 'fullname'],
  company: ['sendercompany', 'company', 'companyname', 'organization', 'organisation'],
  phone: ['sendermobile', 'mobile', 'mobileno', 'phone', 'phoneno', 'contactnumber', 'sendermobilealt'],
  email: ['senderemail', 'email', 'emailid', 'buyeremail'],
  product: ['queryproductname', 'productname', 'product', 'subject', 'item'],
  requirement: ['querymessage', 'message', 'requirement', 'description', 'details', 'enquirymessage'],
  city: ['sendercity', 'city'],
  state: ['senderstate', 'state'],
} as const;

type Raw = Record<string, unknown>;
const normKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const asText = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

// IndiaMART wraps the enquiry as { CODE, STATUS, RESPONSE: {...} } (RESPONSE may be an array);
// other hubs send it flat. Return the inner enquiry objects either way.
export const unwrapEnquiries = (body: unknown): Raw[] => {
  if (Array.isArray(body)) return body.flatMap(unwrapEnquiries);
  if (!body || typeof body !== 'object') return [];
  const entry = Object.entries(body).find(([key]) => normKey(key) === 'response');
  return entry ? unwrapEnquiries(entry[1]) : [body as Raw];
};

const pick = (flat: Map<string, string>, names: readonly string[]) => names.map((n) => flat.get(n)).find(Boolean);

// Use a catalogue product when the enquiry mentions one ("60T Weighbridge" → Weighbridge).
const catalogueProduct = (text: string) => PRODUCTS.find((p) => text.toLowerCase().includes(p.toLowerCase()));

export const mapEnquiry = (hub: HubSlug, raw: Raw): MfgLeadWebhookPayload & { rawProduct?: string } => {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    const text = asText(value);
    if (text && !flat.has(normKey(key))) flat.set(normKey(key), text);
  }
  const field = (name: keyof typeof ALIASES) => pick(flat, ALIASES[name]);
  const rawProduct = field('product');
  const requirement = field('requirement');
  const externalId = field('external_id');
  const name = field('name');
  return {
    external_id: externalId ? `${hub}:${externalId}` : undefined,
    name,
    company: field('company'),
    phone: field('phone'),
    email: field('email'),
    product: catalogueProduct(`${rawProduct ?? ''} ${requirement ?? ''}`) ?? rawProduct?.slice(0, 120),
    requirement: [rawProduct && `Product: ${rawProduct}`, requirement].filter(Boolean).join('\n') || undefined,
    city: field('city'),
    state: field('state'),
    source: HUBS[hub].source,
    rawProduct,
  };
};
