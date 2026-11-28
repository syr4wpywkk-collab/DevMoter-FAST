# DevMoter FAST for Android (experimental)

Android 8.0 (API 26) or newer. This is a native Java WebView client for an existing DevMoter FAST host, not a bundled Node.js server or local agent runtime. Enter the HTTPS origin of your private server (for example a Tailscale Serve HTTPS address). No cleartext or untrusted TLS certificates; no JavaScript native bridge; top-level navigation is restricted to the selected origin. User-initiated external HTTPS links require confirmation and open in the external browser.

## Build

Use JDK 17, Android SDK platform 35, build-tools 35.0.0, and zip. Install SDK components using sdkmanager, then run:

    bash android/build-apk.sh

Output: android/build/DevMoter-FAST.apk and DevMoter-FAST.apk.sha256. Local builds use the Android debug keystore unless a custom keystore and signing environment variables are supplied. CI debug keys are ephemeral: APKs from different CI runs may not update each other. Use a persistent securely managed key before distributing releases. Never commit signing keys or passwords.

GitHub Actions: Android APK → successful run → Artifacts → DevMoter-FAST-Android-APK. Extract the ZIP and install the APK on an Android test device.

## Limits and QA

One saved HTTPS origin; changing it clears web storage and cookies. Existing server authentication applies; Basic Auth uses an interactive prompt. OAuth redirects, passkeys, file upload, terminal input, streaming/reconnection, process recreation, and actual Tailscale access require physical-device verification. Downloads, multi-profile support and offline agent execution are not implemented. Use non-sensitive test data. Check TLS failure, HTTP rejection, origin changes, certificate mismatch, external redirects, file selection, keyboard/insets, and session isolation before release. APK signing and package metadata are checked by the build script; this is not an end-to-end test.
