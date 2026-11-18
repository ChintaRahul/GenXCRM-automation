// Meta auto-provisions "hello_world" as a pre-approved sample template on every WhatsApp Business
// Account, but Meta only allows it to be sent from its own Public Test Number — never from a real
// connected business number (Graph API error #131058). Shared by the templates module (to keep it
// out of the template list/import) and the communications module (to reject it before it ever
// reaches Meta and comes back as an opaque 502).
export const PUBLIC_TEST_ONLY_TEMPLATE_NAMES = new Set(['hello_world']);
