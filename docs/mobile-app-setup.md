# GenXCRM Mobile App — Setup & Release Guide (Android)

The GenXCRM web app is wrapped as a native Android app using **Capacitor**, which
loads the existing React/Vite build inside a native WebView. No UI rewrite — the
same frontend code ships to web and mobile.

> **iOS** is deferred (requires a Mac + Xcode). The same setup covers iOS later;
> see the last section.

---

## What's already wired up (in this repo)

- **Capacitor 6** installed in `frontend/` (`@capacitor/core`, `cli`, `android`, `browser`, `app`, `filesystem`, `share`, `preferences`). `filesystem`/`share` back `saveFile()` in `frontend/src/lib/platform.ts` — the plain `<a download>` blob-URL trick used for CSV/report exports doesn't do anything inside the native WebView, so on native the file is written to the cache dir and handed to the OS share sheet instead.
- **`frontend/capacitor.config.ts`** — appId `com.genxcrm.app`, appName `GenXCRM`, `webDir: dist`, `androidScheme: https` (WebView origin is `https://localhost`).
- **`frontend/android/`** — the generated native Android Gradle project (commit this).
- **API URL** — the production build bakes in `VITE_API_BASE_URL=https://api.genxcrm.co.in/api/v1` from `frontend/.env.production`. (Verified: `localhost` is *not* in the bundle.)
- **External links / payments** — routed through the system browser via `frontend/src/lib/platform.ts` (`openExternal`), so they don't dead-end in the WebView:
  - Lead payment links and add-on payment links open externally.
  - Subscription checkout: on native the user is sent to `https://app.genxcrm.co.in/billing` (set by `VITE_WEB_APP_URL`) to pay in the browser — keeps in-app digital purchases out of the store build.
  - Integration OAuth (Facebook/Google): disabled in-app; users are pointed to the web dashboard (OAuth popups can't work in a WebView).
- **Backend CORS** — `backend/src/main.ts` now always allows the native origins `https://localhost` and `capacitor://localhost`, so no prod env change is needed.

---

## One-time machine setup (Windows)

1. **Install Android Studio** (latest) — includes the Android SDK, build tools, and an emulator.
2. During first launch, let the SDK Manager install: **Android SDK Platform (API 34+)**, **Platform-Tools**, and a system image for the emulator.
3. **JDK**: use the JDK **bundled with Android Studio (JBR 17)** — do *not* point Gradle at the system JDK 22; the Capacitor Android project (AGP 8.x) expects JDK 17. Android Studio uses its bundled JDK by default.
4. (Optional, for CLI builds) set `ANDROID_HOME` to the SDK path shown in Android Studio → Settings → Languages & Frameworks → Android SDK.

---

## Build & run the app (every code change)

From `frontend/`:

```bash
npm run build          # tsc + vite build → dist/ (bakes in the prod API URL)
npx cap sync android   # copy dist/ + plugins into android/
npx cap open android   # open the project in Android Studio
```

In Android Studio: pick an emulator or a USB-connected device (with USB debugging on) and press **Run ▶**.

> Shortcut: `npx cap run android` builds + launches from the CLI once the SDK is set up.

**Smoke test on the device/emulator:** log in, open the leads list + a lead detail,
run a CSV import, view the dashboard charts, and tap a payment link — it should open
in the system browser and return to the app.

---

## Release to Google Play

### Before you submit — known gaps in this repo

- **App icon/splash are still Capacitor's stock placeholder.** `frontend/android/app/src/main/res/mipmap-*` and `drawable*/ic_launcher_*` are the generic template graphics generated when `npx cap add android` ran — no branded icon set exists yet (no `resources/` source folder, no `@capacitor/assets` dependency). Generate a real branded icon before building the release bundle (see step 3).
- **No CI build for Android.** `.github/workflows/ci.yml` and `migrate.yml` only build/test the backend and the web frontend — the Android/Gradle build is manual-only today. Fine for a first release; worth automating later if release cadence picks up.
- **`versionCode 1` / `versionName "1.0"`** in `frontend/android/app/build.gradle` — correct for a first release. Just remember: every subsequent upload needs `versionCode` bumped by at least 1, or Play Console will reject the upload.

### 1. Create the developer account
Register at <https://play.google.com/console> — **$25 one-time** fee, paid via the Google account that will own the app.
- **Identity verification**: Google now requires ID verification for all new developer accounts — have a government-issued photo ID and, for organization accounts, a D-U-N-S number or business document ready. This can take a few days, so start it before you need to submit.
- **Account type**: choose **Organization** if publishing as GenXCRM the company (recommended for a real product — looks more trustworthy to users and lets teammates be added later); choose **Personal** only for a solo/test account.
- **Personal accounts** (and new accounts generally) must complete a **closed test with 12 testers, each opted in for 14 continuous days**, before production access unlocks. This gate applies once per account, not per app — start this testing track immediately so it isn't the long pole before your actual release.

### 2. Create an upload keystore (once — keep it forever)
```bash
keytool -genkey -v -keystore genxcrm-upload.keystore -alias genxcrm \
  -keyalg RSA -keysize 2048 -validity 10000
```
**Back up the keystore file + passwords in a password manager, not in the repo.** Losing it means you can never update the app under the same listing. `frontend/android/.gitignore` now ignores `*.jks` / `*.keystore` — keep the keystore file outside `frontend/android/` anyway (e.g. a local secrets folder or password manager attachment) so it's never even a candidate for `git add`.

Configure signing via Android Studio → **Build → Generate Signed Bundle / APK**, and enroll in **Play App Signing** (Google holds the app signing key; you keep the upload key — if the upload key is ever lost or compromised, Google can help you rotate it, but only because Play App Signing is enrolled).

### 3. Build the release bundle
- **Generate a real app icon first.** Use Android Studio → **File → New → Image Asset** (Image Asset Studio) to produce a proper adaptive icon (foreground + background layers) from a source image/logo, replacing the placeholder `ic_launcher*` assets. Alternatively install `@capacitor/assets` and drive it from a single 1024×1024 source PNG.
- Bump `versionCode` (integer, +1 each release) and `versionName` in
  `frontend/android/app/build.gradle`.
- Android Studio → **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**.

### 4. Create the listing & submit
In Play Console, create the app and complete each section:

- **Store listing**:
  - App icon: 512×512, 32-bit PNG (with alpha), no rounded corners (Play applies the mask).
  - Feature graphic: 1024×500 PNG/JPEG, no transparency.
  - Phone screenshots: minimum 2, recommended 4–8, each between 320px and 3840px on the long side (16:9 or 9:16 aspect ratio works well).
  - Title (30 chars), short description (80 chars), full description (4000 chars).
- **Content rating questionnaire**: IARC-based; answer according to actual app behavior — GenXCRM is a business/productivity CRM with user-to-user communication features (call/SMS/WhatsApp/email to leads), so answer the "communication" and "personal info sharing" questions accordingly rather than defaulting to "no" across the board.
- **Data safety form**: declare what this app actually collects and shares, matching the real data flows in the codebase — lead name, email, and phone number are collected and sent to the GenXCRM backend (`https://api.genxcrm.co.in`); no third-party ads or analytics SDKs are bundled unless one is added later, so don't over-declare. Re-check this form whenever a new integration (e.g. an analytics SDK) is added.
- **Privacy policy URL** (required) — `https://app.genxcrm.co.in/privacy`, served by `frontend/src/pages/Privacy.tsx` (routed in `frontend/src/App.tsx`). Confirm the production domain is actually live and serving the built SPA before submitting, since Google will check this URL during review.
- **Target API level**: Google enforces a minimum `targetSdkVersion` annually (new apps/updates must target roughly the last 1–2 Android API levels as of each submission). Check the current requirement on the Play Console policy page at submission time — `frontend/android`'s `targetSdkVersion` may need bumping if it's been a while since the Capacitor project was generated.
- Upload the `.aab` to **Internal testing** first → verify on a real device → promote to **Closed testing** (to satisfy the 12-tester/14-day gate if not already done) → promote to **Production** and submit for review.

**Typical review time**: a few hours to a few days for the first submission (subsequent updates are usually faster). **Common first-submission rejection reasons** to avoid: placeholder/generic launcher icon, missing or unreachable privacy policy URL, incomplete Data Safety form, and the app crashing immediately on launch on a fresh device (test on a device that has never had the dev build installed, not just an emulator you've been iterating on).

---

## iOS (later — needs a Mac)

```bash
cd frontend
npm i @capacitor/ios
npx cap add ios
npx cap open ios     # opens Xcode (macOS only)
```
Build/sign in **Xcode**, enroll in the **Apple Developer Program** ($99/yr), and submit
via **App Store Connect / TestFlight**. All the code changes above (external-link routing,
prod API URL, CORS allowing `capacitor://localhost`) already cover iOS. If you don't own a
Mac, a cloud-Mac CI (Codemagic or GitHub Actions macOS runners) can build and submit iOS.
