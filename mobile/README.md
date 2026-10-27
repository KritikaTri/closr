# Closr phone beta

Both native projects package the existing interface and call the same HTTPS backend. Accounts, partner connections, statuses, chat, and journals remain on that backend. The mobile app never contains Google secrets, database credentials, Apple keys, or AI keys.

## Current state

| Item | State |
| --- | --- |
| Staging backend and Google web sign-in | Live |
| Android/iOS projects and app icons | Present |
| Android beta web assets | Can be prepared with the checked-in public staging profile |
| Native Google OAuth registrations | Android certificate registration and iOS client still needed |
| Signed Android/iOS binaries | Not built |
| Store/TestFlight submission | Not submitted |
| Real-device login and two-account sync | Not yet verified |
| AI chat/transcription | Disabled until the server AI key is configured |
| Push notifications | Not connected; pings are currently visible when opening the app |

The first beta is one Android phone and one iPhone. It targets Android 8 (API 26) or newer and iOS 15 or newer. The Android minimum accounts for the native HTTP dependency's binary photo/audio upload support. Prepare Android first while Xcode and the Apple account are being set up.

## Public build configuration

`mobile/staging.json` contains only the public staging API origin and existing Google **web** client ID. Commands below load these defaults and optional overrides from the ignored `.env.mobile` file. They do not read the server's `.env` file.

Example `.env.mobile` overrides, as settings become available:

```dotenv
GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT.apps.googleusercontent.com
# Needed for the planned iOS store release; optional for the first Google-only beta.
APPLE_CLIENT_ID=YOUR_APPLE_SERVICE_ID
```

For another environment, override `CLOSER_API_BASE_URL` and `GOOGLE_CLIENT_ID` as well. The API URL must be a complete HTTPS origin, with no path. The backend must allow that origin plus `capacitor://localhost` and `https://localhost`. The current staging deployment already includes both native origins.

## Android preparation

1. Install Android Studio and its SDK tools, Android SDK platform 36, build tools 36.0.0, and JDK 21 or newer. Complete Google's SDK license prompts yourself. Set `JAVA_HOME`/`ANDROID_HOME` if the tools are not found automatically.
2. Run `npm run mobile:doctor -- android` to list missing local prerequisites. This command only reads tool/configuration metadata.
3. Run `npm run mobile:prepare:android`. It builds the web bundle with the staging API URL, syncs only Android, and refreshes third-party notices. It **does not create an APK**.
4. Open with `npm run mobile:open:android`. Android Studio can build a debug APK for direct installation. Before Google login will work, obtain the debug certificate SHA-1 with the Gradle `signingReport` task and create an Android OAuth client in project `closr-512507`, package `com.closer.couples`, with that SHA-1. The app continues to use the **web** client ID at runtime.
5. For Play distribution, configure a private upload key, increment `versionCode`, register the relevant release/Play app-signing certificate with Google, and build a signed Android App Bundle. Keys and passwords must stay outside Git; key file patterns and `android/keystore.properties` are ignored. Debug signing is only for local beta installs.

Android login does not require an iOS client or Apple credentials. No Android SDK licenses or developer-account purchases are accepted by the preparation scripts.

## iPhone preparation

1. Install full Xcode 26 or newer from Apple. Command Line Tools alone cannot compile this app. Complete Apple's first-run setup yourself, then select the full Xcode developer directory if necessary.
2. Create a Google **iOS** OAuth client for bundle identifier `com.closer.couples` in project `closr-512507`. Put its public client ID in `.env.mobile`; also set the same ID on the server's `GOOGLE_IOS_CLIENT_ID` audience list and deploy the backend. An Android client cannot substitute for this value.
3. Run `npm run mobile:prepare:ios`. It updates the Google URL scheme in Info.plist while retaining other URL schemes, bundles the live API settings, and syncs iOS. Google callbacks are handled for scene launches and URL callbacks.
4. Open `npm run mobile:open:ios`, select your **personal** Apple development team, and configure signing. Do not select an employer's team. The bundle identifier must be available to that team; changing it later also requires new OAuth/Apple registrations.
5. Use a signed archive and TestFlight for the shared iPhone beta. This requires Apple Developer Program enrollment. Use an external tester group for your partner; do not grant App Store Connect team privileges solely for testing. The first external beta needs Apple's review. Enrollment, agreements, payment, certificate/provisioning setup, and upload are separate steps.

`npm run mobile:doctor -- ios` reports missing local configuration. The first Google-only beta is distinct from a store-ready build: the planned public iOS release also needs working Sign in with Apple, Apple capability/provisioning, and the backend's complete Apple credential setup. A free Xcode personal team has restrictions and cannot replace TestFlight distribution.

## Preparing store assets

```sh
npm run mobile:build:release -- android
npm run mobile:build:release -- ios
```

These commands prepare each project independently. They do **not** compile, sign, upload, or guarantee store approval. The iOS command requires the Google iOS client ID and Apple Service ID; verify the corresponding server setup separately. Android does not depend on either iOS setting. Build preparation receipts are written under ignored `.closer-mobile/` and explicitly record that no signed binary was built.

## Sessions and beta scope

The app uses native Google sign-in and sends its identity token over HTTPS to Better Auth for verification. All API requests use Capacitor's native HTTP API directly so the API's HttpOnly session cookie can be retained without depending on iOS third-party WebView cookies. This covers JSON requests and binary photo/audio uploads; the global browser fetch patch is not enabled. Requests still include the native app origin for server checks; session tokens are not written to localStorage. Login checks that the server session exists before opening home. Confirm persistence after closing/reopening the real app before using sensitive diary data.

**Send an invite link** uses Capacitor Share in native builds and Web Share on supported browsers. It passes only the invitation URL, allowing the operating system to provide its share sheet, supported installed apps, contacts, and final send. **Copy link** remains available as a fallback; native copying uses Capacitor Clipboard. There are no custom app-specific sharing buttons or added message text. The link always uses the public backend origin, never a local WebView URL. Preparing it before the share tap preserves browser user activation. The user selects the app, recipient, and final send; the app does not infer delivery from closing a share sheet.

Shared invite links currently open the web app. New recipients create their Closr account through Google sign-in, existing members sign in, and both explicitly choose to join the inviter's space. The invite survives OAuth and switching the signed-in account. A partner can accept on the web with the same Google account, then open the phone app to see the connection. Universal/App Links are not configured yet. Real-device sharing and a new second-account join still need verification.

Before distributing the beta, verify native sign-in, logout, reopening the app, optional pairing, status/message sync, photo upload, and journal privacy on the two actual devices. No real-device verification has been completed. Public launch also needs final privacy/data-safety disclosures, complete native SDK notices, store signing, and the remaining release work described in the root README.

## Official setup references

- [Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Native Google login on Android](https://capgo.app/docs/plugins/social-login/google/android/)
- [Native Google login on iOS](https://capgo.app/docs/plugins/social-login/google/ios/)
- [Native HTTP transport](https://capacitorjs.com/docs/apis/http)
- [Apple TestFlight](https://developer.apple.com/testflight/)

### Journal photo library

The native projects now register an app-local `ClosrPhotoLibrary` bridge. Journal Studio can request a date-range/favourites preview, then import only photos the member confirms. PhotoKit/MediaStore read permissions are requested on demand; limited access and the standard selected-file picker remain supported. The web cannot scan a phone library and uses selected uploads instead. Native image export is not enabled. See [Journal Studio](../docs/journal-studio.md) for limits and required real-device/store checks; synchronized sources are not a signed or device-verified app.


Voice/video journal moments also use foreground getUserMedia/MediaRecorder where available, with selected-file fallback. Camera/microphone purpose strings and Android permissions are declared. Live capture, pauses, app backgrounding, uploads and cross-platform codec playback remain real-phone checks; no background recording service was added.
