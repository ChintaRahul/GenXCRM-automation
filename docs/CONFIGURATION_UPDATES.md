# Configuration Updates — Production Backend Cutover

Single reference for every configuration change made when GenXCRM moved off the temporary
ngrok tunnel and onto the deployed backend.

| Thing | Value |
|---|---|
| **Backend API** | `https://api.genxcrm.co.in` (base path `/api/v1`) |
| **App (React SPA)** | `https://app.genxcrm.co.in` (moved off the bare domain 2026-08-26 — see landing page split below) |
| **Marketing landing page** | `https://genxcrm.co.in` (static site, `landing/`) |
| **Backend host** | EC2 `i-0f9f266cdfd902243`, Elastic IP `65.2.193.254`, region `ap-south-1` |
| **Old value (retired)** | `https://underwent-brewing-barge.ngrok-free.dev` |

---

## 1. Frontend — `frontend/.env.production`

```diff
- VITE_API_BASE_URL=https://underwent-brewing-barge.ngrok-free.dev/api/v1
+ VITE_API_BASE_URL=https://api.genxcrm.co.in/api/v1
```

Applied live by rebuilding + redeploying: `node deploy-app.mjs` (S3 `genxcrm-frontend-production`
→ CloudFront `E25NNOEV3H7UA6` invalidation).

---

## 2. Backend runtime env — `/opt/genxcrm/.env` (on the EC2 box)

Persistent file, copied to `backend/.env` on each deploy. Changes made during cutover:

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://genxcrm:****@localhost:5432/genxcrm` | Colocated PG15 on the box (seeded by the stack) |
| `REDIS_URL` | `redis://localhost:6379` | Local Redis6 for BullMQ |
| `PORT` | `3000` | nginx proxies `:443` → `:3000` |
| `API_URL` | `https://api.genxcrm.co.in` | Public API domain |
| **`CORS_ORIGIN`** | **`https://app.genxcrm.co.in`** | **Fixed** — was wrongly the API's own domain, which blocked all browser calls. Must be the **app** origin (not the marketing landing page — it never calls the API). Comma-separate for multiple. |
| **`JWT_SECRET`** | *auto-generated 32-byte hex* | Was missing; generated on the box with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | `7d` | Added |

After editing this file, reload the app: `pm2 restart genxcrm-api --update-env`.

### Still blank (integrations degrade gracefully until set)
Add real values and `pm2 restart genxcrm-api --update-env` when ready:
`SENDGRID_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`,
`FACEBOOK_CONFIG_ID`, `FACEBOOK_LEAD_ADS_REDIRECT_URI`, `FACEBOOK_VERIFY_TOKEN`,
`FACEBOOK_SSO_APP_ID`, `FACEBOOK_SSO_APP_SECRET`, `INTEGRATION_SECRET_KEY`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`.

---

## 3. Infrastructure — `infra/cloudformation-backend.yml`

| Change | Why |
|---|---|
| Quoted `ConstraintDescription` on `DBPassword` | Unquoted `" : "` broke YAML parsing on upload |
| certbot installed in an isolated venv (`/opt/certbot`) instead of bare `pip3 install` | AL2023 system Python is PEP-668 externally-managed; a plain install aborts UserData under `set -e` |
| nginx `server_name` → `${DomainName}` (was hard-coded `api.genxcrm.co.in`) | Stays in sync with the `DomainName` parameter |
| **New `FrontendUrl` parameter** (default `https://app.genxcrm.co.in`) | Source for `CORS_ORIGIN` |
| `.env.server` scaffold: `CORS_ORIGIN=${FrontendUrl}` (was `${DomainName}`) | Root-cause fix so future stacks don't reintroduce the CORS bug |

> Cross-region note: this stack must deploy in the **same region** as `cloudformation.yml`
> (`ap-south-1`) for the `Fn::ImportValue` lookups to resolve.

---

## 4. Third-party provider dashboards — URLs to register

All previously pointed at the ngrok host; update each to `https://api.genxcrm.co.in`.

### Facebook — App 1 (Lead Ads)
- **Valid OAuth Redirect URI**: `https://api.genxcrm.co.in/api/v1/integrations/config/facebook/oauth/callback`
- **Webhook Callback URL**: `https://api.genxcrm.co.in/api/v1/integrations/facebook/webhook` (field `leadgen`, verify token `genxcrm-fb-verify`)

### Facebook — App 2 (Login / SSO)
- **Valid OAuth Redirect URI**: `https://api.genxcrm.co.in/api/v1/auth/facebook/callback`
- **Data Deletion Instructions URL**: `https://api.genxcrm.co.in/api/v1/auth/facebook/data-deletion/instructions`
- **Data Deletion Callback URL**: `https://api.genxcrm.co.in/api/v1/auth/facebook/data-deletion`

### Google SSO
- **Authorised redirect URI**: `https://api.genxcrm.co.in/api/v1/auth/google/callback`

### X (Twitter) SSO
- **Callback URL**: `https://api.genxcrm.co.in/api/v1/auth/twitter/callback`

### Razorpay
- **Webhook URL**: `https://api.genxcrm.co.in/api/v1/billing/webhook`

---

## 5. Docs updated in this change

Every ngrok/`yourdomain.com` reference replaced with `https://api.genxcrm.co.in`:
- `docs/FACEBOOK_BUSINESS_SETUP.md`
- `docs/FACEBOOK_PAID_LEAD_ADS.md`
- `docs/razorpay-billing-setup.md`
- `docs/sso-setup.md`

(Code references to the literal string `"ngrok"` in `frontend/src/api/client.ts`,
`frontend/src/hooks/useIntegrations.ts`, and `backend/src/auth/auth.service.ts` are conditional
logic / comments, not URLs — intentionally left as-is.)
