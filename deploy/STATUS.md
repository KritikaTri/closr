# Closr launch status

Last reviewed: 27 October 2026. This is a staging milestone, not a store release.

## Live staging

- App: https://closer-staging-262689231739.asia-south1.run.app
- Google Cloud project: `closr-512507`; region: Mumbai (`asia-south1`).
- PostgreSQL, private photo storage, Secret Manager, the migration job, and Cloud Run are provisioned.
- A real Google sign-in and creation of the first private couple space succeeded.
- Google sign-in opens the home screen without requiring a partner. The home screen offers an optional invitation; private journaling works before pairing. Shared chat, check-ins, and memories become available after a partner joins.
- Members can save a Closr nickname from their sidebar name or header profile menu, including before pairing. The nickname is stored separately from Google identity and used in profile, status, and chat displays. Saving a Hindi nickname and retaining it after reload were confirmed in the existing signed-in account; a second account/device has not yet been checked.
- Product branding is restored to **Closr**, including the saved Google OAuth app display name. The sidebar profile shows only the member's current nickname; editing, sign out, and account deletion are inside its profile menu. The live signed-in home and menu were visually confirmed after deployment.
- **Journal Studio** is live: My Journal and Our Journal have separate pages and privacy scopes, folders, a calendar-first important-date flow, optional date-to-journal pages, and an editable scrapbook workspace. Postcard, Editorial, Film diary and Blank templates support photos, captions, fonts, cropping, rotation, positioning, resizing, layers, decorations, undo/redo and automatic photo layouts. Existing journal/date records and photo references were imported by migration `0004_journal_studio.sql`.
- The journal editor now opens the photo picker from empty frames, supports direct on-page captions/headings/stories, and keeps heading/story metadata in sync. Caption controls are compact; new photo-frame choices are Postcard and Edge to edge. Dragged photos move to the front, with explicit layer controls still available.
- Details now offers A day / A period with a two-month range calendar, start/end selection and mouse dragging. Folders are organized in the library rather than a required editor field. The page limit is 100 photo frames / 300 elements, with appropriately dense layouts and compact library responses. Editing is disabled during an in-flight upload/save to avoid overwriting changes.
- Photos has Arrange beautifully plus Custom for heart, monument/arch, grid and timeline arrangements. These are built-in layouts, without AI. Make trip pages reviews capture dates and offers one trip page or separate daily pages, optional trip-folder grouping and per-day headings/stories. Browser JPEG capture dates are read locally before re-encoding; missing dates require a choice for daily pages and have a bulk assignment control. Stable creation identifiers make exact save retries safe; daily progress is retained during an interrupted batch.
- The signed-in private library, important-date calendar, postcard template and caption/frame controls were visually confirmed. The updated on-page heading/caption/story controls, synchronized Details fields, range selection and custom-layout dialog were also visually confirmed in an unsaved sample. No sample page was saved or photo uploaded during these walkthroughs. Trip saves, 100-photo uploads and native permissions still need actual usage/device verification. Page saves use revision conflicts and recoverable trash. Private weekly/monthly look-backs remain available as factual summaries.
- Phone gallery date/favourites previews have native source and bridge registration prepared, with explicit selection before uploads. Android/iPhone permission and gallery behaviour are not device-verified. Browser uploads use the selected-file picker. The optional OpenAI writing formatter remains off; the user chose to try the editor first. Spotify work is on hold and was not deployed.
- **Record a moment** adds voice/video diary entries to My Journal or Our Journal, with an explicit Start/Pause/Stop capture flow, original-clip preview, title/date/note, existing-recording import, saved playback and editable details. Recordings use the same private bucket, scoped playback authorization and journal Trash/Restore. Migration `0005_journal_recordings.sql` adds upload leases, quotas and recording/page references. No AI or transcription is involved.
- The signed-in library and diary recorder, audio/video mode switches and scrollable metadata/save fields were visually confirmed. No microphone/camera permission was requested and no sample recording was made, uploaded or saved. Actual recording, upload/retry, replay, two-account isolation and Android/iPhone behaviour remain usage/device checks. Foreground capture stops when the page is hidden; background/locked-screen recording is not supported. Clips are capped at 10 minutes audio / 3 minutes video and 24 MiB, with per-account daily and retry limits. Original codecs are retained, so cross-platform playback needs a check on both phones.
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
- Verify the new journal editor, gallery date/favourites permissions (including limited access), selected photo uploads, and shared revision conflicts on real devices and two separate accounts. Handwriting recognition and AI photo curation are not implemented. Google Photos cloud OAuth, Maps location history, Google Drive imports and Canva template imports are not connected. Native image export is not enabled; PNG download is available on the web.
- Complete developer-account, store listing, privacy disclosure, and review requirements for Google Play and the App Store.

There is no signed APK/AAB/IPA or published store listing from this deployment. See [the deployment runbook](README.md) for repeatable infrastructure and deployment commands.
