# Email Sending Setup for GenXCRM

By default, GenXCRM sends transactional email (welcome emails, nurturing steps, manual sends) through
a shared platform AWS SES sender (`SES_FROM_EMAIL` / `SES_FROM_NAME` in the backend's `.env`). Every
org can instead connect its **own** email identity from **Integrations → Email**, so recipients see
mail coming from the org's own address rather than GenXCRM's shared sender. There are two methods —
pick one per org:

1. **Custom SMTP** — send through your own mailbox (e.g. Gmail) using its SMTP credentials.
2. **GenXCRM's SES, with your own domain** — no SMTP credentials to manage; you just prove you own a
   domain by adding a few DNS records, and GenXCRM sends on your behalf from that verified domain.

Orgs that don't connect anything keep working exactly as before — nothing changes for them.

> What the code does: `CommunicationsService.resolveEmailCredentials()`
> (`backend/src/modules/communications/communications.service.ts`) looks up the caller's org's
> `OrgIntegration` row for provider `EMAIL`. If connected via SMTP, it builds a `nodemailer` transport
> from the org's encrypted credentials. If connected via SES-with-custom-domain, it keeps using the
> same shared AWS SES client but swaps in the org's verified `From` address. If nothing is connected,
> it falls back to the global `SES_FROM_EMAIL`/`SES_FROM_NAME` env vars — the same graceful-degradation
> pattern used for WhatsApp and Twilio.

---

## Option 1: Custom SMTP (e.g. Gmail)

1. In Gmail, turn on 2-Step Verification, then create an **App Password**
   (Google Account → Security → App passwords). Gmail account passwords don't work over SMTP when
   2FA is on — you need the 16-character app password.
2. In GenXCRM, go to **Integrations → Email → Custom SMTP** and enter:
   - **SMTP Host**: `smtp.gmail.com` (or your provider's SMTP host)
   - **Port**: `587` (STARTTLS) or `465` (TLS) — check the "Use TLS" box for port 465
   - **Username**: your full email address
   - **Password**: the app password from step 1
   - **From email** / **From name**: what recipients see as the sender
3. Click **Connect**. GenXCRM performs a live SMTP handshake before saving anything — if the
   credentials are wrong, you'll see an error immediately and nothing is stored.

Any SMTP-compatible provider works the same way (Outlook, a custom mail server, a transactional email
provider's SMTP relay) — just use that provider's host/port/credentials instead of Gmail's.

## Option 2: GenXCRM's SES with your own domain

Use this if you don't want to manage SMTP credentials and are comfortable adding DNS records at your
domain registrar (GoDaddy, Cloudflare, Route 53, etc.).

1. In GenXCRM, go to **Integrations → Email → Use my own domain** and enter your domain
   (e.g. `acme.com`) and the from-address/name you want leads to see.
2. GenXCRM starts AWS SES domain verification and shows you the DNS records to add:
   - **1 TXT record** (`_amazonses.yourdomain.com`) — proves domain ownership
   - **3 CNAME records** (DKIM) — lets recipients' mail servers verify mail actually came from you
3. Add all four records at your DNS provider. Propagation is usually fast but can take up to a few
   hours.
4. Come back to the Email tab (or click **Check status**) — GenXCRM re-checks AWS SES and flips the
   integration to **Connected** once the records are verified. The tab also checks automatically the
   next time you open it while verification is still pending.

Until verification completes, the org's email keeps sending from the shared platform sender — nothing
breaks while you wait on DNS.

---

## Disconnecting

**Integrations → Email → Disconnect** (Director only — email credentials are the org's own, so only a
Director can sever them). Disconnecting clears the stored credentials/domain; the org falls back to
the shared platform sender until it reconnects.
