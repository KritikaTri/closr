# closer

## Daybook personal tracker preview

The standalone wellness tracker is available at `/tracker.html`. It provides a repeating daily schedule with time-aware meal prompts, date-based meal and approximate nutrition logs, optional meal and journal photos, a weight and hydration check-in, movement history with personal bests as reference, rest-day notes, and a future skincare placeholder. Meal windows use meal logs as check-ins; other schedule slots do not require tracking. Estimates use a small set of broad, typical-portion references and should not be treated as exact nutrition data. Entries and resized photos stay in this browser's local storage; this is a local prototype without accounts or cloud sync. Photo journaling is optional and has no AI body scoring or comparison.

Closer is a two-person check-in prototype. Home, Our memories, Chat together, and Talk to Closer are separate pages. Home leads with your partner’s status, a contextual Closer conversation, gentle pings, and your relationship-day count. Your status is changed from the profile control in the header.

## Run the local preview

Requires Node.js 22 or later. From this folder, run:

```sh
npm start
```

Then open <http://127.0.0.1:4173> for Closer, or <http://127.0.0.1:4173/tracker.html> for Daybook. Local preview works with the sample profiles. Copy `.env.example` to `.env` to configure server-side AI or authentication; the server loads `.env` on startup.

Never put database credentials, OAuth secrets, or API keys in browser files.

## Turn on Google sign-in and partner pairing

Closer now has a real account and pairing path backed by Better Auth and PostgreSQL. Each account can join one couple space. The inviter creates a single-use invite link; it expires after seven days and can add only one partner. After pairing, statuses, direct partner messages, and the explicitly shared Closer conversation sync through the server. Private Closer conversations remain in the current browser tab and are not included in the shared history.

1. Create a PostgreSQL database on infrastructure you control. Set its connection string in `.env` as `DATABASE_URL`.
2. Create a Google OAuth **Web application** client in Google Cloud Console. Add `http://localhost:4173` as an authorized JavaScript origin and `http://localhost:4173/api/auth/callback/google` as an authorized redirect URI. Put its ID and secret in `.env`.
3. Set `BETTER_AUTH_URL=http://localhost:4173`, `BETTER_AUTH_SECRET` to a random secret with at least 32 characters, and include the app origin in `APP_ORIGINS`.
4. Apply the authentication schema, then the Closer schema:

   ```sh
   npm run auth:migrate
   npm run db:migrate:couple
   ```

5. Set `AUTH_REQUIRED=true`, restart with `npm start`, then visit <http://localhost:4173/index.html>. The first person signs in and creates the couple space. They send the generated invite link to the second person, who signs in with Google and opens that link.

For a deployed app, use the HTTPS web/API origin in `BETTER_AUTH_URL` and `APP_ORIGINS`, and register `https://YOUR_API_HOST/api/auth/callback/google` as the Google OAuth redirect. Keep `DATABASE_SSL=true` only when your database provider requires verified TLS; use its documented certificate settings when needed. The app is not ready for real sensitive journal entries yet: shared memories and private journals have not been migrated to account-scoped storage.

## What works in this preview

- In local preview, switch between Jamie and Alex. With auth enabled, Google accounts replace the sample profiles and the demo switcher is removed.
- Set a status from the home dropdown or by voice; voice commands such as “set my status online for one hour” are recognized through browser speech support or short server-side transcription, then require confirmation.
- The relationship counter uses January 7, 2026 as the start date and recalculates from the local date each day.
- Our memories has Important dates (with optional photos), Our journal (foldered shared entries with photos), a profile-specific private journal, and shared notes for Closer. Weekly/monthly reflection drafts are generated locally from the selected profile’s private entries.
- When your person is unavailable, a gentle ping is saved for the other account and appears when they next open or refresh Closer. Native push notifications are not connected yet.
- **Chat together** is a direct partner-to-partner thread. In authenticated mode, messages are stored in PostgreSQL and visible to both members.
- The **shared Closer** conversation is stored for both partners, and both can continue it from their account. Private Closer conversations are separate and are not stored in the couple tables.
- When configured, chat replies use the OpenAI Responses API. The server sends `store: false` and does not save chat transcripts; transcripts exist only in the current browser tab session.
- Voice recording can be transcribed through the OpenAI audio transcription API when a key is configured. Recordings are not saved by this app.

## Prototype boundaries

With auth disabled, Jamie and Alex remain sample profiles and browser-local storage is only a prototype. With auth enabled, server routes check the signed-in account and couple membership before reading or changing pair status and messages. The app still needs account-scoped memories and private journals, production deployment, push notifications, and retention/deletion controls before real sensitive diary data should be added. OpenAI receives shared Closer conversation context to answer but requests use `store: false`; the app stores the shared user and assistant messages in PostgreSQL so both partners can continue that conversation.

Authentication and pairing require the environment setup above; adding the code alone does not create a Google OAuth client or provision a production database.

## Mobile app scaffolding

The Capacitor package builds with a configurable HTTPS API origin and uses native Google sign-in on Android/iOS. Native sign-in sends a Google ID token to Better Auth, which validates it against configured Google web/iOS/optional Android client IDs. OAuth client secrets, database credentials, and AI keys stay on the server.

```sh
npm run mobile:add:android  # once, to create the Android project
npm run mobile:add:ios      # once, to create the iOS project (macOS + full Xcode required)
npm run mobile:icons        # regenerate launcher icons after changing assets/
npm run mobile:sync         # rebuild the local web bundle and sync native projects
npm run mobile:build:release # requires HTTPS API host and Google web/iOS client IDs
npm run mobile:open:android
npm run mobile:open:ios
```

Set `CLOSER_API_BASE_URL`, `GOOGLE_CLIENT_ID` (web OAuth client), and `GOOGLE_IOS_CLIENT_ID` in the release build environment. Add Android package `com.closer.couples` and the release signing certificate SHA-1 to an Android OAuth client in the same Google project. Google client IDs are public; never put a client secret in the mobile build. The iOS release build adds the reversed iOS client ID as its URL scheme. Android builds need Android Studio, Android SDK, and a JDK. iOS builds need macOS and full Xcode. Store upload still needs signed release builds, developer accounts, store listing materials, and privacy disclosures.

## Production deployment foundation

The service is container-ready for Cloud Run and PostgreSQL/Cloud SQL. `/healthz` is a lightweight liveness endpoint; `/readyz` checks database connectivity and required migrations. Production refuses to start without HTTPS Better Auth configuration, Google OAuth credentials, a database URL, and authentication enabled. Apply both Better Auth and couple migrations once before sending traffic; do not run schema migrations from every app instance.

1. Create PostgreSQL and a Cloud Run service account with Cloud SQL Client access. Keep the database in the same region as the service. Store `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `GOOGLE_CLIENT_SECRET` in Secret Manager. Configure public OAuth client IDs and exact allowed app origins as non-secret environment values. Set `DATABASE_POOL_SIZE=5` and cap Cloud Run max instances to fit the database connection budget.
2. Build and deploy the container, replacing the uppercase placeholders:

   ```sh
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/closer/closer
   gcloud run deploy closer \\
     --image REGION-docker.pkg.dev/PROJECT_ID/closer/closer \\
     --region REGION \\
     --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE \\
     --service-account closer-runtime@PROJECT_ID.iam.gserviceaccount.com \\
     --set-env-vars "^~^NODE_ENV=production~BETTER_AUTH_URL=https://YOUR_API_HOST~APP_ORIGINS=https://YOUR_WEB_HOST,capacitor://localhost,https://localhost~DATABASE_POOL_SIZE=5~AUTH_REQUIRED=true~GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID~GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID" \\
     --set-secrets DATABASE_URL=closer-database-url:latest,BETTER_AUTH_SECRET=closer-auth-secret:latest,GOOGLE_CLIENT_SECRET=closer-google-secret:latest,OPENAI_API_KEY=closer-openai-key:latest \\
     --max 10 --concurrency 40 --memory 512Mi
   ```

   Set `GOOGLE_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` as regular environment variables. Include every production web/API origin in `APP_ORIGINS`; the Cloud SQL Unix socket connection string can be stored as `DATABASE_URL`. Keep `DATABASE_POOL_SIZE × max instances` below the database connection limit. If you don't have a custom domain ready, make an initial service deployment, then set `BETTER_AUTH_URL` and `APP_ORIGINS` to its assigned HTTPS URL, add the Google callback URI, and deploy the resulting revision before sign-in.
3. Run `npm run auth:migrate` and `npm run db:migrate:couple` once from a trusted migration environment connected to production PostgreSQL. Deploy to staging first and verify `/readyz` returns HTTP 200, then check real Google sign-in, pairing, status sync, next-open ping delivery, and chat on two separate devices.
4. Set `CLOSER_API_BASE_URL=https://YOUR_API_HOST`, `GOOGLE_CLIENT_ID`, and `GOOGLE_IOS_CLIENT_ID` in the native build environment, then run `npm run mobile:build:release`. Build and sign each platform artifact in Android Studio/Xcode.

The current release path covers accounts, pairing, statuses, pings, and chat. Memories/private journals are still browser-local, push notifications are not connected, and the server-local request limiter is a per-instance guard; use a shared edge/service rate limiter for public scale. Set retention/deletion controls and privacy disclosures before accepting diary entries.
