# Closer launch status

Last reviewed: 26 October 2026. This is a staging milestone, not a store release.

## Live staging

- App: https://closer-staging-262689231739.asia-south1.run.app
- Google Cloud project: `closr-512507`; region: Mumbai (`asia-south1`).
- PostgreSQL, private photo storage, Secret Manager, the migration job, and Cloud Run are provisioned.
- A real Google sign-in and creation of the first private couple space succeeded.
- Google sign-in opens the home screen without requiring a partner. The home screen offers an optional invitation; private journaling works before pairing. Shared chat, check-ins, and memories become available after a partner joins.
- Members can save a Closer nickname from their sidebar name or header profile menu, including before pairing. The nickname is stored separately from Google identity and used in profile, status, and chat displays. Saving a Hindi nickname and retaining it after reload were confirmed in the existing signed-in account; a second account/device has not yet been checked.
- The Google consent app remains External / Testing, with basic profile and email scopes only. Google's basic sign-in exception means a second account does not need to be on its test-user list. Signing in and joining through the app's partner invite still need verification on the second account.
- Automated backups and point-in-time recovery are enabled. The on-demand schema baseline backup completed successfully; restoration has not been exercised.
- The ₹2,000 gross monthly usage budget sends alerts; it does not stop spending.

## Before the couple trial is verified

- Join with a second real Google account using a one-use invite.
- Confirm status changes, next-open pings, partner messages, shared memories and photos across the two accounts/devices.
- Confirm private journals and photos cannot be read by the other account, and exercise account deletion with disposable staging accounts.
- Enable AI only after configuring its server-side secret and cost limits. AI and server transcription are currently unavailable.

## Before a public mobile launch

- Replace the trial database capacity with an appropriate availability/capacity plan.
- Separate migration DDL privileges from application DML privileges, add a shared rate limiter, and exercise backup restoration.
- Finish privacy/retention/export controls, public support and legal pages, and native dependency notices.
- Configure native Google and Apple sign-in, then sign and verify Android and iOS release builds on real devices.
- Complete developer-account, store listing, privacy disclosure, and review requirements for Google Play and the App Store.

There is no signed APK/AAB/IPA or published store listing from this deployment. See [the deployment runbook](README.md) for repeatable infrastructure and deployment commands.
