# Google Forms Setup for GenXCRM

Connect your Google account once, pick a Google Form and a Google Sheet, and GenXCRM will:

- send the form to a lead (Email, WhatsApp, SMS or a copyable link, including from the registration wizard),
- bring the student's answers back within about 2 minutes (or instantly with **Check now**) and show them on the registration screen, the lead's page and **Form Responses**,
- add each response as a row in your Google Sheet.

You never paste a script. Once GenXCRM's Google app is published (see Part 1), customers do not see Google's "unverified app" warning.

There are two audiences: the **GenXCRM operator** does Part 1 once; **customers** (Director or Manager) do Part 2.

---

## Part 1 — One-time Google Cloud setup (GenXCRM operator)

1. Create (or reuse) a Google Cloud project. A separate project from the Google Ads one is recommended.
2. **APIs & Services** → **Library** → enable **Google Forms API**, **Google Drive API**, **Google Sheets API** and **Google Picker API**.
3. **OAuth consent screen** → **External**. Fill app name, logo, support email, home page, privacy policy and terms links. Add **only** the scope `https://www.googleapis.com/auth/drive.file` (non-sensitive). Then **Publish app** to production. In Testing mode users see the "unverified app" screen and refresh tokens expire after 7 days.
4. **Credentials** → **OAuth client ID** → **Web application**. Add this authorised redirect URI (it is a page of the GenXCRM web app, not the API):

   ```
   https://app.genxcrm.co.in/integrations/google-forms/callback
   ```

   It is `{FRONTEND_URL}/integrations/google-forms/callback`. If you override it with `GOOGLE_FORMS_REDIRECT_URI`, register that value instead.
5. **Credentials** → **API key** for the Picker. Restrict it to HTTP referrers `https://app.genxcrm.co.in/*`.
6. Set these on the server in **both** `/opt/genxcrm/.env` and `/opt/genxcrm/app/backend/.env`, then `pm2 restart genxcrm-api`:

| Variable | Value |
|---|---|
| `GOOGLE_FORMS_CLIENT_ID` | OAuth client id |
| `GOOGLE_FORMS_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_PICKER_API_KEY` | Picker API key |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | project **number** (Cloud Console → Project settings) |
| `GOOGLE_FORMS_REDIRECT_URI` | optional; only if it differs from the default above |
| `FORM_SYNC_TICK_MS` | optional; sync interval in ms (default 120000) |

Until the first four are set, the tab shows "Google Forms isn't set up on this server yet."

### Before go-live: verify the Lead ID entry id

Prefilled links need the form's `entry.<number>` for the "Lead ID" question. GenXCRM now prefers the value read from the form's public page (what Google actually renders) and only falls back to the `HEX_DECIMAL` rule (`entryIdFromQuestionId` in `backend/src/modules/google-forms/entry-id.util.ts`) when the page cannot be read; a mismatch or a fallback is logged as a warning. The spike is therefore a verification step, but still run it before relying on prefilled links: run `temp/entry-id-spike.cjs` with an OAuth Playground token (steps are in the "Spike outcome" section of `docs/superpowers/specs/2026-09-24-google-forms-oauth-design.md`) and check that the log shows no "unverified" or "differs" warnings when a form is added.

### Deploying

From PowerShell with `$env:Path += ';C:\Program Files\Git\usr\bin'`: `node deploy.mjs be`, then separately `node deploy.mjs app`. Deploy the backend first and the frontend right after, in quick succession (the old frontend calls a removed route). Expect a brief window (seconds) during the backend restart where the old server code still queries the dropped `secret` column, so Google Forms endpoints may return 500. The backend deploy runs `prisma migrate deploy`: `20260924120000_google_forms_oauth` and `20260924130000_drop_google_form_secret` (this one **drops** the legacy `secret` column).

---

## Part 2 — Connect and use (Director or Manager)

1. Go to **Integrations** → **Google Forms** → **Connect Google**. Sign in with the Google account that can edit your form and approve the single permission ("See, edit, create and delete only the specific Google Drive files you use with this app").
2. Click **Add a form**. In the Google window pick your form, then either pick a sheet or choose **Create a sheet for me**, and click **Connect**.
3. GenXCRM adds a short-answer **Lead ID** question to the form (do not delete it; it ties each response to the right lead) and writes a header row in the sheet.
4. Ask for **Name**, **Phone** and **Email** in your form so a brand-new lead can be created when there is no Lead ID. A phone with at least 10 digits is required to create a lead.

Only the forms and sheets you pick in the Google window are visible to GenXCRM. To stop syncing a form, switch it off; nothing is deleted. To change a form's sheet, switch it off and add the form again.

## Sending a form and seeing answers

- In the **registration wizard**, once a lead is chosen the **Student details form** card lets any user pick a form and send it by **Email**, **WhatsApp**, **SMS** or **Copy link** (prefilled with the lead's id).
- The card shows "Waiting for the student's response…", refreshes about every 30 seconds while the tab is open, and has **Check now**. When the student submits it shows "Response received" with the answers (read-only).
- The same answers appear on the lead's page (Forms card) and under **Form Responses**, scoped by role (rep: own leads, manager: own team, director: everyone).
- Sending, checking and viewing are open to every role. Connecting, adding, disconnecting and switching forms on or off are Director/Manager only.

## Reliability

- Answers appear after the next check, up to about 2 minutes. **Check now** checks immediately.
- Google stores every response itself, so responses are never lost, even if GenXCRM is down; they are picked up on the next successful check. Students always see Google's "Response recorded".
- Sheet rows are added separately: a sheet problem never blocks a response from reaching GenXCRM, and the row is retried on the next check. A crash in the middle of a sheet write can add a duplicate row to the sheet (GenXCRM's own records are never duplicated).
- If Google access is removed, the tab shows a **Reconnect Google** button. Reconnect and missed responses are picked up.
- Old Apps Script forms show as "Legacy — reconnect" and cannot be re-activated; add them again with **Add a form**.

## Limits

- The connected Google account must be able to open the chosen form and sheet. Forms owned by someone else must be shared with the connected account.
- Up to 30,000 new responses are read per sync window. A form with more new responses than that in one window stalls with a visible error; the first sync of a huge historical form may need attention.
- Renaming or deleting questions in Google does not rewrite earlier sheet rows; new questions become new columns only when added at the END of the form; a question inserted in the middle misaligns older rows.
- A student who edits an already submitted response is not re-synced: responses are deduplicated by Google's response id, so the first version is kept.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Google Forms isn't set up on this server yet" | The four required env vars are missing (Part 1, step 6). |
| Google shows "hasn't verified this app" | The consent screen is still in Testing; publish it. |
| Popup says redirect_uri_mismatch | The registered redirect URI differs from `{FRONTEND_URL}/integrations/google-forms/callback` (or `GOOGLE_FORMS_REDIRECT_URI`). |
| Reconnect Google button | Access was revoked or the token expired; click it and sign in again. |
| Add a form fails / the picker won't open | `GOOGLE_PICKER_API_KEY` or `GOOGLE_CLOUD_PROJECT_NUMBER` is wrong (the key must allow the app's origin). |
| Form shows an error | The form or sheet was deleted or unshared; switch off and add again, or share it with the connected account. |
| Answers do not attach to the lead | The Lead ID question was deleted, the prefilled link was not used, or the entry id check above failed. |
| Prefilled Lead ID is empty | Entry id rule wrong; see "Before go-live". |

---

## Manual end-to-end checklist (NOT RUN — needs a real Google Cloud project, a public HTTPS deployment and a browser)

1. Complete Part 1; deploy.
2. **Connect Google**: consent shows only the Drive-file permission and no "unverified app" screen.
3. **Add a form** + **Create a sheet for me**: form gains a "Lead ID" question; sheet has a header row.
4. Wizard step 1: choose a lead, **Copy link**, open it: Lead ID is prefilled.
5. Submit; press **Check now**: answers appear in the wizard, lead page, Form Responses and as a sheet row.
6. Submit again and wait: appears within about 2 minutes.
7. Revoke GenXCRM in the Google account: **Reconnect Google** appears; after reconnecting, missed responses arrive.
8. Switch the form off and submit: student still sees "Response recorded".
