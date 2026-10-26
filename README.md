# closer

## Daybook personal tracker preview

The standalone wellness tracker is available at `/tracker.html`. It provides a repeating daily schedule with time-aware meal prompts, date-based meal and approximate nutrition logs, optional meal and journal photos, a weight and hydration check-in, movement history with personal bests as reference, rest-day notes, and a future skincare placeholder. Meal windows use meal logs as check-ins; other schedule slots do not require tracking. Estimates use a small set of broad, typical-portion references and should not be treated as exact nutrition data. Entries and resized photos stay in this browser's local storage; this is a local prototype without accounts or cloud sync. Photo journaling is optional and has no AI body scoring or comparison.

Closer is a personal space with optional two-person check-ins. Home, memories/journal, Chat together, and Talk to Closer are separate pages. After Google sign-in, unpaired accounts open Home with an optional partner invitation and access to a private journal. Once paired, Home shows your partner’s status, a contextual Closer conversation, gentle pings, and your relationship-day count. Your status is changed from the profile control in the header.

## Run the local preview

Requires Node.js 22 or later. From this folder, run:

```sh
npm start
```

Then open <http://127.0.0.1:4173> for Closer, or <http://127.0.0.1:4173/tracker.html> for Daybook. Local preview works with the sample profiles. Copy `.env.example` to `.env` to configure server-side AI or authentication; the server loads `.env` on startup.

Never put database credentials, OAuth secrets, or API keys in browser files.

## Turn on Google sign-in and partner pairing

Closer has a Google OAuth account path backed by Better Auth and PostgreSQL. Signing in does not require a partner: the user enters Home and can use their account-private journal. Each account can optionally join one couple space. The inviter creates a single-use link from Home; it expires after seven days and can add only one partner. The recipient signs in and explicitly accepts the invitation. After pairing, statuses, direct partner messages, and the explicitly shared Closer conversation sync through the server. Private Closer conversations remain in the current browser tab, keyed to the signed-in account, and are not included in the shared history. AI replies require the optional server-side API key.

1. Create a PostgreSQL database on infrastructure you control. Set its connection string in `.env` as `DATABASE_URL`.
2. Create a Google OAuth **Web application** client in Google Cloud Console. Add `http://localhost:4173` as an authorized JavaScript origin and `http://localhost:4173/api/auth/callback/google` as an authorized redirect URI. Put its ID and secret in `.env`.
3. Set `BETTER_AUTH_URL=http://localhost:4173`, `BETTER_AUTH_SECRET` to a random secret with at least 32 characters, and include the app origin in `APP_ORIGINS`.
4. Apply the authentication schema, then the Closer schema:

   ```sh
   npm run auth:migrate
   npm run db:migrate:couple
   ```

5. Set `AUTH_REQUIRED=true`, restart with `npm start`, then visit <http://localhost:4173/index.html>. Sign in with Google to enter Home. To connect a partner later, choose **Invite your partner**, create a link, and share it privately. The second person opens that link, signs in with Google, and chooses **Accept invitation**. Choosing **Go to my home instead** lets them continue without connecting.

For a deployed app, use the HTTPS web/API origin in `BETTER_AUTH_URL` and `APP_ORIGINS`, and register `https://YOUR_API_HOST/api/auth/callback/google` as the Google OAuth redirect. Register `https://YOUR_API_HOST/api/auth/callback/apple` as the Apple Service ID return URL. Keep `DATABASE_SSL=true` only when your database provider requires verified TLS; use its documented certificate settings when needed. Account-scoped text/photo storage is implemented, but the app still needs production infrastructure and privacy/retention controls before accepting real sensitive journal entries.

## What works in this preview

- In local preview, switch between Jamie and Alex. With auth enabled, Google accounts replace the sample profiles and the demo switcher is removed.
- Signed-in members can choose a nickname from the header profile menu or their sidebar name. Nicknames support Hindi, other Unicode text, and emoji (up to 40 Unicode code points), sync across devices, and replace Google names in partner/profile displays and chat labels. Each user can change only their own nickname or restore their Google name. Nicknames live separately from OAuth identity, survive Google sign-in, and are removed by account deletion.
- Set a status from the home dropdown or by voice; voice commands such as “set my status online for one hour” are recognized through browser speech support or short server-side transcription, then require confirmation.
- The relationship counter uses January 7, 2026 as the start date and recalculates from the local date each day.
- Our memories has Important dates, a foldered shared journal, account-private journal entries, and shared notes for Closer. Shared data is couple-scoped; private journal rows are scoped to the signed-in user. Weekly/monthly reflection drafts are generated on-device from that user's private entries. Authenticated cloud photos require the private Cloud Storage bucket configuration below.
- When your person is unavailable, a gentle ping is saved for the other account and appears when they next open or refresh Closer. Native push notifications are not connected yet.
- **Chat together** is a direct partner-to-partner thread. In authenticated mode, messages are stored in PostgreSQL and visible to both members.
- The **shared Closer** conversation is stored for both partners, and both can continue it from their account. Private Closer conversations are separate and are not stored in the couple tables.
- When configured, private and shared Closer replies use the OpenAI Responses API with `store: false`. Private chat stays in the current browser tab session and is not saved in Closer's database; shared chat is saved in PostgreSQL for both partners.
- Voice recording can be transcribed through the OpenAI audio transcription API when a key is configured. Recordings are not saved by this app.

## Prototype boundaries

With auth disabled, Jamie and Alex remain sample profiles and browser-local storage is only a prototype. With auth enabled, server routes check the signed-in account and couple membership before reading or changing pair status, messages, or memories. Private journal rows and photos are only queried for the owner; private entries are not sent to either Closer conversation. Users can permanently delete their account from the sidebar; this removes their private records/photos and entries/messages they created. The app still needs production deployment, push notifications, account export and retention controls, and reviewed privacy disclosures before public use with sensitive diary data. Private and shared Closer messages are sent to OpenAI for replies with `store: false`; private messages are not saved in Closer's PostgreSQL chat tables, while shared messages are stored so both partners can continue the shared conversation.

Authentication and pairing require the environment setup above; adding the code alone does not create a Google OAuth client or provision a production database.

## Android and iPhone beta

The Capacitor projects package the current app and use the same live backend. Native Google sign-in sends provider ID tokens to Better Auth for server-side validation; native HTTP retains the server session cookies. Apple sign-in code is included but still needs Apple credentials and provisioning. No signed phone build has been produced or verified on a real device yet. See [the mobile setup guide](mobile/README.md) for the current state and remaining steps.

```sh
npm run mobile:doctor        # read local build prerequisites
npm run mobile:prepare:android # prepare Android beta against the live staging backend
npm run mobile:prepare:ios     # also needs the Google iOS client ID
npm run mobile:open:android
npm run mobile:open:ios
# Later, prepare each store project independently (these do not compile/sign):
npm run mobile:build:release -- android
npm run mobile:build:release -- ios
```

The preparation commands load public staging defaults from `mobile/staging.json` and optional public client-ID overrides from ignored `.env.mobile`. Android needs the Google web client ID and an Android OAuth registration for package `com.closer.couples` plus the signing certificate SHA-1. iOS additionally needs `GOOGLE_IOS_CLIENT_ID`; the planned iOS store release also needs `APPLE_CLIENT_ID` and complete server-side Apple configuration. OAuth secrets, database credentials, Apple private keys, and AI keys stay on the server. Native compilation requires Android SDK/JDK or full Xcode; distribution also requires signing and the corresponding store account.

## Production deployment foundation

The service is container-ready for Cloud Run and PostgreSQL/Cloud SQL. `/api/health` is a lightweight liveness endpoint; `/api/ready` checks database connectivity and required migrations. Production requires HTTPS Better Auth configuration, Google sign-in credentials, a database URL, a private photo bucket, a secret of at least 32 characters, and authentication enabled. Apple credentials are optional for Google-only staging, but must be supplied together; set `REQUIRE_APPLE_SIGN_IN=true` before an iOS store release. AI and server transcription return an unavailable response until the server's AI key is configured.

The project-specific staging configuration is in `deploy/gcp.json`. Start with `npm run cloud:plan`; this only prints the plan. See [the deployment runbook](deploy/README.md) for provisioning, permissions, costs, and credentials. `npm run cloud:check` performs read-only resource checks. `npm run cloud:deploy` also prints the plan unless explicitly passed `-- --apply`. With that flag it builds an immutable container image, runs one migration job, and deploys the app with database-backed startup readiness. It does not provision infrastructure or configure OAuth automatically. The commands below describe the older manual deployment path; prefer the project-specific runbook for this staging deployment.

1. Create PostgreSQL, a private Cloud Storage bucket with public access prevention, and a Cloud Run service account with Cloud SQL Client and Storage Object Admin roles. Grant the runtime service account `roles/iam.serviceAccountTokenCreator` on itself so it can sign short-lived private photo URLs. Keep the database and bucket near the service. Store `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, and `APPLE_PRIVATE_KEY` in Secret Manager. Configure `GCS_BUCKET`, OAuth client IDs, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and exact allowed app origins as environment values. Set `DATABASE_POOL_SIZE=5` and cap Cloud Run max instances to fit the database connection budget.
2. Build and deploy the container, replacing the uppercase placeholders:

   ```sh
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/closer/closer
   gcloud run deploy closer \\
     --image REGION-docker.pkg.dev/PROJECT_ID/closer/closer \\
     --region REGION \\
     --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE \\
     --service-account closer-runtime@PROJECT_ID.iam.gserviceaccount.com \\
     --set-env-vars "^~^NODE_ENV=production~BETTER_AUTH_URL=https://YOUR_API_HOST~APP_ORIGINS=https://YOUR_WEB_HOST,capacitor://localhost,https://localhost~DATABASE_POOL_SIZE=5~AUTH_REQUIRED=true~GCS_BUCKET=YOUR_PRIVATE_BUCKET~GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID~GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID~APPLE_CLIENT_ID=YOUR_APPLE_SERVICE_ID~APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID~APPLE_KEY_ID=YOUR_APPLE_KEY_ID~APPLE_APP_BUNDLE_IDENTIFIER=com.closer.couples" \\
     --set-secrets DATABASE_URL=closer-database-url:latest,BETTER_AUTH_SECRET=closer-auth-secret:latest,GOOGLE_CLIENT_SECRET=closer-google-secret:latest,APPLE_PRIVATE_KEY=closer-apple-private-key:latest,OPENAI_API_KEY=closer-openai-key:latest \\
     --max 10 --concurrency 40 --memory 512Mi
   ```

   Set `GOOGLE_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` as regular environment variables. Include every production web/API origin in `APP_ORIGINS`; the Cloud SQL Unix socket connection string can be stored as `DATABASE_URL`. Keep `DATABASE_POOL_SIZE × max instances` below the database connection limit. If you don't have a custom domain ready, make an initial service deployment, then set `BETTER_AUTH_URL` and `APP_ORIGINS` to its assigned HTTPS URL, add the Google callback URI, and deploy the resulting revision before sign-in.
3. Run `npm run db:migrate` once from a trusted migration environment connected to production PostgreSQL. This applies Better Auth's schema, then ordered Closer migrations under one advisory lock. Each Closer migration has a stored checksum, so retries skip completed files and changed historical files stop the run. The image includes this migration entry point; app replicas never run migrations on startup. Deploy to staging first and confirm `/api/ready` returns HTTP 200, then check real Google sign-in, pairing, status sync, next-open ping delivery, shared memory sync, and private-journal isolation on two separate accounts/devices.
4. Set public native build configuration as described in `mobile/README.md`, then run `npm run mobile:build:release -- android` or `npm run mobile:build:release -- ios`. Compile and sign each platform artifact in Android Studio/Xcode; preparation alone does not create an APK, AAB, or IPA.

The current release path covers accounts, pairing, statuses, pings, chat, account-scoped memories/private journals, private photo objects in Google Cloud Storage, and in-app account deletion. Push notifications are not connected, and the server-local request limiter is a per-instance guard; use a shared edge/service rate limiter before public scale. Add account export, retention controls, and privacy disclosures before accepting diary entries from public users.

## Branding and distribution notices

`npm run audit:branding` scans the product source, native metadata, image text metadata, and web bundle for unintended company branding. Web builds run this check automatically. Git author identity is configured locally for this repository; historical commits and employment-related ownership are outside the product-file scan.

The app footer links to `open-source.html`. `npm run notices:generate` preserves the embedded Capacitor, Cordova, and social-login license notices and packages the installed social-login component's corresponding source under `open-source/`, including native configuration changes and original TypeScript reconstructed from supplied source maps. Mobile sync refreshes this archive after native dependency hooks run. Original dependency copyright notices must be retained.

Before signing a store release, also collect the exact resolved native SDK licenses from Gradle and Swift Package Manager. The current generated page covers the npm-supplied embedded components and font source links; it does not claim to be a complete final native SDK inventory or a trademark/ownership clearance.
