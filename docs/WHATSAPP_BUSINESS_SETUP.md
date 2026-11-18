# WhatsApp Business API Setup for GenXCRM

GenXCRM sends and receives WhatsApp messages through the **WhatsApp Cloud API** (hosted by Meta on
the Graph API). Each org connects its **own** phone number and WhatsApp Business Account (WABA) —
under its own Meta Business portfolio — from inside GenXCRM's UI. There is no shared/global WhatsApp
config to edit in `.env` for a live org; a Director pastes four values into **Integrations →
WhatsApp** and GenXCRM stores them encrypted, scoped to that org.

> What the code does: `CommunicationsService.sendWhatsApp()`
> (`backend/src/modules/communications/communications.service.ts`) prefers the caller's org's own
> connected WABA (`resolveWhatsAppCredentials`), falling back to the global `WHATSAPP_API_TOKEN` /
> `WHATSAPP_PHONE_NUMBER_ID` env vars only for an org that hasn't connected one (e.g. local dev
> without going through the UI — see `backend/.env.example`). It POSTs to
> `https://graph.facebook.com/v25.0/{phoneNumberId}/messages` with a `Bearer {accessToken}` header,
> sending a `type: "text"` message to the lead's `phone`. If nothing is configured — or the lead has
> no phone — it skips the API call and just records the communication row (graceful degradation,
> same pattern as SES/Twilio).

> **You do *not* need a separate Meta app for Lead Ads and WhatsApp.** WhatsApp attaches to the
> **same Meta app** as your Facebook Lead Ads integration (App 1 in `docs/FACEBOOK_BUSINESS_SETUP.md`)
> — you add the **WhatsApp** use case to that app. Meta's dashboard changes often — follow the
> on-screen flow if a label differs slightly.
>
> **You DO need your own Meta app to connect your own WABA — one per org, not shared with GenXCRM.**
> This is customer-owned: each org creates (or reuses) its own Meta Developer app under its own
> Business portfolio, generates its own access token and App Secret there, and pastes those into
> GenXCRM. Nobody uses GenXCRM's own platform Meta app credentials for this.

---

## Two things to understand before you start

**1. The number is the WhatsApp number, not your Page.** A Facebook Page does not send WhatsApp
messages on its own. You register a **phone number** inside a **WhatsApp Business Account (WABA)**.
That number must **not** already be active on the WhatsApp or WhatsApp Business *phone app* — Meta
migrates it to the Cloud API. For testing, Meta gives you a **free test number** so you don't have to
sacrifice a real one.

**2. Free-form text only works inside the 24-hour customer service window.** This is the single most
common surprise. WhatsApp splits messages into two kinds:

| Message kind | When allowed | What GenXCRM sends today |
|---|---|---|
| **Free-form** (plain `text`) | Only within **24 hours** of the customer's *last* inbound message to you | ✅ This is what `sendWhatsApp()` sends |
| **Template** (pre-approved) | Any time — the only way to *start* a conversation or message after 24h | ✅ Create on the **Templates** page (see [Message templates](#message-templates-proactive--nurturing)) |

So a plain free-form WhatsApp send **succeeds only when the lead has messaged your number in the last
24 hours.** Outside that window Meta rejects the plain-text call with error `131047` ("re-engagement
message"). To message leads cold (e.g. a welcome blast, nurturing), use an **approved message
template** instead.

---

## Prerequisites

- A Meta app already created under a **Business portfolio** (reuse **App 1** from
  `docs/FACEBOOK_BUSINESS_SETUP.md`, or create a Business-type app the same way — see the callout
  above).
- Admin access to that Business portfolio at `business.facebook.com`.
- A **Director**-role user in GenXCRM for your org (connecting/disconnecting WhatsApp is
  Director-only — it holds your org's own Meta credentials).
- For production: a phone number you can receive an SMS/voice OTP on, **not** currently registered in
  the WhatsApp consumer or Business app.

---

## Part 1 — Add the WhatsApp use case to the app

> Your app uses Meta's newer **use-case** dashboard (left sidebar shows **Use cases**, not a classic
> **Products** list with an "Add product" button). So WhatsApp is added as a **use case**, not a
> product. Same result — WhatsApp ends up in the left sidebar with an **API Setup** screen.

1. `developers.facebook.com/apps` → open your **Business** app (App 1 — Lead Ads, or a WhatsApp-only
   app — see the callout at the top).
2. Left sidebar → **Use cases** → **+ Add use case(s)**.
3. Pick the WhatsApp use case — labelled **"Connect with customers through WhatsApp"** (some accounts
   show it as **"Connect with customers on WhatsApp"** or under an **Other** category) → **Add** /
   **Confirm**.
4. When prompted, select (or create) the **Business portfolio** to attach the WABA to → **Continue**.
5. Meta provisions a **test WABA** and a **test phone number** automatically. **WhatsApp** now appears
   in the left sidebar — open **WhatsApp → API Setup** (a.k.a. "Getting Started").

> If "Connect with customers through WhatsApp" isn't offered as an *additional* use case on this
> existing app (Meta sometimes restricts mixing it with the Lead Ads use cases), create a separate
> Business-type app whose sole use case is WhatsApp — the values it produces work identically. The
> Lead Ads app and a WhatsApp-only app can coexist under the same portfolio.

---

## Part 2 — Grab the four values GenXCRM needs

GenXCRM's **Integrations → WhatsApp** connect form asks for four values, all sourced from this same
Meta app:

On **WhatsApp → API Setup**:

1. **Phone number ID** — under "From", below the test number, copy the **Phone number ID** (a long
   numeric string, *not* the phone number itself).
2. **WhatsApp Business Account ID** — shown on the same screen (or **WhatsApp Manager → Account
   tools**, or **Business Settings → Accounts → WhatsApp accounts**). Needed so GenXCRM can manage
   and send *your* approved message templates instead of a shared/global WABA's.
3. **Temporary access token** — the box at the top shows a token valid for **24 hours**. Good enough
   to smoke-test the connect flow today; replace with a permanent token (Part 4 below) before relying
   on it, since it stops working after 24h and outbound sends silently fail once it expires.

On your app's **App Settings → Basic**:

4. **App Secret** — click **Show** (Meta may ask you to re-enter your password). This is used to
   verify the authenticity of inbound webhook events GenXCRM receives for your WABA.

> **Phone number ID vs. WABA ID vs. the phone number** — three different values on the API Setup
> screen. GenXCRM's outbound send interpolates the **Phone number ID** into the URL path; template
> management calls use the **WABA ID**. The displayed `+1 555…` number itself isn't used anywhere.

---

## Part 3 — Connect it in GenXCRM

No `.env` editing needed for a real org — this all happens in the UI:

1. Log in to GenXCRM as a **Director**.
2. Go to **Integrations → WhatsApp**.
3. Paste in the **Phone Number ID**, **Access Token**, **App Secret**, and **WhatsApp Business
   Account ID** from Part 2 → **Connect**.
4. GenXCRM validates both the phone number and the WABA ID against the Graph API live before saving
   anything — if either check fails you'll see "We couldn't verify these WhatsApp credentials with
   Meta" (bad/expired token or wrong ID) or "We couldn't verify this WhatsApp Business Account ID"
   (wrong ID, or the token lacks access to that WABA).
5. Once connected, GenXCRM shows a **webhook URL** and **verify token** unique to your org — see
   [Receiving replies](#receiving-replies) below to wire that into Meta.

Behind the scenes: the access token and App Secret are encrypted at rest
(`backend/src/common/crypto.utils.ts`) and scoped to your org — see
`docs/superpowers/specs/2026-09-09-whatsapp-own-waba-design.md` for the full design. Disconnecting
(also Director-only) clears all of it, including the webhook verify token.

> **Local dev only:** the global `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
> `WHATSAPP_BUSINESS_ACCOUNT_ID` env vars in `backend/.env` still work as a fallback for an org that
> hasn't connected its own WABA (e.g. testing without going through the UI at all). They're commented
> out by default in `.env.example` — uncomment and fill them in only if you specifically want that
> fallback path instead of testing the real connect flow.

---

## Part 4 — A permanent (non-expiring) token

The Part 2 token dies after 24 hours. For anything beyond a quick test, use a **System User token**,
which does not expire, then reconnect in GenXCRM with the new token (Connect again with the same
Phone Number ID / App Secret / WABA ID — it overwrites the stored token).

1. `business.facebook.com/settings` → **Users** → **System users** → **Add** → create one named
   `genxcrm-whatsapp`, role **Admin** (or **Employee**) → **Create**.
2. With that system user selected → **Add assets** → **Apps** → pick your app → grant **Full
   control** (Manage app) → **Save**.
3. Also under **Add assets** → **WhatsApp accounts** → select your **WABA** → grant **Full control**.
4. **Generate new token** → select your **app** → set expiry to **Never** → check the
   **`whatsapp_business_messaging`** and **`whatsapp_business_management`** permissions → **Generate**.
5. **Copy it now** — Meta shows it once. Paste it into GenXCRM's connect form (Part 3) to replace the
   temporary token.

> Store this token like a password. Anyone holding it can send WhatsApp messages as your business.
> GenXCRM encrypts it at rest — never share it outside the connect form, and never commit it to git.

---

## Part 5 — Test

> **Reminder:** because a plain send is *free-form text*, the recipient must have messaged your
> WhatsApp number within the last 24 hours — **or** be a **verified test recipient** on the test
> number (Meta lets you whitelist up to 5 numbers that bypass the window for testing). Add yours:
> **WhatsApp → API Setup** → under "To", **Manage phone number list** → add and verify your personal
> WhatsApp number via OTP.

### 5.1 — Raw API smoke test (no app code)

Confirm your values work with a direct call (replace placeholders; `TO` in international format,
no `+`, e.g. `919876543210`):

```bash
curl -X POST "https://graph.facebook.com/v25.0/$WHATSAPP_PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer $WHATSAPP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "919876543210",
    "type": "text",
    "text": { "body": "GenXCRM test message" }
  }'
```

A `messages` array with an `id` in the response = success, and the message arrives in WhatsApp. A
`131030` error = recipient not in the allowed-numbers list (test mode); `131047` = outside the 24h
window (expected for free-form to a cold number).

### 5.2 — Through GenXCRM

1. Make sure the **lead's `phone`** is in international format with country code (the code sends
   `lead.phone` verbatim — `+91…` or `91…`).
2. Open the lead in the UI and send a WhatsApp message from the communications panel (or call the
   communications endpoint that maps to `sendWhatsApp`).
3. Watch the backend logs. On failure it logs `WhatsApp error for lead {id}` with Meta's message.
   Either way a `Communication` row (`type: WHATSAPP`) is recorded.

---

## Receiving replies

GenXCRM exposes a per-org WhatsApp inbound webhook — each org gets its own URL and verify token
(shown on **Integrations → WhatsApp** once connected), so events for one org's WABA can never be
mistaken for another's:

1. In GenXCRM, go to **Integrations → WhatsApp** and copy the **webhook URL** and **verify token**
   shown there (or use **Regenerate** to issue a fresh verify token if needed — this invalidates the
   old one).
2. In Meta: **WhatsApp → Configuration** → **Webhook** → **Edit** → paste the URL as **Callback URL**
   and the verify token as **Verify token** → **Verify and save**.
3. Subscribe to the **`messages`** field.

GenXCRM verifies every inbound POST's signature against the App Secret you provided when connecting
(Part 2/3) before processing it — an event that fails signature verification is rejected. Handling
lives in `backend/src/integrations/whatsapp/whatsapp-webhook.controller.ts` and
`whatsapp-webhook.service.ts`.

---

## Message templates (proactive / nurturing)

Free-form `text` messages only deliver inside a lead's 24h reply window. To message cold leads
(nurturing), Meta requires **pre-approved message templates**. GenXCRM creates, submits, and tracks
these against **your org's own connected WABA** (via the WhatsApp Business Account ID from Part 2) —
no separate config needed once you're connected:

- Create a WhatsApp template on the **Templates** page → it is submitted to Meta and tracked as
  **PENDING → APPROVED / REJECTED**.
- A background job re-checks every connected org's PENDING templates against Meta once a day; a
  **Refresh status** button on the Templates page forces an immediate check for your own org.
- Only **APPROVED** templates can be used in nurturing WhatsApp steps.
- The token you connected with must hold **`whatsapp_business_management`** (in addition to
  `whatsapp_business_messaging`) — without it, templates save as **DRAFT** and nothing is sent to
  Meta.
- An org that hasn't connected its own WABA falls back to the platform-wide
  `WHATSAPP_BUSINESS_ACCOUNT_ID` env var, same graceful-degradation pattern as sending (local dev
  only — see the note in Part 3).

Template management endpoints used (Graph `v25.0`):
`POST /{businessAccountId}/message_templates` (create),
`POST /{template_id}` (edit), `GET /{businessAccountId}/message_templates` (status poll).
Named variables (`{{name}}`) are converted to Meta's positional `{{1}}..{{n}}` at submit time.

---

## Limitations & next step

WhatsApp sending today is either **free-form text** (within a lead's 24h window) or an **approved
template** (any time). There's no "typing a fresh message and having it just work outside the
window" — proactive contact (welcome messages, nurturing, broadcasts) must go through a template, per
[Message templates](#message-templates-proactive--nurturing) above.

---

## Reference

| Item | Value |
|---|---|
| Product | WhatsApp Cloud API (Meta Graph API) |
| Graph version (in code) | `v25.0` (`communications.service.ts`) |
| Send endpoint | `POST /{phoneNumberId}/messages` |
| Template endpoints | `POST /{businessAccountId}/message_templates`, `POST /{templateId}`, `GET /{businessAccountId}/message_templates` |
| Auth | `Authorization: Bearer {accessToken}` |
| Message type sent | `text` (free-form, 24h) · `template` (approved, any time) |
| Connect (per org) | GenXCRM → **Integrations → WhatsApp** (Director role) — Phone Number ID, Access Token, App Secret, WABA ID |
| Local-dev-only global fallback | `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` in `backend/.env` (commented out by default) |
| Permanent token | System User token w/ `whatsapp_business_messaging` + `whatsapp_business_management` |
| Same app as | App 1 — Lead Ads (`docs/FACEBOOK_BUSINESS_SETUP.md`) — but WABA credentials are per-org, never shared with GenXCRM's own app |
