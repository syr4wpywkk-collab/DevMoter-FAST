# iPhone 16 / AltStore Classic / Linux

The iOS client requires iOS 17 or later and connects to an existing DevMoter server over HTTPS. It does not run the Linux server or coding agents on the phone.

## Build with GitHub Actions

Push `ios/` and `.github/workflows/ios-altstore.yml` to GitHub, then open **Actions → iOS IPA for AltStore → Run workflow**. A push affecting these files also starts a build. Download the **DevMoter-AltStore** artifact from the completed run, unzip the artifact, and transfer `DevMoter-AltStore.ipa` to Files on the iPhone.

The workflow compiles for a physical iPhone with signing disabled. AltStore Classic signs the IPA during installation using the Apple account configured in AltServer. No Apple password or signing certificate belongs in GitHub secrets for this workflow. A successful Linux check does not establish that the iOS build succeeds; the macOS Actions run must pass before installation.

## Install on the iPhone

1. Set up AltServer on a Mac or Windows computer using the official instructions at https://altstore.io/ and install **AltStore Classic** on the connected iPhone 16. AltStore PAL is a different distribution system and is not the arbitrary-IPA installer used here.
2. Enable Developer Mode on the iPhone if requested, and trust the developer profile in Settings if requested. Keep the phone able to reach AltServer.
3. In AltStore Classic, open **My Apps → +** and select `DevMoter-AltStore.ipa`. Wait for signing and installation to finish.
4. Open DevMoter, enter a profile name and the private server's HTTPS origin, then sign in. Configure Tailscale on the phone if the server is reachable only through the tailnet.
5. Follow AltStore's refresh requirements. Free Apple accounts usually require refresh within seven days and have app/App ID limits.

## Linux computer only

For a Linux computer, follow the current [SideStore prerequisites](https://docs.sidestore.io/docs/installation/prerequisites) and [installation guide](https://docs.sidestore.io/docs/installation/install). SideStore accepts the same unsigned IPA; there is no need to rebuild the app for this installer.

1. Install `usbmuxd` with your distribution's package manager. Download iloader from the release links in the prerequisites page: DEB for Debian/Ubuntu, RPM for Fedora/openSUSE, or AppImage, matching `uname -m` (`x86_64` or `aarch64`). Chromebook users also need to pass the iPhone USB device through to the Linux environment as described there.
2. Connect the unlocked iPhone 16 by USB, accept the trust prompt, and open iloader. Sign in with your Apple Account in iloader, select the phone, and choose **Install SideStore (Stable)**.
3. On the iPhone, follow the official guide to trust the developer app and enable Developer Mode. Install LocalDevVPN and finish SideStore setup, including its initial refresh, on Wi-Fi.
4. Download the completed **DevMoter-AltStore** Actions artifact, unzip it, and save `DevMoter-AltStore.ipa` in iPhone Files. With LocalDevVPN connected, import the IPA using **My Apps → +** in SideStore.
5. Open DevMoter and add the HTTPS origin of your existing server. Follow SideStore's app refresh requirements.

If DevMoter uses Tailscale, switch back to the server's required VPN after installation/refresh. LocalDevVPN and Tailscale may compete for the active VPN connection; they serve different purposes.

For AltStore Classic specifically, [AltServer-Linux](https://github.com/NyaMisty/AltServer-Linux) is a community implementation with its own setup instructions. It is not the official Mac/Windows AltServer. Compatibility with the phone's installed iOS version must be verified; this repository has not tested either Linux installation route on a physical iPhone 16.

## Account recognition and isolation

Each connection profile has a persistent UUID and its own `WKWebsiteDataStore`. Cookies, local storage, and web settings are separate, including when two profiles point to the same host. Reopening the app retains the profile and its login state. Profile names are user-supplied labels; verified login identity is shown by the existing server's **Settings → Account** page. Removing a profile requests removal of its local web store; it does not revoke the corresponding server session. Use the server's session controls for revocation.

The server remains single-owner: linked GitHub, Google, Microsoft, and passkey credentials all identify that owner. This client does not add multi-user authorization or isolate server projects, terminals, or credentials. Use separate server installations for independent owners until server-side multi-user authorization is implemented.

HTTPS certificate validation is left to iOS. No HTTP fallback or certificate bypass is included. GitHub device verification links open in Safari while the client continues polling. Google and Microsoft embedded-browser policies may reject OAuth in WKWebView; use a supported sign-in method (such as GitHub device verification or local recovery) in that case. Passkeys and provider redirects require real-device verification and are not asserted to work by this wrapper.

## Verify before use

On an iPhone 16, verify installation and launch, HTTPS connection, sign-in, the verified account shown in Settings, profile switching, login persistence after quitting, and separation between two profiles on the same host. Confirm that signing out of one profile leaves the other profile's cookie unchanged. Confirm invalid certificates fail and non-HTTPS navigation is blocked. Record the Actions run URL and device results; an IPA artifact alone is not proof of installation.
