# WhatsApp Template Messages — Scope

## Why

`CommunicationsService.sendWhatsApp()` sends `type: "text"` (free-form). Meta only delivers free-form
WhatsApp **within 24 hours of the lead's last inbound message**; outside that window it returns error
`131047`. Nurturing is *proactive* outreach to cold leads, so free-form WhatsApp nurturing almost
never delivers. **Approved message templates** (`type: "template"`) are the only way to message a lead
who hasn't written in — they're what unblocks WhatsApp nurturing.

Templates are authored and approved in **WhatsApp Manager** (`business.facebook.com`). GenXCRM only
*consumes* approved templates — it does not create or submit them.

## Two send modes (both kept)

| Mode | Payload | When | Used by |
|---|---|---|---|
| **Free-form** (existing) | `type: "text"` | Within 24h of lead's last inbound msg | Comms panel, reply window |
| **Template** (new) | `type: "template"` | Any time | Nurturing (proactive) |

Template variables are **positional** (`{{1}}`, `{{2}}`), not named. Example Meta payload:

```jsonc
{ "messaging_product": "whatsapp", "to": "...", "type": "template",
  "template": {
    "name": "welcome_offer", "language": { "code": "en_US" },
    "components": [{ "type": "body",
      "parameters": [{ "type": "text", "text": "Asha" }, { "type": "text", "text": "MBA" }] }] } }
```

## Data model (Phase 1)

Three nullable columns on `NurturingStep` — only meaningful when `type = 'whatsapp'`. `templateName =
null` ⇒ free-form (preserves current behavior):

| Column | Type | Holds |
|---|---|---|
| `templateName` | `String?` | approved template name |
| `templateLang` | `String?` | language code (e.g. `en_US`) |
| `templateParams` | `Json?` | ordered `string[]` for `{{1}}…{{n}}`; each entry may contain `{{name}}`/`{{course}}`/… and is interpolated per lead |

`Communication` is **unchanged** — `externalId` stores Meta's returned message id; `metadata.template`
stores the template name. One migration; cascade rules unaffected.

## Backend

- **`CommunicationsService.sendWhatsAppTemplate(leadId, templateName, lang, params[], caller)`** —
  interpolates each `params[i]` against the lead (reuses nurturing's `interpolate()` semantics), POSTs
  `type:"template"` to the v25.0 Graph endpoint already used by `sendWhatsApp`, records a
  `Communication` (`type: WHATSAPP`) with `externalId` + `status` from the response and
  `metadata.template`. Existing `sendWhatsApp()` left untouched.
- **Dispatcher** (`nurturing.service.ts` `executeStep`) — for a `whatsapp` step:
  `step.templateName ? sendWhatsAppTemplate(…interpolated params) : sendWhatsApp(free-form)`.

## Phase 2 (authoring UX — not in this commit)

- **`GET /communications/whatsapp/templates`** → Meta `GET /{WABA_ID}/message_templates?status=APPROVED`,
  returns `{ name, language, bodyText, variableCount }[]`. Needs env **`WHATSAPP_BUSINESS_ACCOUNT_ID`**
  and `whatsapp_business_management` on the token; degrades to `[]` when unset.
- **`Nurturing.tsx` editor** — WhatsApp step gains a Free-form vs Template toggle; Template mode shows a
  dropdown of approved templates and renders one variable input per `{{n}}` (each accepting `{{name}}`
  etc.) with a live preview. Persists into the three new step fields.

## Out of scope (future)

- Delivery-status webhook (sent/delivered/read/failed callbacks).
- Template authoring/submission from inside GenXCRM (done in WhatsApp Manager).
- Per-org WABA / multi-tenant WhatsApp (one WABA via env, matching SES/Twilio wiring).
- Header/button/media template components — body-text variables only for v1.

## Decision log

- **Template source: fetch from Meta** (chosen over manual entry) — the editor dropdown is the single
  source of truth for variable count, avoiding silent send-time failures from typos. Adds
  `WHATSAPP_BUSINESS_ACCOUNT_ID` + the management permission.
