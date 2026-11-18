# SSO Setup Guide — Google, X (Twitter), Meta (Facebook)

GenXCRM supports Sign-in / Sign-up via three OAuth providers. Each provider requires a separate app registration. The same Meta app used for Lead Ads webhooks also covers Facebook Login, so you only need one Facebook app overall.

---

## Environment variables summary

Add these to `backend/.env` (see `backend/.env.example` for the full template):

```env
# Google
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# X (Twitter) — OAuth 2.0
TWITTER_CLIENT_ID=""
TWITTER_CLIENT_SECRET=""

# Meta (Facebook) — shared with Lead Ads
FACEBOOK_APP_ID=""
FACEBOOK_APP_SECRET=""
```

`API_URL` and `FRONTEND_URL` must also be set correctly — they control the OAuth callback and post-login redirect URLs:

```env
API_URL="http://localhost:3000"          # backend base URL
FRONTEND_URL="http://localhost:5173"     # frontend base URL
```

---

## 1. Google OAuth

### Where to create the app
Google Cloud Console → **APIs & Services → Credentials**

### Step-by-step

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) and select or create a project.
2. Navigate to **APIs & Services → OAuth consent screen**.
   - Choose **External** (allows any Google account) or **Internal** (G Suite org only).
   - Fill in App name, User support email, and Developer contact email.
   - Under **Scopes**, add:
     - `openid`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/userinfo.profile`
   - Add test users while in development (required for External apps before verification).
3. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
   - Application type: **Web application**
   - Name: e.g. `GenXCRM Local`
   - **Authorised redirect URIs** — add:
     ```
     http://localhost:3000/api/v1/auth/google/callback   ← development
     https://api.genxcrm.co.in/api/v1/auth/google/callback  ← production
     ```
4. Copy the **Client ID** and **Client Secret** into `.env`:
   ```env
   GOOGLE_CLIENT_ID="12345-abc.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="GOCSPX-..."
   ```

### Notes
- Google verifies apps before they can be used by non-test accounts. For internal testing, add team members as test users on the OAuth consent screen.
- The verification process (for public apps) can take several days and requires a privacy policy URL.
- No paid plan is required — the OAuth quota for SSO is free.

---

## 2. X (Twitter) OAuth

> **Important:** X login uses **OAuth 2.0 (authorization code + PKCE)** via `passport-oauth2` (`backend/src/auth/strategies/twitter.strategy.ts`). The credentials are the **Client ID** and **Client Secret** from *Keys & Tokens → OAuth 2.0 Keys* — not the Consumer Key/Secret (OAuth 1.0) and not the Bearer Token or either Access Token. X has no free tier for new developers: apps run on pay-per-use, so the account needs credits. There is no separate review or "go live" step for Sign in with X.

### Where to create the app
[https://developer.x.com](https://developer.x.com) → **Developer Console → Apps → Create App** (inside a Project)

### Step-by-step

1. Sign in at [developer.x.com](https://developer.x.com), accept the developer agreement, and add a payment card and credits under Billing.
2. Create a **Project** (e.g. `GenXCRM`) and inside it, create an **App**. Keep dev and prod as separate apps.
3. In the app's **Settings → User authentication settings → Set up**:
   - Turn on **Allow this app to be used to Sign in with X**.
   - **App permissions:** Read.
   - **Type of App:** Web App (confidential client).
   - **Callback URI / Redirect URL:**
     ```
     http://localhost:3000/api/v1/auth/twitter/callback   ← development
     https://api.genxcrm.co.in/api/v1/auth/twitter/callback  ← production
     ```
   - **Website URL:** a public `https://` domain (e.g. `https://genxcrm.co.in`).
   - **Terms / Privacy URLs:** `https://app.genxcrm.co.in/terms` and `https://app.genxcrm.co.in/privacy`. Save these before turning on **Request email from users**.
4. Under **Keys and Tokens → OAuth 2.0 Keys**, copy the **Client ID** and **Client Secret** (shown once on Regenerate):
   ```env
   TWITTER_CLIENT_ID="your-client-id"
   TWITTER_CLIENT_SECRET="your-client-secret"
   ```

### Notes
- Scopes requested: `users.read tweet.read users.email` (`/2/users/me` needs `users.read` + `tweet.read`; `users.email` returns `confirmed_email`).
- Callback URLs must be an **exact match** — no wildcard, no trailing slash difference.
- Only `confirmed_email` is trusted. If the user's X account has no confirmed email, the profile email is empty and sign-in fails with the standard "no provider email" error — an unconfirmed address is never used, because `findOrCreateFromOAuth` links accounts by email and marks it verified.
- If X returns an error from `/2/users/me` (for example depleted credits), the user lands on `/login?error=sso` and the error is logged.
- Existing X-linked accounts keep working: the numeric X user id is the same under OAuth 1.0a and 2.0.

---

## 3. Meta (Facebook) OAuth

The same Facebook app handles both **SSO login** and the **Lead Ads webhook**. You only need one app.

### Where to create the app
[https://developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**

### Step-by-step

1. Go to [developers.facebook.com](https://developers.facebook.com) and click **My Apps → Create App**.
2. On the **Create an app** screen, you will be asked to select a use case:
   - Select **"Authenticate and request data from users with Facebook Login"** (covers SSO).
   - Click **Next**, then enter your app name (e.g. `GenXCRM`) and contact email, and click **Create App**.
3. Once inside the app dashboard, you need to also cover the Lead Ads webhook. In the left sidebar, look for **"Add use cases"** and add:
   - **"Create & manage app ads with Meta Ads Manager"** — this use case enables the Leads Ads product and its webhook subscription.
4. Configure Facebook Login:
   - In the left sidebar, expand **Facebook Login for Business** → click **Settings**.
   - **Valid OAuth Redirect URIs** and **Redirect URI to check** — leave these blank in development. While the app is in **Development mode**, Facebook accepts any redirect URI automatically, so `http://localhost:3000/api/v1/auth/facebook/callback` works without being registered.
   - When switching to **Live mode** for production, add your production callback to both fields:
     ```
     https://api.genxcrm.co.in/api/v1/auth/facebook/callback
     ```
   - Set **Login with the JavaScript SDK**: No (we use server-side OAuth).
   - Set **Enforce HTTPS**: Yes (required in production; disable only for local HTTP testing).
5. Under **App Settings → Basic**, fill in the required fields and copy your credentials:
   - **App Icon** — upload a square logo (minimum 1024×1024 px). Facebook requires this before the app can request user data.
   - **Privacy Policy URL** — must be a publicly reachable URL. Required to fetch user profile data and mandatory for Live mode.
   - **Terms of Service URL** — add your terms page URL.
   - **User Data Deletion** — Facebook requires either a **Data Deletion Callback URL** or a **Data Deletion Instructions URL**:
     - *Callback URL (recommended, implemented):* `${API_URL}/api/v1/auth/facebook/data-deletion` (e.g. `https://api.genxcrm.co.in/api/v1/auth/facebook/data-deletion`). Facebook POSTs a `signed_request` here when a user removes the app; the backend verifies the HMAC with `FACEBOOK_SSO_APP_SECRET`, scrubs the linked account's PII (right-to-erasure), and returns `{ url, confirmation_code }`. The `url` points at `GET /api/v1/auth/facebook/data-deletion/status?code=…`, a status page the user can visit. `API_URL` must be the public domain registered with Facebook — `https://api.genxcrm.co.in` in production (a local tunnel in dev).
     - *Instructions URL (implemented):* `${API_URL}/api/v1/auth/facebook/data-deletion/instructions` — a public page describing how a user erases their data (remove the app on Facebook, or email support). Use this when Meta asks for an instructions URL rather than a callback.
   - Copy **App ID** and **App Secret**:
     ```env
     FACEBOOK_APP_ID="1234567890"
     FACEBOOK_APP_SECRET="abc123..."
     ```
6. **Email permission:** The `email` permission is requested by the strategy automatically. In development mode (before App Review), it works for any user added as a **Tester** or **Developer** under **App Roles**. In production, `email` is a standard permission that does **not** require App Review.

### Notes
- While the app is in **Development mode**, only people with a role (Admin, Developer, Tester) can log in via Facebook SSO. Add team members under **App Roles → Add Testers**.
- To open the app to the public, switch to **Live mode** using the toggle at the top of the dashboard. All fields in step 5 (icon, privacy policy, terms, data deletion) must be filled before Facebook will allow the switch.
- If a user's Facebook account has no verified email, `profile.emails` will be empty — same handling as Twitter above.
- The `FACEBOOK_VERIFY_TOKEN` env var is used separately for the Lead Ads webhook handshake (`GET /integrations/facebook/webhook`), not for SSO.

---

## Callback URL reference

| Provider | Development callback URL | Environment variable |
|----------|-------------------------|----------------------|
| Google   | `http://localhost:3000/api/v1/auth/google/callback`   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| X        | `http://localhost:3000/api/v1/auth/twitter/callback`  | `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` |
| Meta     | `http://localhost:3000/api/v1/auth/facebook/callback` | `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` |

For production, replace `http://localhost:3000` with the value of `API_URL`.

---

## New user flow after SSO login

When a user signs in via SSO for the first time (no existing account with that email):

1. The backend creates a `User` record with `passwordHash: null` and an `OAuthAccount` record linking the provider.
2. If the user has no organization yet, the JWT response includes `needsOrgSetup: true` and the frontend redirects to `/register/complete`.
3. The user fills in organization details (name, industry, size, country, timezone) — same fields as the email registration Step 2.
4. A 14-day trial starts when the organization is created.

If a user with the same email already exists (registered via email/password), the OAuth account is **linked** to the existing user rather than creating a duplicate account.

---

## Local testing checklist

- [ ] `API_URL=http://localhost:3000` in `.env`
- [ ] `FRONTEND_URL=http://localhost:5173` in `.env`
- [ ] Google: callback URI registered in Cloud Console
- [ ] Google: your Google account added as a test user (if app is in External/Testing mode)
- [ ] X: OAuth 2.0 callback URI registered, Sign in with X on, email permission enabled, credits in place
- [ ] Facebook: callback URI registered, your account added as Tester/Developer in app Roles
- [ ] Backend restarted after updating `.env`
