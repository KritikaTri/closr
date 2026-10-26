# Closr launch status

Last reviewed: 26 October 2026. This is a staging milestone, not a store release.

## Live staging

- App: https://closer-staging-262689231739.asia-south1.run.app
- Google Cloud project: `closr-512507`; region: Mumbai (`asia-south1`).
- PostgreSQL, private photo storage, Secret Manager, the migration job, and Cloud Run are provisioned.
- A real Google sign-in and creation of the first private couple space succeeded.
- Google sign-in opens the home screen without requiring a partner. The home screen offers an optional invitation; private journaling works before pairing. Shared chat, check-ins, and memories become available after a partner joins.
- Members can save a Closr nickname from their sidebar name or header profile menu, including before pairing. The nickname is stored separately from Google identity and used in profile, status, and chat displays. Saving a Hindi nickname and retaining it after reload were confirmed in the existing signed-in account; a second account/device has not yet been checked.
- Product branding is restored to **Closr**, including the saved Google OAuth app display name. The sidebar profile shows only the member's current nickname; editing, sign out, and account deletion are inside its profile menu. The live signed-in home and menu were visually confirmed after deployment.
- **Journal Studio** is live: My Journal and Our Journal have separate pages and privacy scopes, folders, a calendar-first important-date flow, optional date-to-journal pages, and an editable scrapbook workspace. Postcard, Editorial, Film diary and Blank templates support photos, captions, fonts, cropping, rotation, positioning, resizing, layers, decorations, undo/redo and automatic photo layouts. Existing journal/date records and photo references were imported by migration `0004_journal_studio.sql`.
- The signed-in private library, important-date calendar, postcard template and caption/frame controls were visually confirmed. No sample page was saved or photo uploaded during that walkthrough. Page saves use revision conflicts and recoverable trash. Private weekly/monthly look-backs remain available as factual summaries.
- Phone gallery date/favourites previews have native source and bridge registration prepared, with explicit selection before uploads. Android/iPhone permission and gallery behaviour are not device-verified. Browser uploads use the selected-file picker. The optional OpenAI writing formatter remains off; the user chose to try the editor first. Spotify work is on hold and was not deployed.
- Partner invitations use one compact **Join me on Closr** card, **Send an invite link**, and **Copy link**. Sharing passes only the invitation URL to the device share sheet; the operating system supplies supported apps and recipients. The recipient landing page prompts account creation or sign-in, then joining the inviter's space. Valid pending invitations are reused, and links use the public backend address, including when shared from the native app.
- The simplified invitation card, enabled Send/Copy actions, and public invitation URL were confirmed in the signed-in browser after deployment. The invitation landing page correctly identifies the inviter's own link and prevents self-pairing. No external message was sent; signup and joining with a second Google account, and sharing on real phones, remain unverified.
- The Google consent app remains External / Testing, with basic profile and email scopes only. Google's basic sign-in exception means a second account does not need to be on its test-user list. Signing in and joining through the app's partner invite still need verification on the second account.
- Automated backups and point-in-time recovery are enabled. The on-demand schema baseline backup completed successfully; restoration has not been exercised.
- The ₹2,000 gross monthly usage budget sends alerts; it does not stop spending.

## Before the couple trial is verified

- Join with a second real Google account using a one-use invite.
- Confirm the system share sheet and link-only payload on Android and iPhone, including supported WhatsApp and Instagram destinations and Copy link. Native universal/app links are not configured; invitation links currently open the web signup/join flow.
- Confirm status changes, next-open pings, partner messages, shared memories and photos across the two accounts/devices.
- Confirm private journals and photos cannot be read by the other account, and exercise account deletion with disposable staging accounts.
- Enable AI only after configuring its server-side secret and cost limits. AI and server transcription are currently unavailable.

## Before a public mobile launch

- Replace the trial database capacity with an appropriate availability/capacity plan.
- Separate migration DDL privileges from application DML privileges, add a shared rate limiter, and exercise backup restoration.
- Finish privacy/retention/export controls, public support and legal pages, and native dependency notices.
- Configure native Google and Apple sign-in, then sign and verify Android and iOS release builds on real devices.
- Verify the new journal editor, gallery date/favourites permissions (including limited access), selected photo uploads, and shared revision conflicts on real devices and two separate accounts. Handwriting recognition and AI photo curation are not implemented. Native image export is not enabled; PNG download is available on the web.
- Complete developer-account, store listing, privacy disclosure, and review requirements for Google Play and the App Store.

There is no signed APK/AAB/IPA or published store listing from this deployment. See [the deployment runbook](README.md) for repeatable infrastructure and deployment commands.
