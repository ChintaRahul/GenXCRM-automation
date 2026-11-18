// Leads store Indian mobile numbers as bare 10 digits with no country code (see
// LeadsService.normalizePhone) — dedup and inbound-message matching rely on that bare
// form. External send APIs (WhatsApp Cloud API, Twilio) require the full MSISDN with
// country code, so it must be added at send time rather than at storage time.
const INDIA_COUNTRY_CODE = '91';

function withIndiaCountryCode(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `${INDIA_COUNTRY_CODE}${digits}` : digits;
}

// WhatsApp Cloud API's `to` field: digits only, no leading "+".
export function toWhatsAppRecipient(phone: string): string {
  return withIndiaCountryCode(phone);
}

// Twilio's `To` field: E.164, with a leading "+".
export function toE164(phone: string): string {
  return `+${withIndiaCountryCode(phone)}`;
}
