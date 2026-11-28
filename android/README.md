# DevMoter FAST for Android (experimental)

Android 8.0 (API 26) or newer. This is a native Java WebView client for an existing DevMoter FAST host, not a bundled Node.js server or local agent runtime. Enter the HTTPS origin of your private server (for example a Tailscale Serve HTTPS address). No cleartext or untrusted TLS certificates; no JavaScript native bridge; top-level navigation is restricted to the selected origin. User-initiated external HTTPS links require confirmation and open in the external browser.

## Build

Use JDK 17, Android SDK platform 35, build-tools 35.0.0, and zip. Install SDK components using sdkmanager, then run:

    bash android/build-apk.sh

Output: android/build/DevMoter-FAST.apk and DevMoter-FAST.apk.sha256. Local builds use the Android debug keystore unless a custom keystore and signing environment variables are supplied. Never commit signing keys or passwords.

## Persistent release signing

Android only updates an installed app when the new APK has the same signing key, so CI signs with one long-lived release key (RSA 4096, valid 30 years). Create it once on your own machine with `gh` signed in:

    bash scripts/android-signing-key.sh

This stores `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` as repository secrets and the certificate fingerprint as the `ANDROID_SIGNING_CERT_SHA256` variable. Back up the keystore and its password offline; losing them means installed APKs cannot be updated in place.

`build-apk.sh` moves the secrets into unexported shell variables at start, so build tools never inherit them; it writes the keystore to the private build directory only for the `apksigner` call, passes the password only to that process, then clears the variables and deletes the keystore. The build fails if the signing certificate does not match the fingerprint. Push and manual builds use the release key; pull request builds never receive it and stay debug-signed. Without the secrets, builds fall back to an ephemeral debug key with a warning.

GitHub Actions: Android APK → successful run → Artifacts → DevMoter-FAST-Android-APK. Extract the ZIP and install the APK on an Android test device.

## Limits and QA

One saved HTTPS origin; changing it clears web storage and cookies. Existing server authentication applies; Basic Auth uses an interactive prompt. OAuth redirects, passkeys, file upload, terminal input, streaming/reconnection, process recreation, and actual Tailscale access require physical-device verification. Downloads, multi-profile support and offline agent execution are not implemented. Use non-sensitive test data. Check TLS failure, HTTP rejection, origin changes, certificate mismatch, external redirects, file selection, keyboard/insets, and session isolation before release. APK signing and package metadata are checked by the build script; this is not an end-to-end test.

QR scanning uses ZXing Core 3.5.4 (Apache-2.0), compiled from pinned upstream commit `f651b0a0375676e47144f73397dddff8868b0e4c`. License and NOTICE are included in the APK. Camera permission is requested only for scanning. A scanned link requires explicit server confirmation and existing owner login; the token remains in process memory, not preferences.
